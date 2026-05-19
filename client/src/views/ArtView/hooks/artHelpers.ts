// artHelpers.ts — Shared helper functions for ART View issue analysis.
// These are pure functions with no React dependency — safe to import from any tab,
// panel, or hook within the ART View without introducing circular dependencies.

import type { JiraIssue } from '../../../types/jira.ts';

// ── Constants ──

const STATUS_CATEGORY_DONE = 'done';
const STATUS_CATEGORY_IN_PROGRESS = 'indeterminate';
const PI_DATE_RANGE_PATTERN = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;
const TWO_DIGIT_YEAR_BASE = 2000;

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

// ── Impediment staleness helpers ──

/** Number of milliseconds in one calendar day — used by all staleness calculations. */
const IMPEDIMENT_MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Represents how stale an impediment is relative to the configured threshold:
 *   - 'fresh'    — updated within the stale threshold (still being actively worked)
 *   - 'stale'    — past the threshold (needs attention soon)
 *   - 'critical' — at or beyond 2× the threshold (should be escalated)
 */
export type ImpedimentStaleTier = 'fresh' | 'stale' | 'critical';

/**
 * Classifies an impediment as fresh, stale, or critical based on how long ago it was
 * last updated compared to the configured stale threshold.
 * Using 2× the threshold as the critical boundary keeps the tiers proportional:
 * a 5-day threshold means stale at 5d and critical at 10d.
 */
export function classifyImpedimentStaleness(
  daysSinceUpdate: number,
  staleThresholdDays: number,
): ImpedimentStaleTier {
  if (daysSinceUpdate >= staleThresholdDays * 2) return 'critical';
  if (daysSinceUpdate >= staleThresholdDays) return 'stale';
  return 'fresh';
}

/**
 * Computes the number of whole days elapsed since the issue was last updated.
 * The `nowMs` parameter defaults to `Date.now()` and can be overridden in tests
 * to produce a deterministic result without time-travel mocks.
 */
export function computeDaysSinceUpdate(issue: JiraIssue, nowMs: number = Date.now()): number {
  const updatedMs = new Date(issue.fields.updated).getTime();
  return Math.max(0, Math.floor((nowMs - updatedMs) / IMPEDIMENT_MS_PER_DAY));
}

// ── Program Increment date helpers ──

/**
 * Normalizes a two-digit or four-digit year token from a PI name into a full calendar year.
 * Jira PI labels in this repo use short years such as "26", which map to 2026.
 */
function resolveCalendarYear(yearToken: string): number {
  const parsedYear = Number(yearToken);
  return yearToken.length <= 2 ? TWO_DIGIT_YEAR_BASE + parsedYear : parsedYear;
}

/**
 * Creates a local-midnight Date so PI range checks stay stable across time zones.
 * This avoids UTC conversion shifting the date into the previous or next day.
 */
function createLocalDateAtMidnight(monthNumber: number, dayNumber: number, yearNumber: number): Date {
  return new Date(yearNumber, monthNumber - 1, dayNumber);
}

/**
 * Parses a PI label date range such as "PI 26.3 (05/21/26 - 07/29/26)".
 * Returns null when the label does not contain a recognizable start/end date pair.
 */
export function parsePiDateRange(
  piName: string,
): { startDate: Date; endDate: Date } | null {
  const matchedDateRange = piName.match(PI_DATE_RANGE_PATTERN);
  if (!matchedDateRange) {
    return null;
  }

  const startMonthNumber = Number(matchedDateRange[1]);
  const startDayNumber = Number(matchedDateRange[2]);
  const startYearNumber = resolveCalendarYear(matchedDateRange[3]);
  const endMonthNumber = Number(matchedDateRange[4]);
  const endDayNumber = Number(matchedDateRange[5]);
  const endYearNumber = resolveCalendarYear(matchedDateRange[6]);

  return {
    startDate: createLocalDateAtMidnight(startMonthNumber, startDayNumber, startYearNumber),
    endDate: createLocalDateAtMidnight(endMonthNumber, endDayNumber, endYearNumber),
  };
}

/**
 * Finds the PI label whose embedded date range covers the provided day.
 * The check is inclusive so the PI still matches on its start and end dates.
 */
