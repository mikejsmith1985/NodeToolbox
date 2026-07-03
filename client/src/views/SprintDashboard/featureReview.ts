// featureReview.ts — Loads Team Dashboard feature rollups plus per-feature hygiene flags from Jira.

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import {
  loadEnterpriseRulesFromStorage,
  readEnabledBuiltInCheckIds,
  readEnabledRequiredFieldRules,
} from '../AdminHub/enterpriseRules.ts';
import {
  evaluateHygieneIssue,
  resolveHygieneFieldConfig,
  type HygieneFieldConfig,
  type HygieneFlag,
} from '../Hygiene/checks/hygieneChecks.ts';
import { readArtFeatureScopeSettings } from '../ArtView/artFeatureScopeSettings.ts';
import { fetchFeatureNodesByKeys, type BlueprintFeatureNode, type BlueprintStoryNode } from '../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import { fetchScopedTeamFeatures } from './scopedTeamFeatures.ts';

const DONE_STATUS_KEYWORDS = ['done', 'closed', 'resolved', 'complete'];
const BLOCKED_STATUS_KEYWORDS = ['blocked', 'impediment'];
// The blueprint hierarchy hardcodes only legacy SP fields; the configured custom field must be
// queried separately. Stories are chunked to stay within Jira's JQL query-length limits.
const STORY_POINTS_QUERY_CHUNK_SIZE = 100;

interface JiraFieldDefinition {
  id?: string;
  name?: string;
}

export interface FeatureReviewItem {
  feature: BlueprintFeatureNode;
  featureIssue: JiraIssue;
  hygieneFlags: HygieneFlag[];
  blockedChildCount: number;
  doneChildCount: number;
  inFlightChildCount: number;
  totalChildCount: number;
}

