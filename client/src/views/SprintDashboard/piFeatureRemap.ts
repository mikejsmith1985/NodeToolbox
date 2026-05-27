// piFeatureRemap.ts — Helpers for Team Dashboard PI closeout remapping of open child issues between features.

import { jiraGet, jiraPut } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { readArtFeatureScopeSettings } from '../ArtView/artFeatureScopeSettings.ts';
import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import { findPiNameForDate, parsePiDateRange } from '../ArtView/hooks/artHelpers.ts';
import { fetchScopedTeamFeatures } from './scopedTeamFeatures.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_FEATURE_LINK_FIELD = 'customfield_10108';
const DEFAULT_EPIC_LINK_FIELD = 'customfield_10014';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const FEATURE_REMAP_SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'parent'];
interface StoredArtSettings {
  featureLinkField?: string;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

interface JiraEditMetaField {
  allowedValues?: Array<{ value?: string; name?: string }>;
  schema?: { type?: string };
}

interface JiraEditMetaResponse {
  fields?: Record<string, JiraEditMetaField | undefined>;
}

export interface FeatureRemapSettings {
  featureLinkField: string;
  piFieldId: string;
  featureProjectKeys: string[];
}

export interface FeatureRemapCandidateIssue {
  key: string;
  summary: string;
  statusName: string;
  issueTypeName: string;
  currentFeatureKey: string | null;
  currentPiValue: string;
}

export interface FeatureRemapExecutionResult {
  movedIssueKeys: string[];
  failedIssueKeys: string[];
  failureMessages: string[];
  targetPiValue: string;
}

export interface FeatureRemapFeatureOption {
  key: string;
  summary: string;
  piValue: string;
}

export interface FeatureRemapPiOptions {
  currentPiName: string;
  priorPiName: string | null;
  currentPiFeatures: FeatureRemapFeatureOption[];
  priorPiFeatures: FeatureRemapFeatureOption[];
}

function readStoredArtSettings(): StoredArtSettings {
  try {
    return JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as StoredArtSettings;
  } catch {
    return {};
  }
}

function readIssueFieldValue(issue: JiraIssue, fieldId: string): unknown {
  return (issue.fields as Record<string, unknown>)[fieldId];
}

function extractIssueKeyFromLinkValue(linkValue: unknown): string | null {
  if (typeof linkValue === 'string' && linkValue.includes('-')) {
    return linkValue;
  }

  if (!linkValue || typeof linkValue !== 'object') {
    return null;
  }

  const linkedIssueValue = linkValue as {
    key?: string;
    data?: { key?: string };
    inwardIssue?: { key?: string };
  };
  return linkedIssueValue.key
    ?? linkedIssueValue.data?.key
    ?? linkedIssueValue.inwardIssue?.key
    ?? null;
}

function buildUniqueFieldIds(fieldIds: string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function buildJqlFieldReference(fieldId: string): string {
  if (fieldId === 'parent') {
    return 'parent';
  }

  const customFieldMatch = /^customfield_(\d+)$/.exec(fieldId);
  if (customFieldMatch) {
    return `cf[${customFieldMatch[1]}]`;
  }

  return fieldId.includes(' ') ? `"${fieldId}"` : fieldId;
}

function buildFeatureFieldUpdateFields(featureLinkField: string, targetFeatureKey: string): Record<string, unknown> {
  if (featureLinkField === 'parent') {
    return { parent: { key: targetFeatureKey } };
  }

  return { [featureLinkField]: targetFeatureKey };
}

async function fetchPiFieldEditMeta(issueKey: string): Promise<JiraEditMetaResponse> {
  return jiraGet<JiraEditMetaResponse>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/editmeta`);
}

async function fetchIssueByKey(issueKey: string, fieldIds: string[]): Promise<JiraIssue> {
  const uniqueFieldIds = buildUniqueFieldIds(fieldIds);
  return jiraGet<JiraIssue>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(uniqueFieldIds.join(','))}`,
  );
}

function sortPiNames(piNames: string[]): string[] {
  return Array.from(new Set(piNames.filter(Boolean)))
    .sort((leftPiName, rightPiName) => {
      const leftRange = parsePiDateRange(leftPiName);
      const rightRange = parsePiDateRange(rightPiName);
      if (leftRange && rightRange) {
        return rightRange.startDate.getTime() - leftRange.startDate.getTime();
      }

      return rightPiName.localeCompare(leftPiName);
    });
}

function buildPiFieldReference(piFieldId: string): string {
  const customFieldMatch = /^customfield_(\d+)$/.exec(piFieldId);
  if (customFieldMatch) {
    return `cf[${customFieldMatch[1]}]`;
  }

  return piFieldId.includes(' ') ? `"${piFieldId}"` : piFieldId;
}

async function fetchProjectPiNames(projectKey: string, piFieldId: string): Promise<string[]> {
  const piFieldReference = buildPiFieldReference(piFieldId);
  const jql = `project = "${projectKey.trim().toUpperCase()}" AND ${piFieldReference} is not EMPTY ORDER BY created DESC`;
  const response = await jiraGet<JiraSearchResponse>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(piFieldId)}&maxResults=1000`,
  );

  return sortPiNames(
    (response.issues ?? [])
      .map((issue) => readProgramIncrementValueFromIssue(issue, piFieldId))
      .filter((piValue) => piValue.trim() !== ''),
  );
}

function readPriorPiName(sortedPiNames: string[], currentPiName: string): string | null {
  const currentPiIndex = sortedPiNames.findIndex((piName) => piName === currentPiName);
  if (currentPiIndex === -1 || currentPiIndex === sortedPiNames.length - 1) {
    return null;
  }

  return sortedPiNames[currentPiIndex + 1] ?? null;
}

async function fetchPiFeatureOptions(
  projectKey: string,
  piName: string | null,
  featureRemapSettings: FeatureRemapSettings,
): Promise<FeatureRemapFeatureOption[]> {
  if (!piName) {
    return [];
  }

  const featureDiscoveryTeam: ArtTeam = {
    id: `${projectKey.trim().toUpperCase()}-feature-discovery`,
    name: `${projectKey.trim().toUpperCase()} Feature Discovery`,
    boardId: '',
    projectKey: projectKey.trim().toUpperCase(),
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
  const scopedFeatureRecords = await fetchScopedTeamFeatures(featureDiscoveryTeam, piName, {
    piFieldId: featureRemapSettings.piFieldId,
    featureProjectKeys: featureRemapSettings.featureProjectKeys,
    requestedFieldIds: [],
  });
  return scopedFeatureRecords.map((featureRecord) => ({
    key: featureRecord.feature.key,
    summary: featureRecord.feature.summary,
    piValue: readProgramIncrementValueFromIssue(featureRecord.featureIssue ?? createFallbackFeatureIssue(featureRecord.feature), featureRemapSettings.piFieldId)
      || piName,
  }));
}

function createFallbackFeatureIssue(featureNode: { key: string; summary: string; status: string }): JiraIssue {
  return {
    id: featureNode.key,
    key: featureNode.key,
    fields: {
      summary: featureNode.summary,
      status: { name: featureNode.status, statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Feature', iconUrl: '' },
      priority: null,
      assignee: null,
      reporter: null,
      created: '',
      updated: '',
      duedate: null,
      description: null,
    },
  };
}

/** Reads the configured Jira field IDs and optional feature-project filter for Team Dashboard remapping. */
export function readFeatureRemapSettings(): FeatureRemapSettings {
  const storedArtSettings = readStoredArtSettings();
  const featureScopeSettings = readArtFeatureScopeSettings();
  return {
    featureLinkField: storedArtSettings.featureLinkField?.trim() || DEFAULT_FEATURE_LINK_FIELD,
    piFieldId: featureScopeSettings.piFieldId,
    featureProjectKeys: featureScopeSettings.featureProjectKeys,
  };
}

/** Extracts the feature key from a Jira issue using the configured field plus known fallback fields. */
export function extractFeatureKeyFromIssue(issue: JiraIssue, featureLinkField: string): string | null {
  const candidateFieldIds = buildUniqueFieldIds([
    featureLinkField,
    DEFAULT_FEATURE_LINK_FIELD,
    DEFAULT_EPIC_LINK_FIELD,
  ]);

  for (const candidateFieldId of candidateFieldIds) {
    const linkedIssueKey = extractIssueKeyFromLinkValue(readIssueFieldValue(issue, candidateFieldId));
    if (linkedIssueKey) {
      return linkedIssueKey;
    }
  }

  return issue.fields.parent?.key ?? null;
}

/** Reads the Program Increment value from an issue regardless of whether Jira returns a string or option object. */
export function readProgramIncrementValueFromIssue(issue: JiraIssue, piFieldId: string): string {
  const rawPiValue = readIssueFieldValue(issue, piFieldId);
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

/** Builds the Jira search request for all non-done child issues currently linked to the old feature. */
export function buildFeatureRemapSearchPath(
  projectKey: string,
  sourceFeatureKey: string,
  featureLinkField: string,
  piFieldId: string,
): string {
  const trimmedProjectKey = projectKey.trim().toUpperCase();
  const trimmedSourceFeatureKey = sourceFeatureKey.trim().toUpperCase();
  const jqlFieldReference = buildJqlFieldReference(featureLinkField);
  const searchFields = buildUniqueFieldIds([
    ...FEATURE_REMAP_SEARCH_FIELDS,
    featureLinkField,
    DEFAULT_FEATURE_LINK_FIELD,
    DEFAULT_EPIC_LINK_FIELD,
    piFieldId,
    DEFAULT_PI_FIELD_ID,
  ]);
  const jql = `project = "${trimmedProjectKey}" AND statusCategory != Done AND ${jqlFieldReference} = ${trimmedSourceFeatureKey} ORDER BY key ASC`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(searchFields.join(','))}&maxResults=200`;
}

