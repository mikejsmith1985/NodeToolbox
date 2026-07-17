// featureReviewFixes.ts — Jira mutation helpers that power direct hygiene fixes inside Team Dashboard Feature Review.

import { jiraGet, jiraPost, jiraPut } from '../../services/jiraApi.ts';
import type { JiraIssue, JiraTransition } from '../../types/jira.ts';

const DEFAULT_STORY_POINTS_FIELD_ID = 'customfield_10028';
const FALLBACK_STORY_POINTS_FIELD_ID = 'customfield_10016';
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const MAX_FEATURE_REVIEW_USER_RESULTS = 8;
const LEGACY_JIRA_USER_SEARCH_HINT = 'username query parameter was not provided';

interface StoredArtSettings {
  spFieldId?: string;
}

export interface FeatureReviewEditMetaAllowedValue {
  accountId?: string;
  displayName?: string;
  id?: string;
  key?: string;
  name?: string;
  value?: string;
}

export interface FeatureReviewEditMetaField {
  allowedValues?: FeatureReviewEditMetaAllowedValue[];
  /** Jira's human name for the field — how a project's non-standard story-points field is found. */
  name?: string;
  schema?: {
    items?: string;
    type?: string;
  };
}

interface FeatureReviewEditMetaResponse {
  fields?: Record<string, FeatureReviewEditMetaField | undefined>;
}

export interface FeatureReviewSelectOption {
  label: string;
  value: string;
}

export interface FeatureReviewUserCandidate {
  userIdentifier: string;
  displayName: string;
}

interface FeatureReviewVersionResponseItem {
  id?: string;
  name?: string;
}

interface FeatureReviewRawUserCandidate {
  accountId?: string;
  displayName?: string;
  key?: string;
  name?: string;
}

function readStoredStoryPointsFieldId(): string {
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as StoredArtSettings;
    return storedSettings.spFieldId?.trim() || DEFAULT_STORY_POINTS_FIELD_ID;
  } catch {
    return DEFAULT_STORY_POINTS_FIELD_ID;
  }
}

function createFeatureReviewUserSearchPath(queryText: string, shouldUseLegacyUsername: boolean): string {
  const userQueryParameterName = shouldUseLegacyUsername ? 'username' : 'query';
  return `/rest/api/2/user/search?${userQueryParameterName}=${encodeURIComponent(queryText)}&maxResults=${MAX_FEATURE_REVIEW_USER_RESULTS}`;
}

function isLegacyJiraUserSearchError(caughtError: unknown): boolean {
  return caughtError instanceof Error
    && caughtError.message.toLowerCase().includes(LEGACY_JIRA_USER_SEARCH_HINT);
}

function readFeatureReviewUserIdentifier(userCandidate: FeatureReviewRawUserCandidate): string {
  if (userCandidate.accountId?.trim()) {
    return `accountId:${userCandidate.accountId.trim()}`;
  }

  if (userCandidate.name?.trim()) {
    return `name:${userCandidate.name.trim()}`;
  }

  if (userCandidate.key?.trim()) {
    return `key:${userCandidate.key.trim()}`;
  }

  return '';
}

function normalizeFeatureReviewUserCandidates(userCandidates: FeatureReviewRawUserCandidate[]): FeatureReviewUserCandidate[] {
  return userCandidates
    .map((userCandidate) => ({
      displayName: userCandidate.displayName?.trim()
        || userCandidate.name?.trim()
        || userCandidate.key?.trim()
        || userCandidate.accountId?.trim()
        || '',
      userIdentifier: readFeatureReviewUserIdentifier(userCandidate),
    }))
    .filter((userCandidate) => userCandidate.userIdentifier !== '' && userCandidate.displayName !== '');
}

function buildFeatureReviewUserPayload(userIdentifier: string): { accountId: string } | { key: string } | { name: string } {
  const [identifierType, ...identifierValueParts] = userIdentifier.split(':');
  const identifierValue = identifierValueParts.join(':').trim();
  if (identifierType === 'accountId' && identifierValue !== '') {
    return { accountId: identifierValue };
  }

  if (identifierType === 'key' && identifierValue !== '') {
    return { key: identifierValue };
  }

  if (identifierType === 'name' && identifierValue !== '') {
    return { name: identifierValue };
  }

  const trimmedUserIdentifier = userIdentifier.trim();
  if (trimmedUserIdentifier !== '' && !trimmedUserIdentifier.includes(':')) {
    return { accountId: trimmedUserIdentifier };
  }

  throw new Error('Select a Jira user before saving.');
}

