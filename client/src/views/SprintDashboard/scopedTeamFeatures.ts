// scopedTeamFeatures.ts — Filters Team Dashboard features to the right team, PI, and optional feature projects.

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { fetchBlueprintHierarchy, flattenProgramEpicFeatures, type BlueprintFeatureNode } from '../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';

const FEATURE_SCOPE_BATCH_SIZE = 50;
const FEATURE_SCOPE_SEARCH_MAX_RESULTS = 200;
const DEFAULT_PI_FIELD_ID = 'customfield_10301';

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

export interface ScopedTeamFeatureRecord {
  feature: BlueprintFeatureNode;
  featureIssue: JiraIssue | null;
}

export interface ScopedTeamFeatureOptions {
  piFieldId: string;
  featureProjectKeys: readonly string[];
  requestedFieldIds?: readonly string[];
}

function buildUniqueFieldIds(fieldIds: readonly string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function buildIssueSearchPath(jql: string, fields: readonly string[]): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(buildUniqueFieldIds(fields).join(','))}&maxResults=${FEATURE_SCOPE_SEARCH_MAX_RESULTS}`;
}

function readFeatureProjectKey(featureKey: string): string {
  const [featureProjectKey = ''] = featureKey.split('-', 1);
  return featureProjectKey.trim().toUpperCase();
}

function readProgramIncrementValueFromIssue(issue: JiraIssue, piFieldId: string): string {
  const rawPiValue = (issue.fields as Record<string, unknown>)[piFieldId];
  if (typeof rawPiValue === 'string') {
    return rawPiValue;
  }

  if (rawPiValue && typeof rawPiValue === 'object') {
    const optionValue = rawPiValue as { value?: string; name?: string };
    return optionValue.value ?? optionValue.name ?? '';
  }

  if (piFieldId !== DEFAULT_PI_FIELD_ID) {
    return readProgramIncrementValueFromIssue(issue, DEFAULT_PI_FIELD_ID);
  }

  return '';
}

function hasMatchingFeatureProject(featureKey: string, featureProjectKeys: readonly string[]): boolean {
  if (featureProjectKeys.length === 0) {
    return true;
  }

  return featureProjectKeys.includes(readFeatureProjectKey(featureKey));
}

function hasMatchingFeaturePi(featureIssue: JiraIssue | null, selectedPiName: string, piFieldId: string): boolean {
  if (!featureIssue || selectedPiName.trim() === '') {
    return true;
  }

  const featurePiValue = readProgramIncrementValueFromIssue(featureIssue, piFieldId).trim();
  return featurePiValue === '' || featurePiValue === selectedPiName.trim();
}

async function fetchFeatureIssuesByKeys(
  featureKeys: readonly string[],
  fieldIds: readonly string[],
): Promise<Map<string, JiraIssue>> {
  if (featureKeys.length === 0) {
    return new Map<string, JiraIssue>();
  }

  const issueKeyBatches: string[][] = [];
  for (let issueIndex = 0; issueIndex < featureKeys.length; issueIndex += FEATURE_SCOPE_BATCH_SIZE) {
    issueKeyBatches.push(featureKeys.slice(issueIndex, issueIndex + FEATURE_SCOPE_BATCH_SIZE));
  }

  const featureIssueResults = await Promise.all(
    issueKeyBatches.map((issueKeyBatch) =>
      jiraGet<JiraSearchResponse>(buildIssueSearchPath(`key in (${issueKeyBatch.join(',')}) ORDER BY key ASC`, fieldIds)),
    ),
  );

  return new Map(
    featureIssueResults
      .flatMap((featureIssueResult) => featureIssueResult.issues ?? [])
      .map((issue) => [issue.key, issue]),
  );
}

/** Loads Team Dashboard features that still have child work for the team and belong to the chosen PI scope. */
export async function fetchScopedTeamFeatures(
  team: ArtTeam,
  selectedPiName: string,
  options: ScopedTeamFeatureOptions,
): Promise<ScopedTeamFeatureRecord[]> {
  const blueprintFeatures = flattenProgramEpicFeatures(await fetchBlueprintHierarchy([team], selectedPiName))
    .filter((featureNode) => featureNode.children.length > 0)
    .filter((featureNode) => hasMatchingFeatureProject(featureNode.key, options.featureProjectKeys))
    .sort((leftFeature, rightFeature) => leftFeature.key.localeCompare(rightFeature.key));

  if (blueprintFeatures.length === 0) {
    return [];
  }

  const featureIssuesByKey = await fetchFeatureIssuesByKeys(
    blueprintFeatures.map((featureNode) => featureNode.key),
    [
      'summary',
      'status',
      'issuetype',
      options.piFieldId,
      DEFAULT_PI_FIELD_ID,
      ...(options.requestedFieldIds ?? []),
    ],
  );

  return blueprintFeatures
    .map((featureNode) => ({
      feature: featureNode,
      featureIssue: featureIssuesByKey.get(featureNode.key) ?? null,
    }))
    .filter((featureRecord) => hasMatchingFeaturePi(featureRecord.featureIssue, selectedPiName, options.piFieldId));
}
