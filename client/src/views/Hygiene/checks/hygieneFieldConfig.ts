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

/**
 * The Program Increment custom field id an admin configured, or the platform default.
 *
 * Every JQL that scopes work by PI must derive its field from here. Hardcoding `cf[10301]`
 * (the old behavior) meant a team whose PI lives in a different field got an empty scope —
 * which the Hygiene view then rendered as a perfect score (GH #167).
 */
export function readConfiguredPiFieldId(): string {
  return readHygieneArtSettings().piFieldId || DEFAULT_PI_FIELD_ID;
}

/** Converts a `customfield_N` id into its JQL `cf[N]` reference; other ids pass through (quoted if spaced). */
export function buildJqlFieldReference(fieldId: string): string {
  const customFieldMatch = /^customfield_(\d+)$/.exec(fieldId);
  if (customFieldMatch) {
    return `cf[${customFieldMatch[1]}]`;
  }

  return fieldId.includes(' ') ? `"${fieldId}"` : fieldId;
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
  const configuredFeatureLinkField = artSettings.featureLinkField || DEFAULT_FEATURE_LINK_FIELD;

  const resolvedConfig = resolveHygieneFieldConfig({
    acceptanceCriteriaFieldIds: matchFieldIdsByName(availableFields, ['Acceptance Criteria']),
    applicationFieldIds: matchFieldIdsByName(availableFields, ['Application']),
    featureLinkFieldIds: [
      configuredFeatureLinkField,
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
    // 021 Readiness families — configured-only (no default), so an instance lacking them resolves
    // to [] and the Readiness tab shows "not checked — no matching field" rather than false alerts.
    estimateFieldIds: matchFieldIdsByName(availableFields, ['Estimate (NF)', 'Estimate']),
    pcodeFieldIds: matchFieldIdsByName(availableFields, ['Spark ID/PCode', 'Spark ID', 'PCode']),
  });

  // Feature-link ids are the one list used to BUILD JQL (the child-story rollup), so it must hold
  // only fields this instance can actually query. Jira 400s a JQL clause naming a field that does
  // not exist here or is registry-only (not searchable) — and the resolver merges in platform
  // DEFAULTS (e.g. customfield_10014) that may be neither, which used to kill the whole hygiene
  // run (GH #167). The admin's explicitly configured field is trusted as-is; 'parent' is native.
  // Reading a field off an issue has no such restriction, so the other lists stay unfiltered.
  const searchableFieldIds = new Set(
    availableFields
      .filter((availableField) => availableField.searchable !== false)
      .map((availableField) => availableField.id),
  );
  // Only a field the admin explicitly set bypasses the instance check — our own fallback default
  // gets no such trust, because "we guessed it" is exactly how a nonexistent field reaches JQL.
  const adminConfiguredFeatureLinkField = artSettings.featureLinkField || '';
  return {
    ...resolvedConfig,
    featureLinkFieldIds: resolvedConfig.featureLinkFieldIds.filter((fieldId) =>
      fieldId === 'parent' || fieldId === adminConfiguredFeatureLinkField || searchableFieldIds.has(fieldId),
    ),
  };
}
