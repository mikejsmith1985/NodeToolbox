// todayCategories.ts — Pure selectors for the Scrum Master "Today" dashboard.
//
// The "Today" tab groups a Scrum Master's daily work into a fixed set of action
// categories (mentions, blockers, stale work, etc.). This module owns ONLY the
// deterministic bucketing logic; it reuses the existing Hygiene rules verbatim so
// the dashboard and the Hygiene tab can never disagree on what counts as unhealthy.
// No new issue-health rule is authored here.

import {
  checkStaleIssue,
  evaluateHygieneIssue,
  type HygieneEvaluationContext,
  type HygieneFinding,
  type JiraIssue,
} from '../../Hygiene/checks/hygieneChecks.ts';

// ── Category catalog ──

/** Stable identifiers for each Scrum Master action category shown on the Today tab. */
export type CategoryId =
  | 'mentions'
  | 'blockers'
  | 'my-stale'
  | 'team-stale'
  | 'unassigned'
  | 'commitment-gaps'
  | 'due-overdue'
  | 'untriaged';

/** Display metadata for a single Today category: its label, emoji icon, and ownership scope. */
export interface CategoryCatalogEntry {
  id: CategoryId;
  label: string;
  icon: string; // emoji
  scope: 'me' | 'team' | 'mixed';
}

/** The eight Today categories in the fixed order the dashboard renders them. */
export const CATEGORY_CATALOG: readonly CategoryCatalogEntry[] = [
  { id: 'mentions', label: 'Respond to mentions', icon: '📨', scope: 'mixed' },
  { id: 'blockers', label: 'Unblock issues', icon: '🚧', scope: 'mixed' },
  { id: 'my-stale', label: 'My stale issues', icon: '⏳', scope: 'me' },
  { id: 'team-stale', label: 'Team stale issues', icon: '🧹', scope: 'team' },
  { id: 'unassigned', label: 'Unassigned in-progress', icon: '👤', scope: 'team' },
  { id: 'commitment-gaps', label: 'Sprint commitment gaps', icon: '📐', scope: 'team' },
  { id: 'due-overdue', label: 'Due / overdue today', icon: '📅', scope: 'mixed' },
  { id: 'untriaged', label: 'Untriaged new issues', icon: '🆕', scope: 'team' },
];

// ── Blocked detection ──

// Status name fragments that mark an issue as needing the team's attention. This mirrors
// MyIssuesView's existing blocked detection so the Today tab agrees with the board pill.
export const ATTENTION_STATUSES: readonly string[] = ['blocked', 'impeded', 'on hold'];

/** Returns true when the issue's status name contains any of the blocked / attention markers. */
export function isBlockedIssue(issue: JiraIssue): boolean {
  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  return ATTENTION_STATUSES.some((attentionStatus) => statusName.includes(attentionStatus));
}

// ── Act-today selectors (union of my + team work) ──

/** Returns blocked issues across my + team lists, deduped by key (first occurrence wins). */
export function selectBlockers(myIssues: JiraIssue[], teamIssues: JiraIssue[]): JiraIssue[] {
  const combinedIssues = dedupeByKey([...myIssues, ...teamIssues]);
  return combinedIssues.filter((issue) => isBlockedIssue(issue));
}

/**
 * Returns issues that are due or overdue across my + team lists, deduped by key.
 * An issue qualifies when the existing Hygiene rules flag it as 'due-date-overdue'
 * or 'target-end-overdue' — the Today tab does not invent its own overdue rule.
 */
export function selectDueOverdue(
  myIssues: JiraIssue[],
  teamIssues: JiraIssue[],
  ctx?: HygieneEvaluationContext,
): JiraIssue[] {
  const combinedIssues = dedupeByKey([...myIssues, ...teamIssues]);
  return combinedIssues.filter((issue) => {
    const flagIds = evaluateHygieneIssue(issue, ctx).map((flag) => flag.checkId);
    return flagIds.includes('due-date-overdue') || flagIds.includes('target-end-overdue');
  });
}

/** Returns my issues that the Hygiene stale rule flags, using the configured threshold. */
export function selectMyStale(myIssues: JiraIssue[], staleDaysThreshold?: number): JiraIssue[] {
  return myIssues.filter((issue) => checkStaleIssue(issue, staleDaysThreshold) !== null);
}

// ── Team hygiene selectors (over SHARED scan findings) ──
//
// The team cards count findings produced by the shared hygiene scan (hygieneScan.ts) — the same
// scan the team Hygiene tab renders. Counting anything else (a separate fetch, a separate
// evaluation) is exactly how the card and the tab came to disagree (GH #177). These selectors
// only COUNT; they never re-evaluate.

/** The check ids behind the "Team stale issues" card — must match its drill-through filter. */
export const TEAM_STALE_CHECK_IDS: readonly string[] = ['stale'];
/** The check ids behind the "Unassigned in-progress" card — must match its drill-through filter. */
export const TEAM_UNASSIGNED_CHECK_IDS: readonly string[] = ['no-assignee'];
/** The check ids behind the "Sprint commitment gaps" card — must match its drill-through filter. */
export const COMMITMENT_GAP_CHECK_IDS: readonly string[] = ['missing-sp', 'no-ac'];
/** The overdue check ids feeding the team half of the "Due / overdue today" card. */
export const DUE_OVERDUE_CHECK_IDS: readonly string[] = ['due-date-overdue', 'target-end-overdue'];

/** Counts the scan findings (issues) that raised at least one of the given checks. */
export function countFindingsMatchingChecks(findings: readonly HygieneFinding[], checkIds: readonly string[]): number {
  return selectFindingKeysMatchingChecks(findings, checkIds).length;
}

/** Returns the issue keys of scan findings that raised at least one of the given checks. */
export function selectFindingKeysMatchingChecks(
  findings: readonly HygieneFinding[],
  checkIds: readonly string[],
): string[] {
  return findings
    .filter((finding) => finding.flags.some((flag) => checkIds.includes(flag.checkId)))
    .map((finding) => finding.issue.key);
}

// ── Untriaged ──

/**
 * Returns the untriaged "new" issues unchanged. The daily stand-up "new" set is already
 * curated upstream, so this selector is an identity pass that exists for API symmetry.
 */
export function selectUntriaged(untriagedIssues: JiraIssue[]): JiraIssue[] {
  return untriagedIssues;
}

// ── Completion ──

/** Returns true only when every catalog category has been marked complete for the day. */
export function isDoneForToday(completionByCategory: Record<CategoryId, boolean>): boolean {
  return CATEGORY_CATALOG.every((catalogEntry) => completionByCategory[catalogEntry.id] === true);
}

// ── Private helpers ──

/** Removes duplicate issues by key, keeping the first occurrence in the input order. */
function dedupeByKey(issues: JiraIssue[]): JiraIssue[] {
  const seenKeys = new Set<string>();
  const uniqueIssues: JiraIssue[] = [];
  issues.forEach((issue) => {
    if (seenKeys.has(issue.key)) return;
    seenKeys.add(issue.key);
    uniqueIssues.push(issue);
  });
  return uniqueIssues;
}
