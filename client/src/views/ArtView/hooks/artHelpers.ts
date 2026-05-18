// artHelpers.ts — Shared helper functions for ART View issue analysis.
// These are pure functions with no React dependency — safe to import from any tab,
// panel, or hook within the ART View without introducing circular dependencies.

import type { JiraIssue } from '../../../types/jira.ts';

// ── Constants ──

const STATUS_CATEGORY_DONE = 'done';
const STATUS_CATEGORY_IN_PROGRESS = 'indeterminate';

// ── Status helpers ──

/**
 * Returns true when a Jira issue is in a "done" state.
 * Checks the statusCategory key first; falls back to the status display name
 * for Jira instances that do not populate category metadata.
 */
export function isIssueDone(issue: JiraIssue): boolean {
  const categoryKey = issue.fields.status.statusCategory?.key;
  if (categoryKey) return categoryKey === STATUS_CATEGORY_DONE;
  return issue.fields.status.name.toLowerCase() === 'done';
}

/**
 * Returns true when a Jira issue is actively being worked on (in progress or in review).
 * Checks statusCategory first; falls back to known status display names.
 */
export function isIssueInProgress(issue: JiraIssue): boolean {
  const categoryKey = issue.fields.status.statusCategory?.key;
  if (categoryKey) return categoryKey === STATUS_CATEGORY_IN_PROGRESS;
  const statusName = issue.fields.status.name.toLowerCase();
  return statusName === 'in progress' || statusName === 'in review';
}

// ── Story-point helpers ──

/**
 * Resolves the story point estimate for a Jira issue, trying both known custom fields.
 * customfield_10016 is the primary field used by most Jira Cloud instances.
 * customfield_10028 is the alternate field used by some instances and Jira's built-in
 * "Story point estimate" field. Callers should use this helper rather than reading either
 * field directly so that all tabs benefit from the fallback logic automatically.
 */
export function resolveIssueStoryPoints(issue: JiraIssue): number | null {
  return issue.fields.customfield_10016 ?? issue.fields.customfield_10028 ?? null;
}

/**
 * Computes the total committed story points for a set of issues (all statuses).
 * Useful for measuring sprint capacity or PI scope commitment.
 * Unestimated issues contribute 0 to the total.
 */
export function computeCommittedStoryPoints(issues: JiraIssue[]): number {
  return issues.reduce((runningTotal, issue) => {
    const issuePoints = resolveIssueStoryPoints(issue);
    return runningTotal + (issuePoints ?? 0);
  }, 0);
}

/**
 * Computes the total completed (done) story points for a set of issues.
 * Used for velocity and predictability calculations where only closed work counts.
 * Unestimated done issues contribute 0 to the total.
 */
export function computeVelocityPoints(issues: JiraIssue[]): number {
  return issues
    .filter(isIssueDone)
    .reduce((runningTotal, issue) => {
      const issuePoints = resolveIssueStoryPoints(issue);
      return runningTotal + (issuePoints ?? 0);
    }, 0);
}

// ── Impediment helpers ──

/**
 * Human-readable reason labels that explain why an issue was classified as an impediment.
 * Multiple reasons may apply to a single issue (e.g. both flagged and has a blocking link).
 */
export type ImpedimentReason = 'Blocked Status' | 'Blocked Link' | 'Flagged' | 'Label';

/**
 * Returns all detected reasons why a Jira issue is an impediment.
 * Checks four independent signals so that issues flagged through any mechanism surface correctly:
 *   1. Status name contains "block" (e.g. "Blocked", "Blocked – Waiting")
 *   2. An open "is blocked by" / "blocks" issue link exists
 *   3. The Jira flagged custom field (customfield_10021) is set
 *   4. The issue carries a "blocked" or "impediment" label
 */
export function detectImpedimentReasons(issue: JiraIssue): ImpedimentReason[] {
  const reasons: ImpedimentReason[] = [];

  // Signal 1: status name explicitly contains "block"
  if (issue.fields.status.name.toLowerCase().includes('block')) {
    reasons.push('Blocked Status');
  }

  // Signal 2: at least one issue link is a blocking relationship with an open linked issue.
  // We check both inward and outward type names so detection works regardless of which
  // direction the link was recorded in Jira.
  const hasBlockedByLink = (issue.fields.issuelinks ?? []).some((link) => {
    const inwardName = link.type?.inward?.toLowerCase() ?? '';
    const outwardName = link.type?.outward?.toLowerCase() ?? '';
    const linkedInwardIssueIsOpen =
      link.inwardIssue !== undefined &&
      link.inwardIssue.fields?.status?.name?.toLowerCase() !== 'done' &&
      link.inwardIssue.fields?.status?.name?.toLowerCase() !== 'resolved' &&
      link.inwardIssue.fields?.status?.name?.toLowerCase() !== 'closed';
    return (inwardName.includes('block') || outwardName.includes('block')) && linkedInwardIssueIsOpen;
  });
  if (hasBlockedByLink) {
    reasons.push('Blocked Link');
  }

  // Signal 3: Jira "flagged" custom field — set by the impediment flag button in Jira boards.
  if (issue.fields.customfield_10021) {
    reasons.push('Flagged');
  }

  // Signal 4: a label explicitly marks the item as blocked or an impediment.
  const issueLabels = issue.fields.labels ?? [];
  const hasBlockedLabel = issueLabels.some(
    (label) => label.toLowerCase() === 'blocked' || label.toLowerCase() === 'impediment',
  );
  if (hasBlockedLabel) {
    reasons.push('Label');
  }

  return reasons;
}

/**
 * Returns true when a Jira issue is an impediment by any of the four detection signals.
 * Delegates to detectImpedimentReasons so callers that only need a boolean stay concise.
 */
export function isImpediment(issue: JiraIssue): boolean {
  return detectImpedimentReasons(issue).length > 0;
}