function buildOptionPayload(
  editMetaField: FeatureReviewEditMetaField | undefined,
  selectedValue: string,
): FeatureReviewEditMetaAllowedValue | string {
  const matchedAllowedValue = editMetaField?.allowedValues?.find((allowedValue) =>
    [
      allowedValue.id,
      allowedValue.value,
      allowedValue.name,
      allowedValue.key,
      allowedValue.accountId,
      allowedValue.displayName,
    ].some((candidateValue) => candidateValue === selectedValue),
  );

  if (!matchedAllowedValue) {
    return selectedValue;
  }

  if (matchedAllowedValue.id) {
    return { id: matchedAllowedValue.id };
  }

  if (matchedAllowedValue.value) {
    return { value: matchedAllowedValue.value };
  }

  if (matchedAllowedValue.name) {
    return { name: matchedAllowedValue.name };
  }

  if (matchedAllowedValue.key) {
    return { key: matchedAllowedValue.key };
  }

  return selectedValue;
}

/** Loads Jira edit metadata so Feature Review can render the right direct-fix controls for custom fields. */
export async function fetchFeatureReviewEditMeta(issueKey: string): Promise<Record<string, FeatureReviewEditMetaField | undefined>> {
  const editMetaResponse = await jiraGet<FeatureReviewEditMetaResponse>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/editmeta`,
  );
  return editMetaResponse.fields ?? {};
}

/** Converts Jira editmeta allowed values into simple select options for Feature Review quick fixes. */
export function readFeatureReviewSelectOptions(
  editMetaField: FeatureReviewEditMetaField | undefined,
): FeatureReviewSelectOption[] {
  return (editMetaField?.allowedValues ?? [])
    .map((allowedValue) => {
      const optionValue = allowedValue.id
        ?? allowedValue.value
        ?? allowedValue.name
        ?? allowedValue.key
        ?? allowedValue.accountId
        ?? '';
      const optionLabel = allowedValue.displayName
        ?? allowedValue.value
        ?? allowedValue.name
        ?? allowedValue.key
        ?? optionValue;

      return {
        label: optionLabel,
        value: optionValue,
      };
    })
    .filter((selectOption) => selectOption.value.trim() !== '' && selectOption.label.trim() !== '');
}

/** Searches Jira users for assignee-style quick fixes in Feature Review. */
export async function searchFeatureReviewUsers(queryText: string): Promise<FeatureReviewUserCandidate[]> {
  const trimmedQueryText = queryText.trim();
  if (!trimmedQueryText) {
    return [];
  }

  try {
    const userSearchResults = await jiraGet<FeatureReviewRawUserCandidate[]>(
      createFeatureReviewUserSearchPath(trimmedQueryText, false),
    );
    return normalizeFeatureReviewUserCandidates(userSearchResults ?? []);
  } catch (caughtError) {
    if (!isLegacyJiraUserSearchError(caughtError)) {
      throw caughtError;
    }

    const legacyUserSearchResults = await jiraGet<FeatureReviewRawUserCandidate[]>(
      createFeatureReviewUserSearchPath(trimmedQueryText, true),
    );
    return normalizeFeatureReviewUserCandidates(legacyUserSearchResults ?? []);
  }
}

/** Loads the available fix versions for the Jira project that owns the feature. */
export async function fetchFeatureReviewFixVersions(projectKey: string): Promise<FeatureReviewSelectOption[]> {
  const versionResults = await jiraGet<FeatureReviewVersionResponseItem[]>(
    `/rest/api/2/project/${encodeURIComponent(projectKey.trim().toUpperCase())}/versions`,
  );
  return (versionResults ?? [])
    .map((versionResult) => ({
      label: versionResult.name?.trim() ?? '',
      value: versionResult.name?.trim() ?? '',
    }))
    .filter((versionOption) => versionOption.value !== '');
}

/** Loads the workflow transitions Feature Review can offer for a Jira feature. */
export async function fetchFeatureReviewTransitions(issueKey: string): Promise<JiraTransition[]> {
  const transitionResponse = await jiraGet<{ transitions?: JiraTransition[] }>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
  );
  return transitionResponse.transitions ?? [];
}

/** Saves a plain text or date Jira field from the Feature Review quick-fix panel. */
export async function saveFeatureReviewSimpleField(issueKey: string, fieldId: string, value: string): Promise<void> {
  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    fields: {
      [fieldId]: value,
    },
  });
}

/** Saves a Jira select-style field by resolving the matching allowed value from edit metadata. */
export async function saveFeatureReviewOptionField(
  issueKey: string,
  fieldId: string,
  selectedValue: string,
  editMetaField: FeatureReviewEditMetaField | undefined,
): Promise<void> {
  const optionPayload = buildOptionPayload(editMetaField, selectedValue);
  const resolvedPayload = editMetaField?.schema?.type === 'array' ? [optionPayload] : optionPayload;

  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    fields: {
      [fieldId]: resolvedPayload,
    },
  });
}

/** Saves a Jira user field such as assignee or product owner from a selected account ID. */
export async function saveFeatureReviewUserField(issueKey: string, fieldId: string, userIdentifier: string): Promise<void> {
  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    fields: {
      [fieldId]: buildFeatureReviewUserPayload(userIdentifier),
    },
  });
}

/** Saves a Jira workflow transition from the Feature Review quick-fix panel. */
export async function saveFeatureReviewTransition(issueKey: string, transitionId: string): Promise<void> {
  if (transitionId.trim() === '') {
    throw new Error('Select a Jira transition before saving.');
  }

  await jiraPost<void>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: transitionId.trim() },
  });
}

/** Saves a feature-link or parent-link style issue reference from a Jira key entered in Feature Review. */
export async function saveFeatureReviewIssueLinkField(issueKey: string, fieldId: string, linkedIssueKey: string): Promise<void> {
  const normalizedIssueKey = linkedIssueKey.trim().toUpperCase();
  if (fieldId === 'parent') {
    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        parent: { key: normalizedIssueKey },
      },
    });
    return;
  }

  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    fields: {
      [fieldId]: normalizedIssueKey,
    },
  });
}

/** Saves a feature fix version by name using Jira's update-set payload shape. */
export async function saveFeatureReviewFixVersion(issueKey: string, versionName: string): Promise<void> {
  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    update: {
      fixVersions: [
        {
          set: versionName.trim() ? [{ name: versionName.trim() }] : [],
        },
      ],
    },
  });
}

/** How a project's own story-points field is recognised when none of the standard ids is editable. */
const STORY_POINTS_FIELD_NAME_PATTERN = /story\s*points?/i;

/**
 * Saves story points to the field this issue can actually accept.
 *
 * Projects differ: the configured/standard ids (ART setting, customfield_10028, customfield_10016)
 * may not be on an issue's edit screen at all — blind writes then fail with Jira's "cannot be set;
 * not on the appropriate screen" 400 (seen on GH #167). The issue's edit metadata is the truth of
 * what is settable, so the write targets the first standard candidate the screen carries, falling
 * back to any editable field NAMED like story points, and otherwise fails with a readable message
 * instead of a screen error.
 */
export async function saveFeatureReviewStoryPoints(issueKey: string, storyPointsValue: string): Promise<void> {
  const numericStoryPoints = Number(storyPointsValue);
  const editMetaFields = await fetchFeatureReviewEditMeta(issueKey);

  const candidateFieldIds = [
    readStoredStoryPointsFieldId(),
    DEFAULT_STORY_POINTS_FIELD_ID,
    FALLBACK_STORY_POINTS_FIELD_ID,
  ];
  const editableCandidate = candidateFieldIds.find((fieldId) => editMetaFields[fieldId] !== undefined);
  const namedStoryPointsField = editableCandidate
    ? undefined
    : Object.entries(editMetaFields).find(([, editMetaField]) =>
        STORY_POINTS_FIELD_NAME_PATTERN.test(editMetaField?.name ?? ''),
      )?.[0];

  const targetFieldId = editableCandidate ?? namedStoryPointsField;
  if (!targetFieldId) {
    throw new Error(
      'No story-points field is editable on this issue (checked the configured and standard fields, '
      + 'and no editable field is named like story points). Set the points in Jira directly.',
    );
  }

  await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
    fields: {
      [targetFieldId]: buildStoryPointsPayload(editMetaFields[targetFieldId], storyPointsValue, numericStoryPoints),
    },
  });
}

/**
 * Builds the write payload for the chosen story-points field.
 *
 * Most projects model story points as a plain number, but some use a DROPDOWN (a Jira Select
 * field whose options are "1", "2", "3", …). A dropdown rejects a raw number with Jira's
 * "Could not find valid 'id' or 'value' in the Parent Option object" 400 — it must be written
 * as the matching allowed OPTION object instead. Edit metadata tells the two apart: a dropdown
 * carries allowedValues; a numeric field does not.
 */
function buildStoryPointsPayload(
  editMetaField: FeatureReviewEditMetaField | undefined,
  storyPointsText: string,
  numericStoryPoints: number,
): number | { id: string } | { value: string } {
  const allowedValues = editMetaField?.allowedValues ?? [];
  if (allowedValues.length === 0) {
    return numericStoryPoints;
  }

  // Match by exact option label first, then numerically so "3" finds an option labelled "3.0".
  const trimmedStoryPointsText = storyPointsText.trim();
  const matchedOption = allowedValues.find((allowedValue) => {
    const optionLabel = (allowedValue.value ?? allowedValue.name ?? '').trim();
    if (optionLabel === '') return false;
    if (optionLabel === trimmedStoryPointsText) return true;
    const numericOptionLabel = Number(optionLabel);
    return Number.isFinite(numericOptionLabel) && numericOptionLabel === numericStoryPoints;
  });

  if (!matchedOption) {
    const availableOptionLabels = allowedValues
      .map((allowedValue) => allowedValue.value ?? allowedValue.name ?? allowedValue.id ?? '')
      .filter((optionLabel) => optionLabel !== '')
      .join(', ');
    throw new Error(
      `This project's story-points field is a dropdown with no option matching "${trimmedStoryPointsText}". `
      + `Pick one of its options instead: ${availableOptionLabels}.`,
    );
  }

  if (matchedOption.id) {
    return { id: matchedOption.id };
  }
  return { value: (matchedOption.value ?? matchedOption.name ?? trimmedStoryPointsText).trim() };
}