/** Fetches the open child issues that will be remapped from one feature to the next. */
export async function fetchFeatureRemapCandidateIssues(
  projectKey: string,
  sourceFeatureKey: string,
): Promise<FeatureRemapCandidateIssue[]> {
  const featureRemapSettings = readFeatureRemapSettings();
  const searchPath = buildFeatureRemapSearchPath(
    projectKey,
    sourceFeatureKey,
    featureRemapSettings.featureLinkField,
    featureRemapSettings.piFieldId,
  );
  const searchResponse = await jiraGet<JiraSearchResponse>(searchPath);

  return (searchResponse.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    statusName: issue.fields.status.name,
    issueTypeName: issue.fields.issuetype.name,
    currentFeatureKey: extractFeatureKeyFromIssue(issue, featureRemapSettings.featureLinkField),
    currentPiValue: readProgramIncrementValueFromIssue(issue, featureRemapSettings.piFieldId),
  }));
}

/** Loads the prior/current PI names and their feature lists for the Team Dashboard carryover remap picker. */
export async function fetchFeatureRemapPiOptions(
  projectKey: string,
  selectedPiName: string,
): Promise<FeatureRemapPiOptions> {
  const featureRemapSettings = readFeatureRemapSettings();
  const sortedPiNames = await fetchProjectPiNames(projectKey, featureRemapSettings.piFieldId);
  const currentPiName = findPiNameForDate(sortedPiNames) ?? (selectedPiName.trim() || sortedPiNames[0] || '');
  const priorPiName = readPriorPiName(sortedPiNames, currentPiName);
  const [priorPiFeatures, currentPiFeatures] = await Promise.all([
    fetchPiFeatureOptions(projectKey, priorPiName, featureRemapSettings),
    fetchPiFeatureOptions(projectKey, currentPiName, featureRemapSettings),
  ]);

  return {
    currentPiName,
    priorPiName,
    currentPiFeatures,
    priorPiFeatures,
  };
}

