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

/** Saves child-story points from Feature Review using the configured ART story-points field. */
export async function saveFeatureReviewStoryPoints(issueKey: string, storyPointsValue: string): Promise<void> {
  const numericStoryPoints = Number(storyPointsValue);
  const primaryStoryPointsFieldId = readStoredStoryPointsFieldId();

  try {
    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        [primaryStoryPointsFieldId]: numericStoryPoints,
      },
    });
  } catch (caughtError) {
    if (primaryStoryPointsFieldId === FALLBACK_STORY_POINTS_FIELD_ID) {
      throw caughtError;
    }

    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        [FALLBACK_STORY_POINTS_FIELD_ID]: numericStoryPoints,
      },
    });
  }
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