function buildUniqueFieldIds(fieldIds: readonly string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function matchFieldIdsByName(availableFields: JiraFieldDefinition[], candidateNames: readonly string[]): string[] {
  const normalizedCandidateNames = candidateNames.map((candidateName) => candidateName.trim().toLowerCase());
  return availableFields
    .filter((fieldDefinition) => normalizedCandidateNames.includes(fieldDefinition.name?.trim().toLowerCase() ?? ''))
    .map((fieldDefinition) => fieldDefinition.id?.trim() ?? '')
    .filter(Boolean);
}

function buildFeatureReviewFieldConfig(availableFields: JiraFieldDefinition[]): HygieneFieldConfig {
  return resolveHygieneFieldConfig({
    acceptanceCriteriaFieldIds: matchFieldIdsByName(availableFields, ['Acceptance Criteria', 'Acceptance Criteria / Notes']),
    applicationFieldIds: matchFieldIdsByName(availableFields, ['Application']),
    featureLinkFieldIds: matchFieldIdsByName(availableFields, ['Feature Link', 'Epic Link']),
    initiativeTypeFieldIds: matchFieldIdsByName(availableFields, ['Initiative Type']),
    parentLinkFieldIds: ['parent', ...matchFieldIdsByName(availableFields, ['Parent Link'])],
    productOwnerFieldIds: matchFieldIdsByName(availableFields, ['Product Owner']),
    programIncrementFieldIds: matchFieldIdsByName(availableFields, ['Program Increment']),
    targetStartFieldIds: matchFieldIdsByName(availableFields, ['Target Start']),
    targetEndFieldIds: matchFieldIdsByName(availableFields, ['Target End']),
  });
}

/** Resolves the Jira field IDs Feature Review uses for shared hygiene checks and direct fixes. */
export async function fetchFeatureReviewFieldConfig(): Promise<HygieneFieldConfig> {
  const availableFields = await jiraGet<JiraFieldDefinition[]>('/rest/api/2/field');
  return buildFeatureReviewFieldConfig(availableFields);
}

function createFallbackFeatureIssue(featureNode: BlueprintFeatureNode): JiraIssue {
  return {
    id: featureNode.key,
    key: featureNode.key,
    fields: {
      summary: featureNode.summary,
      status: { name: featureNode.status, statusCategory: { key: 'indeterminate' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Feature', iconUrl: '' },
      created: '',
      updated: '',
      description: null,
      duedate: null,
      fixVersions: [],
      parent: null,
    },
  };
}

// Used only when no real custom field is configured — reads the blueprint's pre-computed legacy values.
function hasPositiveStoryPoints(storyNode: BlueprintStoryNode): boolean {
  return typeof storyNode.storyPoints === 'number' && storyNode.storyPoints > 0;
}

// Handles plain numbers, numeric strings, and Jira Select-type {id, value} objects.
function hasPositiveFieldValue(fieldValue: unknown): boolean {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return false;
  if (typeof fieldValue === 'number') return fieldValue > 0;
  if (typeof fieldValue === 'string') {
    const parsed = Number(fieldValue);
    return Number.isFinite(parsed) && parsed > 0;
  }
  if (Array.isArray(fieldValue)) return false;
  if (typeof fieldValue === 'object') {
    return hasPositiveFieldValue((fieldValue as Record<string, unknown>).value);
  }
  return false;
}

/**
 * Builds the set of feature keys that have at least one child story with positive story points.
 *
 * When a real Jira custom field is configured (e.g. customfield_10236), the blueprint hierarchy's
 * pre-computed storyPoints only covers customfield_10016/10028 and will miss that field. In that
 * case we fetch the configured field directly for the story keys the blueprint already knows about,
 * avoiding fragile JQL-based child discovery that depends on Jira field naming conventions.
 */
async function buildFeatureKeysWithPointedChildren(
  blueprintFeatures: BlueprintFeatureNode[],
  customStoryPointsFieldId: string,
): Promise<Set<string>> {
  const isRealCustomField = customStoryPointsFieldId.startsWith('customfield_');

  // Without a real custom field, the blueprint's pre-computed storyPoints is sufficient.
  if (!isRealCustomField) {
    return new Set(
      blueprintFeatures
        .filter((featureNode) => [...featureNode.children, ...featureNode.offTrain].some(hasPositiveStoryPoints))
        .map((featureNode) => featureNode.key),
    );
  }

  // The blueprint hierarchy already knows which stories belong to which feature — use it directly
  // instead of re-discovering parent-child links through JQL, which varies across Jira setups.
  const storyKeyToFeatureKey = new Map<string, string>();
  for (const featureNode of blueprintFeatures) {
    for (const storyNode of [...featureNode.children, ...featureNode.offTrain]) {
      storyKeyToFeatureKey.set(storyNode.key, featureNode.key);
    }
  }

  const allStoryKeys = Array.from(storyKeyToFeatureKey.keys());
  if (allStoryKeys.length === 0) return new Set<string>();

  // Fetch the configured SP field for the known story keys, chunked to respect JQL length limits.
  const pointedFeatureKeys = new Set<string>();
  for (let startIndex = 0; startIndex < allStoryKeys.length; startIndex += STORY_POINTS_QUERY_CHUNK_SIZE) {
    const keyChunk = allStoryKeys.slice(startIndex, startIndex + STORY_POINTS_QUERY_CHUNK_SIZE);
    const encodedKeys = keyChunk.map((storyKey) => `"${storyKey}"`).join(',');
    const response = await jiraGet<{ issues?: Array<{ key?: string; fields: Record<string, unknown> }> }>(
      `/rest/api/2/search?jql=${encodeURIComponent(`issueKey in (${encodedKeys})`)}&fields=${encodeURIComponent(customStoryPointsFieldId)}&maxResults=${STORY_POINTS_QUERY_CHUNK_SIZE}`,
    ).catch(() => ({ issues: [] as Array<{ key?: string; fields: Record<string, unknown> }> }));

    for (const story of response.issues ?? []) {
      if (!story.key || !hasPositiveFieldValue(story.fields[customStoryPointsFieldId])) continue;
      const featureKey = storyKeyToFeatureKey.get(story.key);
      if (featureKey) {
        pointedFeatureKeys.add(featureKey);
      }
    }
  }
  return pointedFeatureKeys;
}

function isDoneStatus(statusName: string): boolean {
  const normalizedStatusName = statusName.toLowerCase();
  return DONE_STATUS_KEYWORDS.some((keyword) => normalizedStatusName.includes(keyword));
}

function isBlockedStatus(statusName: string): boolean {
  const normalizedStatusName = statusName.toLowerCase();
  return BLOCKED_STATUS_KEYWORDS.some((keyword) => normalizedStatusName.includes(keyword));
}

/** Loads the Team Dashboard feature rollup for one team and evaluates the shared hygiene rules per feature. */
export async function fetchFeatureReviewItems(
  team: ArtTeam,
  selectedPiName: string,
  featureReviewFieldConfig?: HygieneFieldConfig,
  customStoryPointsFieldId = '',
): Promise<FeatureReviewItem[]> {
  const fieldConfig = featureReviewFieldConfig ?? await fetchFeatureReviewFieldConfig();
  const enterpriseRules = loadEnterpriseRulesFromStorage();
  const enabledBuiltInCheckIds = readEnabledBuiltInCheckIds(enterpriseRules);
  const enabledCustomRules = readEnabledRequiredFieldRules(enterpriseRules);
  const featureScopeSettings = readArtFeatureScopeSettings();
  const scopedFeatureRecords = await fetchScopedTeamFeatures(team, selectedPiName, {
    piFieldId: featureScopeSettings.piFieldId,
    featureProjectKeys: featureScopeSettings.featureProjectKeys,
    requestedFieldIds: buildUniqueFieldIds([
      'assignee',
      'description',
      'duedate',
      'fixVersions',
      'parent',
      ...enabledCustomRules.map((customRule) => customRule.fieldId),
      ...fieldConfig.acceptanceCriteriaFieldIds,
      ...fieldConfig.applicationFieldIds,
      ...fieldConfig.featureLinkFieldIds,
      ...fieldConfig.initiativeTypeFieldIds,
      ...fieldConfig.parentLinkFieldIds,
      ...fieldConfig.productOwnerFieldIds,
      ...fieldConfig.programIncrementFieldIds,
      ...fieldConfig.targetEndFieldIds,
      ...fieldConfig.targetStartFieldIds,
    ]),
  });
  const blueprintFeatures = scopedFeatureRecords.map((featureRecord) => featureRecord.feature);
  const featureIssuesByKey = new Map(
    scopedFeatureRecords
      .filter((featureRecord) => featureRecord.featureIssue)
      .map((featureRecord) => [featureRecord.feature.key, featureRecord.featureIssue as JiraIssue]),
  );
  const featureKeysWithPointedStories = await buildFeatureKeysWithPointedChildren(
    blueprintFeatures,
    customStoryPointsFieldId,
  );

  const buildContext: FeatureReviewBuildContext = {
    fieldConfig,
    enabledBuiltInCheckIds,
    enabledCustomRules,
    featureKeysWithPointedStories,
  };
  return blueprintFeatures.map((featureNode) => {
    const featureIssue = featureIssuesByKey.get(featureNode.key) ?? createFallbackFeatureIssue(featureNode);
    return buildFeatureReviewItem(featureNode, featureIssue, buildContext);
  });
}

/** Shared inputs the per-feature item builder needs for hygiene evaluation. */
interface FeatureReviewBuildContext {
  fieldConfig: HygieneFieldConfig;
  enabledBuiltInCheckIds: ReturnType<typeof readEnabledBuiltInCheckIds>;
  enabledCustomRules: ReturnType<typeof readEnabledRequiredFieldRules>;
  featureKeysWithPointedStories: ReadonlySet<string>;
}

/** Builds one FeatureReviewItem from a blueprint feature node + its live Jira issue. Shared by the
 *  PI-scoped and JQL-scoped fetches so child counts and hygiene evaluation stay identical. */
function buildFeatureReviewItem(
  featureNode: BlueprintFeatureNode,
  featureIssue: JiraIssue,
  buildContext: FeatureReviewBuildContext,
): FeatureReviewItem {
  const allChildStories = [...featureNode.children, ...featureNode.offTrain];
  const doneChildCount = allChildStories.filter((storyNode) => isDoneStatus(storyNode.status)).length;
  const blockedChildCount = allChildStories.filter((storyNode) => isBlockedStatus(storyNode.status)).length;

  return {
    feature: featureNode,
    featureIssue,
    hygieneFlags: evaluateHygieneIssue(featureIssue, {
      customRules: buildContext.enabledCustomRules,
      enabledBuiltInCheckIds: buildContext.enabledBuiltInCheckIds,
      featureKeysWithPointedStories: buildContext.featureKeysWithPointedStories,
      fieldConfig: buildContext.fieldConfig,
    }),
    blockedChildCount,
    doneChildCount,
    inFlightChildCount: allChildStories.length - doneChildCount,
    totalChildCount: allChildStories.length,
  };
}

/**
 * Loads Feature Review items for an **arbitrary JQL query** instead of the PI rollup. Runs the query
 * to get matching feature/epic issues (with hygiene fields), builds their blueprint nodes
 * (health/completion + children) via `fetchFeatureNodesByKeys`, and assembles items with the shared
 * builder. Rejects if the query is invalid/unauthorized so the caller can surface the error without
 * touching any local state.
 */
export async function fetchFeatureReviewItemsByJql(
  jql: string,
  featureReviewFieldConfig?: HygieneFieldConfig,
  customStoryPointsFieldId = '',
): Promise<FeatureReviewItem[]> {
  const fieldConfig = featureReviewFieldConfig ?? await fetchFeatureReviewFieldConfig();
  const enterpriseRules = loadEnterpriseRulesFromStorage();
  const enabledBuiltInCheckIds = readEnabledBuiltInCheckIds(enterpriseRules);
  const enabledCustomRules = readEnabledRequiredFieldRules(enterpriseRules);

  const requestedFieldIds = buildUniqueFieldIds([
    'summary', 'status', 'assignee', 'description', 'duedate', 'fixVersions', 'parent', 'issuelinks', 'labels', 'issuetype',
    ...enabledCustomRules.map((customRule) => customRule.fieldId),
    ...fieldConfig.acceptanceCriteriaFieldIds,
    ...fieldConfig.applicationFieldIds,
    ...fieldConfig.featureLinkFieldIds,
    ...fieldConfig.initiativeTypeFieldIds,
    ...fieldConfig.parentLinkFieldIds,
    ...fieldConfig.productOwnerFieldIds,
    ...fieldConfig.programIncrementFieldIds,
    ...fieldConfig.targetEndFieldIds,
    ...fieldConfig.targetStartFieldIds,
  ]);
  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(requestedFieldIds.join(','))}&maxResults=200`;
  const searchResult = await jiraGet<{ issues?: JiraIssue[] }>(searchPath);
  const featureIssues = searchResult.issues ?? [];
  if (featureIssues.length === 0) {
    return [];
  }
  const featureIssuesByKey = new Map(featureIssues.map((featureIssue) => [featureIssue.key, featureIssue]));

  const featureNodes = await fetchFeatureNodesByKeys(featureIssues.map((featureIssue) => featureIssue.key));
  const featureKeysWithPointedStories = await buildFeatureKeysWithPointedChildren(featureNodes, customStoryPointsFieldId);
  const buildContext: FeatureReviewBuildContext = {
    fieldConfig,
    enabledBuiltInCheckIds,
    enabledCustomRules,
    featureKeysWithPointedStories,
  };

  return featureNodes.map((featureNode) => {
    const featureIssue = featureIssuesByKey.get(featureNode.key) ?? createFallbackFeatureIssue(featureNode);
    return buildFeatureReviewItem(featureNode, featureIssue, buildContext);
  });
}
