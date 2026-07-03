// scopeQuery.ts — Pure helpers for the Feature Canvas Surface scope control.
//
// The user surfaces features by a Jira query. This module builds the default query (pre-filled from
// the active project + PI) and applies fast, client-side refine filters to an already-surfaced set.
// Both are pure and deterministic — no I/O, no AI — so the scope control is fully operable by hand.

import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';

/** JQL clause restricting the default surface to feature-level work items. */
const FEATURE_ISSUE_TYPE_CLAUSE = 'issuetype in (Feature, Epic)';

/** Deterministic refinement applied to the surfaced set (never re-fetches). */
export interface ScopeFilters {
  label: string | null;
  text: string;
  status: string | null;
}

/** A no-op filter set (nothing narrowed). */
export const EMPTY_SCOPE_FILTERS: ScopeFilters = { label: null, text: '', status: null };

/**
 * Builds the default surfacing query from the active project + PI. The PI is targeted by custom-field
 * **id** (`cf[<number>]`) rather than display name, so the default works regardless of what the PI
 * field is named on a given Jira instance. Clauses with no value are omitted.
 */
export function buildDefaultScopeJql(input: { projectKey: string; piName: string; piFieldId: string }): string {
  const trimmedProjectKey = input.projectKey.trim();
  const projectClause = trimmedProjectKey ? `project = "${trimmedProjectKey}"` : '';

  const trimmedPiName = input.piName.trim();
  const piFieldNumber = input.piFieldId.trim().replace('customfield_', '');
  const piClause = trimmedPiName && piFieldNumber ? `cf[${piFieldNumber}] = "${trimmedPiName}"` : '';

  return [projectClause, piClause, FEATURE_ISSUE_TYPE_CLAUSE].filter(Boolean).join(' AND ');
}

/** Reads an issue's Jira labels defensively. */
function readIssueLabels(item: FeatureReviewItem): string[] {
  const labels = (item.featureIssue.fields as { labels?: unknown }).labels;
  return Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string') : [];
}

/**
 * Narrows an already-surfaced set by label / free-text / status. Empty filters are no-ops, and this
 * never fetches — it only filters what is already on screen.
 */
export function applyScopeFilters(items: readonly FeatureReviewItem[], filters: ScopeFilters): FeatureReviewItem[] {
  const normalizedText = filters.text.trim().toLowerCase();
  const normalizedLabel = filters.label?.trim().toLowerCase() ?? '';
  const normalizedStatus = filters.status?.trim().toLowerCase() ?? '';

  return items.filter((item) => {
    if (normalizedText) {
      const haystack = `${item.feature.key} ${item.feature.summary}`.toLowerCase();
      if (!haystack.includes(normalizedText)) {
        return false;
      }
    }
    if (normalizedStatus && item.feature.status.toLowerCase() !== normalizedStatus) {
      return false;
    }
    if (normalizedLabel && !readIssueLabels(item).map((label) => label.toLowerCase()).includes(normalizedLabel)) {
      return false;
    }
    return true;
  });
}
