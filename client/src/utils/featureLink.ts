// featureLink.ts — Single source for resolving a Jira issue's parent-feature link, the blueprint's way.
//
// In this Jira model a child issue (story/bug/task) is linked to its parent FEATURE through a custom
// "Feature Link" field — NOT the native `parent` field — with the classic Epic Link as a fallback. The
// Art View blueprint established this resolution (configurable field id + candidate order + value shape
// handling); this module is the shared implementation so every surface (blueprint, reports) links a child
// to its feature identically instead of re-deriving it.

// This module is bundled into the SERVER engine (monthlyDeliveryEngine.entry.ts), so it must stay
// free of anything browser-only at import time. The field id therefore comes from the mapping module
// lazily, inside the function that needs it, never as a module-level constant read at load.
import { resolveWriteFieldId } from '../services/jiraFieldMapping.ts';

/**
 * Default "Feature Link" custom field id.
 *
 * @deprecated Resolved by `services/jiraFieldMapping.ts`. Kept only so the server engine bundle's
 * existing export surface keeps compiling; it is no longer the source of the answer.
 */
export const FEATURE_LINK_DEFAULT_FIELD = 'customfield_10108';

/** Classic Jira "Epic Link" custom field id — the fallback candidate when the Feature Link field is unset. */
export const EPIC_LINK_FIELD = 'customfield_10014';

/** A linked-issue field value from Jira, which may be a bare key string or an object carrying the key. */
interface LinkedIssueValue {
  key?: string;
  data?: { key?: string };
  inwardIssue?: { key?: string };
}

/** The issue-fields shape needed to resolve a feature key: any dynamic custom field plus the native parent. */
export interface FeatureLinkFields {
  parent?: { key?: string } | null;
  [fieldId: string]: unknown;
}

/**
 * Reads the configured feature-link field id from the ART advanced settings, falling back to the default
 * when unset or when the store is missing/corrupt. Mirrors how the story-points field id is resolved.
 */
export function loadConfiguredFeatureLinkFieldId(): string {
  // Guarded because this module runs server-side too, where there is no localStorage and the
  // configured override simply does not exist. The mapping's default is the right answer there.
  if (typeof localStorage === 'undefined') {
    return FEATURE_LINK_DEFAULT_FIELD;
  }
  return resolveWriteFieldId('featureLinkField', localStorage);
}

/** The ordered, de-duplicated list of custom field ids to try when reading an issue's feature link. */
export function featureLinkCandidateFieldIds(featureLinkField: string): string[] {
  return Array.from(new Set([featureLinkField, FEATURE_LINK_DEFAULT_FIELD, EPIC_LINK_FIELD].filter(Boolean)));
}

/**
 * Pulls the linked feature's issue key out of a raw field value, tolerating the three shapes Jira returns
 * a link field as: a bare "KEY-123" string, or an object exposing the key via `.key`, `.data.key`, or
 * `.inwardIssue.key`. Returns null when the value holds no recognisable key.
 */
export function extractIssueKeyFromLinkValue(rawValue: unknown): string | null {
  if (typeof rawValue === 'string' && rawValue.includes('-')) {
    return rawValue;
  }
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }
  const linkedIssueValue = rawValue as LinkedIssueValue;
  return linkedIssueValue.key ?? linkedIssueValue.data?.key ?? linkedIssueValue.inwardIssue?.key ?? null;
}

/**
 * Resolves the parent-feature key for one issue: it tries each feature-link candidate field in order and
 * uses the first that yields a key, falling back to the native `parent` only when no link field is set.
 * This matches the blueprint's per-issue feature resolution so the two never diverge.
 */
export function extractFeatureKeyFromIssueFields(fields: FeatureLinkFields, featureLinkField: string): string | null {
  for (const fieldId of featureLinkCandidateFieldIds(featureLinkField)) {
    const linkedIssueKey = extractIssueKeyFromLinkValue(fields[fieldId]);
    if (linkedIssueKey) {
      return linkedIssueKey;
    }
  }
  return fields.parent?.key ?? null;
}
