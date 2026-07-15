// hygieneFieldConfig.ts — Resolves which Jira fields the hygiene checks should read on THIS instance.
//
// Hygiene rules are written in terms of ideas ("target start date", "product owner"), but every Jira
// instance stores those in differently-numbered custom fields. This module bridges the two: it asks the
// live instance for its field list, matches fields by NAME, and layers the workspace's configured ids on
// top. That is what lets a check skip itself when a field simply does not exist here, instead of
// reporting every issue as broken.
//
// This lives in its own module (rather than inside the Hygiene view's state hook, where it began) so any
// surface that evaluates hygiene can obtain a real config. The alternative — each caller reimplementing
// the name-matching — would drift, and drifting hygiene rules is a problem this codebase already has.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraField } from '../../../types/jira.ts';
import { resolveHygieneFieldConfig, type HygieneFieldConfig } from './hygieneChecks.ts';

/** Where the ART workspace keeps the field ids an admin configured by hand. */
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';

// Fallbacks used when the workspace has not configured a field explicitly. They are only a starting
// point — whatever the live instance reports by name is layered on top.
const DEFAULT_FEATURE_LINK_FIELD = 'customfield_10108';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const DEFAULT_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_TARGET_END_FIELD_ID = 'customfield_10102';

/** The subset of ART workspace settings that name hygiene-relevant fields. */
export interface HygieneArtSettings {
  featureLinkField?: string;
  piFieldId?: string;
  piReviewTargetStartFieldId?: string;
  piReviewTargetEndFieldId?: string;
}

/** Reads the workspace's configured field ids; an unreadable blob means "nothing configured". */
export function readHygieneArtSettings(): HygieneArtSettings {
  try {
    return JSON.parse(window.localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as HygieneArtSettings;
  } catch {
    return {};
  }
}

/** Field names differ only by spacing and case between instances, so compare them normalised. */
function normalizeFieldName(fieldName: string): string {
  return fieldName.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Finds the ids of every instance field whose name matches (or contains) one of the given names.
 *
 * Substring matching is deliberate: instances label the same concept "PI", "Program Increment", or
 * "PI (Program Increment)", and a check should find the field in all three cases.
 */
export function matchFieldIdsByName(availableFields: JiraField[], fieldNames: string[]): string[] {
  const normalizedFieldNames = fieldNames.map((fieldName) => normalizeFieldName(fieldName));
  return availableFields
    .filter((availableField) => {
      const normalizedAvailableFieldName = normalizeFieldName(availableField.name);
      return normalizedFieldNames.some((normalizedFieldName) => normalizedAvailableFieldName === normalizedFieldName || normalizedAvailableFieldName.includes(normalizedFieldName));
    })
    .map((availableField) => availableField.id);
}

/**
 * Builds the hygiene field config for the connected Jira instance.
 *
 * Configured ids come first so an admin's explicit choice outranks a name guess. Fields the instance
 * does not have simply resolve to an empty list, which is how a check knows to skip itself rather than
 * flag every issue for a field nobody uses.
 */
export async function loadHygieneFieldConfig(): Promise<HygieneFieldConfig> {
  const availableFields = await jiraGet<JiraField[]>('/rest/api/2/field');
  const artSettings = readHygieneArtSettings();

  return resolveHygieneFieldConfig({
    acceptanceCriteriaFieldIds: matchFieldIdsByName(availableFields, ['Acceptance Criteria']),
    applicationFieldIds: matchFieldIdsByName(availableFields, ['Application']),
    featureLinkFieldIds: [
      artSettings.featureLinkField || DEFAULT_FEATURE_LINK_FIELD,
      ...matchFieldIdsByName(availableFields, ['Feature Link', 'Epic Link']),
    ],
    initiativeTypeFieldIds: matchFieldIdsByName(availableFields, ['Initiative Type']),
    parentLinkFieldIds: ['parent', ...matchFieldIdsByName(availableFields, ['Parent Link'])],
    productOwnerFieldIds: matchFieldIdsByName(availableFields, ['Product Owner']),
    programIncrementFieldIds: [
      artSettings.piFieldId || DEFAULT_PI_FIELD_ID,
      ...matchFieldIdsByName(availableFields, ['PI', 'Program Increment']),
    ],
    targetStartFieldIds: [
      artSettings.piReviewTargetStartFieldId || DEFAULT_TARGET_START_FIELD_ID,
      ...matchFieldIdsByName(availableFields, ['Target Start']),
    ],
    targetEndFieldIds: [
      artSettings.piReviewTargetEndFieldId || DEFAULT_TARGET_END_FIELD_ID,
      ...matchFieldIdsByName(availableFields, ['Target End']),
    ],
  });
}
