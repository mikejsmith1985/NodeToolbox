// piFeatureRemap.ts — Helpers for Team Dashboard PI closeout remapping of open child issues between features.

import { jiraGet, jiraPut } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { readArtFeatureScopeSettings } from '../ArtView/artFeatureScopeSettings.ts';
import { findPiNameForDate, parsePiDateRange } from '../ArtView/hooks/artHelpers.ts';

const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_FEATURE_LINK_FIELD = 'customfield_10108';
const DEFAULT_EPIC_LINK_FIELD = 'customfield_10014';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const FEATURE_REMAP_SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'parent'];
// The feature dropdowns list every Feature in a PI; only summary/status/PI are needed to build an option.
const PI_FEATURE_OPTION_FIELDS = ['summary', 'status'];
const PI_FEATURE_OPTION_MAX_RESULTS = 200;
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
  /** Every PI in the project that has Features, newest first — the full list both selectors offer. */
  allPiNames: string[];
  /**
   * The PI to move unplanned work FROM by default: the PI containing today. On closeout that is the
   * PI ending, whose leftover unplanned work rolls forward.
   */
  defaultSourcePiName: string;
  /**
   * The PI to move unplanned work INTO by default: the one AFTER today's PI. Closing out a PI means
   * bucketing its leftovers into the NEXT PI, so this is what makes "I'm on the next PI" the default.
   */
  defaultTargetPiName: string;
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

/** Wraps a JQL value in double quotes, escaping any embedded quotes so the clause stays valid. */
function quoteJqlValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds the JQL that lists every Feature in a PI — the same discovery the PI Review page uses.
 *
 * Deliberately unscoped by project: a team's Features usually live in a portfolio/program project, not
 * the delivery board, so a `project =` clause would silently hide them. The PI value alone scopes the
 * list. Returns null for a blank PI, since that would broaden the query to every Feature in Jira.
 */
export function buildPiFeatureOptionsJql(piName: string, piFieldId: string): string | null {
  const trimmedPiName = piName.trim();
  if (trimmedPiName === '') {
    return null;
  }
  const piFieldReference = buildPiFieldReference(piFieldId);
  return `issuetype = Feature AND ${piFieldReference} = ${quoteJqlValue(trimmedPiName)} ORDER BY key ASC`;
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

/**
 * Lists every Feature in a PI as a remap option, via one direct Jira query. This mirrors the PI Review
 * page's own discovery, so the dropdown offers exactly the Features that page shows for the same PI —
 * including brand-new target Features that have no child issues yet (the bottom-up discovery this
 * replaces missed those, so a fresh target PI showed only the one Feature that already had children).
 */
async function fetchPiFeatureOptions(
  piName: string | null,
  featureRemapSettings: FeatureRemapSettings,
): Promise<FeatureRemapFeatureOption[]> {
  const featureOptionsJql = buildPiFeatureOptionsJql(piName ?? '', featureRemapSettings.piFieldId);
  if (featureOptionsJql === null) {
    return [];
  }

  const searchFields = buildUniqueFieldIds([
    ...PI_FEATURE_OPTION_FIELDS,
    featureRemapSettings.piFieldId,
    DEFAULT_PI_FIELD_ID,
  ]);
  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(featureOptionsJql)}`
    + `&fields=${encodeURIComponent(searchFields.join(','))}`
    + `&maxResults=${PI_FEATURE_OPTION_MAX_RESULTS}`;
  const searchResponse = await jiraGet<JiraSearchResponse>(searchPath);

  return (searchResponse.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: typeof issue.fields?.summary === 'string' ? issue.fields.summary : '',
    piValue: readProgramIncrementValueFromIssue(issue, featureRemapSettings.piFieldId) || (piName ?? ''),
  }));
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
  // The PI containing today — the one closing out, whose leftover unplanned work rolls forward.
  const currentByDatePiName = findPiNameForDate(sortedPiNames) ?? (selectedPiName.trim() || sortedPiNames[0] || '');
  // Closeout buckets that PI's leftovers into the NEXT PI. sortedPiNames is newest-first, so the PI
  // after today's is the one immediately BEFORE it in the list; falling back to today's PI when there
  // is no later one (nothing newer has been planned yet).
  const currentByDateIndex = sortedPiNames.indexOf(currentByDatePiName);
  const defaultTargetPiName = (currentByDateIndex > 0 ? sortedPiNames[currentByDateIndex - 1] : currentByDatePiName) ?? '';

  return {
    allPiNames: sortedPiNames,
    defaultSourcePiName: currentByDatePiName,
    defaultTargetPiName,
  };
}

/**
 * Loads the Features of any chosen PI, so either selector can offer a manually-picked PI's Features.
 *
 * `_projectKey` is kept for call-site symmetry with the other remap helpers but is intentionally
 * unused: Features are discovered by PI alone (see fetchPiFeatureOptions — they often live outside the
 * team's project, so scoping by project key would hide them).
 */
export async function fetchFeaturesForPi(
  _projectKey: string,
  piName: string,
): Promise<FeatureRemapFeatureOption[]> {
  return fetchPiFeatureOptions(piName, readFeatureRemapSettings());
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
