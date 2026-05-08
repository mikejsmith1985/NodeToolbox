// myIssuesExtendedTypes.ts — Extended field types used only within the My Issues view.
//
// The shared JiraIssue type covers only the fields needed by most views.
// My Issues fetches additional fields (duedate, labels, components, etc.) from Jira.
// These types let the My Issues components use those extra fields with type safety
// without modifying the shared type used by the rest of the app.

import type { JiraUser } from '../../types/jira.ts';

// ── Extended field shapes ──

/** All issue fields fetched by the My Issues API call. */
export interface ExtendedIssueFields {
  summary: string;
  status: { name: string; statusCategory: { key: string } };
  priority: { name: string; iconUrl: string } | null;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  issuetype: { name: string; iconUrl: string };
  created: string;
  updated: string;
  description: string | null;
  duedate?: string | null;
  labels?: string[];
  components?: Array<{ name: string }>;
  fixVersions?: Array<{ name: string }>;
  /** Story-point estimate (standard custom field). */
  customfield_10016?: number | null;
  /** Story-point estimate (alternate custom field used by some Jira instances). */
  customfield_10028?: number | null;
  /** Sprint metadata array returned by the Agile API. */
  customfield_10020?: Array<{ id: number; name: string; state: string }> | null;
  /** Epic link custom field. */
  customfield_10014?: string | null;
}

/** A Jira issue augmented with the full set of My Issues fields. */
export interface ExtendedJiraIssue {
  id: string;
  key: string;
  fields: ExtendedIssueFields;
}

// ── Board quick filter shape ──

/** A quick-filter chip returned by /rest/agile/1.0/board/{id}/quickfilter. */
export interface JiraBoardQuickFilter {
  id: number;
  name: string;
  jql: string;
}

// ── Attention reason helpers ──

/** The reason keys that explain why an issue needs attention. */
export type AttentionReason = 'Blocked' | 'Critical Priority' | 'Past Due';

/** Named thresholds for issue aging (in days). */
export const AGING_WARN_THRESHOLD_DAYS = 5;
export const AGING_STALE_THRESHOLD_DAYS = 10;
export const STALE_SM_THRESHOLD_DAYS = 3;

/**
 * Computes the list of reasons why an issue belongs in the "Needs Attention" swimlane.
 * Returns an empty array when the issue does not need attention.
 */
export function computeAttentionReasons(issue: ExtendedJiraIssue): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const statusNameLower = issue.fields.status.name.toLowerCase();
  const priorityNameLower = (issue.fields.priority?.name ?? '').toLowerCase();

  const isBlocked =
    statusNameLower.includes('block') ||
    statusNameLower.includes('impede') ||
    statusNameLower.includes('hold');

  const isCriticalPriority =
    priorityNameLower === 'blocker' ||
    priorityNameLower === 'critical' ||
    priorityNameLower === 'highest';

  const isPastDue =
    !!issue.fields.duedate && new Date(issue.fields.duedate) < new Date();

  if (isBlocked) reasons.push('Blocked');
  if (isCriticalPriority) reasons.push('Critical Priority');
  if (isPastDue) reasons.push('Past Due');

  return reasons;
}

/** Classifies an issue into one of the five swimlane zones. */
export function classifyIssueZone(
  issue: ExtendedJiraIssue,
): 'attn' | 'inrev' | 'inprog' | 'todo' | 'done' {
  if (computeAttentionReasons(issue).length > 0) return 'attn';

  const statusNameLower = issue.fields.status.name.toLowerCase();
  const inReviewStatuses = ['in review', 'code review', 'pr review', 'testing'];
  if (inReviewStatuses.includes(statusNameLower)) return 'inrev';

  const statusCategoryKey = issue.fields.status.statusCategory.key;
  if (statusCategoryKey === 'done') return 'done';
  if (statusCategoryKey === 'new') return 'todo';

  return 'inprog';
}
