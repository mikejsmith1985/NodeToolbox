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

// ── Team hygiene buckets ──

/** The team-scope hygiene work the Today tab surfaces, split into its three sub-buckets. */
export interface TeamHygieneBuckets {
  stale: JiraIssue[]; // flag 'stale'
  unassigned: JiraIssue[]; // flag 'no-assignee'
  commitmentGaps: JiraIssue[]; // flag 'missing-sp' OR 'no-ac'
}

/**
 * Runs the full Hygiene evaluation once per team issue and sorts each issue into the
 * stale / unassigned / commitment-gap buckets based on which Hygiene flags it raised.
 * A single issue can appear in more than one bucket when it raises multiple flags.
 */
export function bucketTeamHygiene(teamIssues: JiraIssue[], ctx?: HygieneEvaluationContext): TeamHygieneBuckets {
  const staleIssues: JiraIssue[] = [];
  const unassignedIssues: JiraIssue[] = [];
  const commitmentGapIssues: JiraIssue[] = [];

  teamIssues.forEach((issue) => {
    const flagIds = evaluateHygieneIssue(issue, ctx).map((flag) => flag.checkId);
    if (flagIds.includes('stale')) staleIssues.push(issue);
    if (flagIds.includes('no-assignee')) unassignedIssues.push(issue);
    if (flagIds.includes('missing-sp') || flagIds.includes('no-ac')) commitmentGapIssues.push(issue);
  });

  return { stale: staleIssues, unassigned: unassignedIssues, commitmentGaps: commitmentGapIssues };
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