/** Updates every matched issue so both the feature link and Program Increment move together. */
export async function executeFeatureRemap(
  issuesToMove: readonly FeatureRemapCandidateIssue[],
  targetFeatureKey: string,
): Promise<FeatureRemapExecutionResult> {
  if (issuesToMove.length === 0) {
    return {
      movedIssueKeys: [],
      failedIssueKeys: [],
      failureMessages: [],
      targetPiValue: '',
    };
  }

  const featureRemapSettings = readFeatureRemapSettings();
  const normalizedTargetFeatureKey = targetFeatureKey.trim().toUpperCase();
  const targetFeatureIssue = await fetchIssueByKey(normalizedTargetFeatureKey, [
    'summary',
    featureRemapSettings.piFieldId,
    DEFAULT_PI_FIELD_ID,
  ]);
  const targetPiValue = readProgramIncrementValueFromIssue(targetFeatureIssue, featureRemapSettings.piFieldId).trim();
  if (targetPiValue === '') {
    throw new Error(`The new feature ${normalizedTargetFeatureKey} does not have a Program Increment value to copy.`);
  }

  const editMetaResponse = await fetchPiFieldEditMeta(issuesToMove[0].key);
  const piFieldUpdateValue = resolvePiFieldUpdateValue(
    editMetaResponse.fields?.[featureRemapSettings.piFieldId],
    targetPiValue,
  );

  const updateResults = await Promise.allSettled(
    issuesToMove.map(async (issue) => {
      await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issue.key)}`, {
        fields: {
          ...buildFeatureFieldUpdateFields(featureRemapSettings.featureLinkField, targetFeatureKey.trim().toUpperCase()),
          [featureRemapSettings.piFieldId]: piFieldUpdateValue,
        },
      });
      return issue.key;
    }),
  );

  return updateResults.reduce<FeatureRemapExecutionResult>(
    (executionResult, updateResult, issueIndex) => {
      if (updateResult.status === 'fulfilled') {
        return {
          ...executionResult,
          movedIssueKeys: [...executionResult.movedIssueKeys, updateResult.value],
        };
      }

      const failedIssueKey = issuesToMove[issueIndex]?.key ?? `Issue ${issueIndex + 1}`;
      return {
        movedIssueKeys: executionResult.movedIssueKeys,
        failedIssueKeys: [...executionResult.failedIssueKeys, failedIssueKey],
        failureMessages: [
          ...executionResult.failureMessages,
          `${failedIssueKey}: ${updateResult.reason instanceof Error ? updateResult.reason.message : String(updateResult.reason)}`,
        ],
        targetPiValue: executionResult.targetPiValue,
      };
    },
    {
      movedIssueKeys: [],
      failedIssueKeys: [],
      failureMessages: [],
      targetPiValue,
    },
  );
}

/** Resolves the safest PI field payload shape by preferring Jira edit metadata when it is available. */
export function resolvePiFieldUpdateValue(editMetaField: JiraEditMetaField | undefined, targetPiValue: string): unknown {
  const trimmedTargetPiValue = targetPiValue.trim();
  const matchedAllowedValue = editMetaField?.allowedValues?.find((allowedValue) =>
    allowedValue.value === trimmedTargetPiValue || allowedValue.name === trimmedTargetPiValue
  );
  if (matchedAllowedValue) {
    if (editMetaField?.schema?.type === 'string') {
      return matchedAllowedValue.value ?? matchedAllowedValue.name ?? trimmedTargetPiValue;
    }

    return { value: matchedAllowedValue.value ?? matchedAllowedValue.name ?? trimmedTargetPiValue };
  }

  if (editMetaField?.schema?.type === 'string') {
    return trimmedTargetPiValue;
  }

  return { value: trimmedTargetPiValue };
}
