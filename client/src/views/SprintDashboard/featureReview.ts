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
import { type BlueprintFeatureNode, type BlueprintStoryNode } from '../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import { fetchScopedTeamFeatures } from './scopedTeamFeatures.ts';

const DONE_STATUS_KEYWORDS = ['done', 'closed', 'resolved', 'complete'];
const BLOCKED_STATUS_KEYWORDS = ['blocked', 'impediment'];

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

function hasPositiveStoryPoints(storyNode: BlueprintStoryNode): boolean {
  return typeof storyNode.storyPoints === 'number' && storyNode.storyPoints > 0;
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
  const featureKeysWithPointedStories = new Set(
    blueprintFeatures
      .filter((featureNode) => [...featureNode.children, ...featureNode.offTrain].some(hasPositiveStoryPoints))
      .map((featureNode) => featureNode.key),
  );

  return blueprintFeatures.map((featureNode) => {
    const featureIssue = featureIssuesByKey.get(featureNode.key) ?? createFallbackFeatureIssue(featureNode);
    const allChildStories = [...featureNode.children, ...featureNode.offTrain];
    const doneChildCount = allChildStories.filter((storyNode) => isDoneStatus(storyNode.status)).length;
    const blockedChildCount = allChildStories.filter((storyNode) => isBlockedStatus(storyNode.status)).length;

    return {
      feature: featureNode,
      featureIssue,
      hygieneFlags: evaluateHygieneIssue(featureIssue, {
        customRules: enabledCustomRules,
        enabledBuiltInCheckIds,
        featureKeysWithPointedStories,
        fieldConfig,
      }),
      blockedChildCount,
      doneChildCount,
      inFlightChildCount: allChildStories.length - doneChildCount,
      totalChildCount: allChildStories.length,
    };
  });
}