export function findPiNameForDate(
  piNames: string[],
  todayDate: Date = new Date(),
): string | null {
  const normalizedTodayDate = createLocalDateAtMidnight(
    todayDate.getMonth() + 1,
    todayDate.getDate(),
    todayDate.getFullYear(),
  );

  for (const piName of piNames) {
    const parsedDateRange = parsePiDateRange(piName);
    if (!parsedDateRange) {
      continue;
    }

    const isDateWithinPiRange =
      normalizedTodayDate.getTime() >= parsedDateRange.startDate.getTime()
      && normalizedTodayDate.getTime() <= parsedDateRange.endDate.getTime();

    if (isDateWithinPiRange) {
      return piName;
    }
  }

  return null;
}

// ── Monthly Report Jira-derived helpers ──

/**
 * A read-only snapshot of Jira-derived metrics for a single team's monthly report card.
 * Always computed live from the team's loaded sprint issues — never persisted to localStorage.
 * All values are 0 when no issues have been loaded so callers can detect the "not loaded" state.
 */
export interface MonthlyJiraStats {
  /** Story points completed (done issues only). Drawn from the velocity calculation. */
  velocityPoints: number;
  /** Total committed story points across all issues regardless of status. */
  committedPoints: number;
  /** Percentage of issues in the done state, rounded to the nearest integer. */
  completionPercent: number;
  /** Number of issues classified as impediments by any of the four detection signals. */
  impedimentCount: number;
  /** Number of issues whose status category is "done". */
  doneIssueCount: number;
  /** Total issues loaded for the team — 0 means the team data has not been fetched yet. */
  totalIssueCount: number;
}

/**
 * Derives a monthly report metrics snapshot from a team's loaded sprint issues.
 * Returns all-zero values when the issue list is empty so callers can show a
 * "no data loaded" hint rather than misleading zero-percent statistics.
 */
export function computeMonthlyJiraStats(issues: JiraIssue[]): MonthlyJiraStats {
  const totalIssueCount = issues.length;
  if (totalIssueCount === 0) {
    return {
      velocityPoints: 0,
      committedPoints: 0,
      completionPercent: 0,
      impedimentCount: 0,
      doneIssueCount: 0,
      totalIssueCount: 0,
    };
  }

  const doneIssueCount = issues.filter(isIssueDone).length;

  return {
    velocityPoints: computeVelocityPoints(issues),
    committedPoints: computeCommittedStoryPoints(issues),
    completionPercent: Math.round((doneIssueCount / totalIssueCount) * 100),
    impedimentCount: issues.filter(isImpediment).length,
    doneIssueCount,
    totalIssueCount,
  };
}

/**
 * Maximum number of done-issue bullets included in the auto-generated "Accomplished" text.
 * Capped so the field stays readable when a team closes many small stories in a sprint.
 */
const MONTHLY_ACCOMPLISHED_MAX_ISSUE_COUNT = 10;

/**
 * Auto-generates the "Accomplished" narrative from a team's done sprint issues.
 * Lists each done issue as a bullet line (KEY: summary), capping at
 * MONTHLY_ACCOMPLISHED_MAX_ISSUE_COUNT with an overflow note when needed.
 * Returns an empty string when no issues are done, letting the caller decide
 * whether to leave the field blank or keep existing manual content.
 */
export function generateMonthlyAccomplishedText(issues: JiraIssue[]): string {
  const doneIssues = issues.filter(isIssueDone);
  if (doneIssues.length === 0) return '';

  const topDoneIssues = doneIssues.slice(0, MONTHLY_ACCOMPLISHED_MAX_ISSUE_COUNT);
  const bulletLines = topDoneIssues.map((issue) => `• ${issue.key}: ${issue.fields.summary}`);

  if (doneIssues.length > MONTHLY_ACCOMPLISHED_MAX_ISSUE_COUNT) {
    bulletLines.push(`• …and ${doneIssues.length - MONTHLY_ACCOMPLISHED_MAX_ISSUE_COUNT} more`);
  }

  return bulletLines.join('\n');
}

/**
 * Auto-generates the "Risks" narrative from a team's open impediment issues.
 * Uses the same four-signal impediment detection as the Impediments tab so every
 * issue surfaced there also appears in the Monthly Report risks field.
 * Returns an empty string when no impediments are detected.
 */
export function generateMonthlyRisksText(issues: JiraIssue[]): string {
  const impedimentIssues = issues.filter(isImpediment);
  if (impedimentIssues.length === 0) return '';

  return impedimentIssues
    .map((issue) => `• ${issue.key}: ${issue.fields.summary}`)
    .join('\n');
}