/**
 * Reads the story points an issue currently shows, checking the configured field first and then
 * the standard fields. Dropdown-style fields store an option object — its label is returned, so
 * a team whose points live in a Select field sees the value instead of a blank input.
 */
export function readIssueStoryPointsDisplayValue(issue: { fields: Record<string, unknown> }): string {
  const candidateFieldIds = [
    readStoredStoryPointsFieldId(),
    DEFAULT_STORY_POINTS_FIELD_ID,
    FALLBACK_STORY_POINTS_FIELD_ID,
  ];
  for (const fieldId of candidateFieldIds) {
    const rawFieldValue = issue.fields[fieldId];
    if (rawFieldValue === null || rawFieldValue === undefined || rawFieldValue === '') continue;
    if (typeof rawFieldValue === 'number' || typeof rawFieldValue === 'string') {
      return String(rawFieldValue);
    }
    if (typeof rawFieldValue === 'object' && !Array.isArray(rawFieldValue)) {
      const optionRecord = rawFieldValue as { value?: string; name?: string };
      const optionLabel = optionRecord.value ?? optionRecord.name;
      if (optionLabel) return String(optionLabel);
    }
  }
  return '';
}

/** Reads the Jira project key from an issue key such as DENP-1370. */
export function readProjectKeyFromIssueKey(issueKey: string): string {
  return issueKey.split('-', 1)[0]?.trim().toUpperCase() ?? '';
}

/** Normalizes the current text value from a Jira field so fix inputs start with readable text. */
export function readFeatureReviewFieldValue(issue: JiraIssue, fieldId: string): string {
  const rawFieldValue = (issue.fields as Record<string, unknown>)[fieldId];
  if (typeof rawFieldValue === 'string') {
    return rawFieldValue;
  }

  if (Array.isArray(rawFieldValue)) {
    return rawFieldValue
      .map((entryValue) => {
        if (typeof entryValue === 'string') {
          return entryValue;
        }

        if (entryValue && typeof entryValue === 'object') {
          const selectableValue = entryValue as FeatureReviewEditMetaAllowedValue;
          return selectableValue.displayName
            ?? selectableValue.value
            ?? selectableValue.name
            ?? selectableValue.key
            ?? selectableValue.id
            ?? '';
        }

        return '';
      })
      .filter(Boolean)
      .join(', ');
  }

  if (rawFieldValue && typeof rawFieldValue === 'object') {
    const selectableValue = rawFieldValue as FeatureReviewEditMetaAllowedValue;
    return selectableValue.displayName
      ?? selectableValue.value
      ?? selectableValue.name
      ?? selectableValue.key
      ?? selectableValue.id
      ?? '';
  }

  return '';
}
