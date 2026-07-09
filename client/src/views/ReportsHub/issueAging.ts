// issueAging.ts — Pure, deterministic compute for the open-item Aging report.
//
// It answers one question with hard numbers: for a team's NOT-Done backlog, how old is the work,
// broken down by issue type (Story, Bug, Defect, Task, …)? For each type it reports how many open
// issues there are, the average / median / oldest AGE — calendar days since each issue was CREATED —
// the key of the single oldest issue, and a spread of the ages across fixed day-range buckets. It also
// returns an overall "All" row aggregating the same statistics across the whole backlog.
//
// The module takes no clock — the caller injects `todayIso` — so identical input always yields identical
// output and the engine is trivially unit-testable. Aging is CALENDAR days (wall-clock age since
// creation), so a ticket opened before a weekend keeps ageing over it.

// ── Domain constants ─────────────────────────────────────────────────────────

/** Milliseconds in one calendar day, used to convert an epoch difference into a whole-and-fractional day count. */
const MILLISECONDS_PER_DAY = 86_400_000;

/** Label used for an issue whose type name is empty or blank, so the grouping never reads as a bare row. */
const UNKNOWN_ISSUE_TYPE_LABEL = 'Unknown';

/** Label for the aggregate row that summarises every open issue as one group. */
const OVERALL_GROUP_LABEL = 'All';

/** Inclusive upper edge (days) of the youngest bucket: an age at or below this is "fresh". */
const BUCKET_YOUNG_MAX_DAYS = 7;

/** Inclusive upper edge (days) of the middle bucket: an age above 7 and up to this is "ageing". */
const BUCKET_MID_MAX_DAYS = 30;

/** Inclusive upper edge (days) of the old bucket: an age above 30 and up to this is "old"; beyond it is stale. */
const BUCKET_OLD_MAX_DAYS = 90;

// ── Public types ─────────────────────────────────────────────────────────────

/** One open issue for the aging report: its key, issue type, and when it was created (null when Jira omitted it). */
export interface IssueAgingIssueInput {
  key: string;
  issueType: string;
  createdIso: string | null;
}

/** Everything the report needs to compute the aging breakdown, including the injected anchor day. */
export interface IssueAgingInput {
  issues: readonly IssueAgingIssueInput[];
  todayIso: string; // injected anchor (YYYY-MM-DD or full ISO)
}

/**
 * The spread of a group's measurable ages across fixed day-range buckets. Only issues with a valid,
 * parseable created date are bucketed; the `ageOverNinety` bucket IS the "older than 90 days" count.
 */
export interface IssueAgingBuckets {
  ageZeroToSeven: number; // age ≤ 7 days
  ageEightToThirty: number; // 7 < age ≤ 30 days
  ageThirtyOneToNinety: number; // 30 < age ≤ 90 days
  ageOverNinety: number; // age > 90 days
}

/** Per-group aging summary: how many open issues, their age statistics, the oldest issue, and the bucket spread. */
export interface IssueTypeAging {
  issueType: string;
  count: number; // every issue in the group, including those with an unknown created date
  averageAgeDays: number | null; // mean over the ages that exist; null when the group has none
  medianAgeDays: number | null; // median over the ages that exist; null when the group has none
  oldestAgeDays: number | null; // the single largest age; null when the group has none
  oldestIssueKey: string | null; // the key of the issue with the largest age; null when the group has none
  buckets: IssueAgingBuckets; // spread of the measurable ages across the day-range buckets
}

/** The full aging result: overall backlog size, overall average age, an aggregate row, and the per-type rows. */
export interface IssueAgingResult {
  totalCount: number; // every open issue passed in, regardless of a missing created date
  overallAverageAgeDays: number | null; // mean of every age that exists; null when none do
  overall: IssueTypeAging; // the whole backlog aggregated as one "All" group
  byType: IssueTypeAging[]; // one row per issue type, oldest-on-average first
}

// ── Internal types ───────────────────────────────────────────────────────────

/** A single issue paired with its measured age, so the oldest-key and bucketing share one derivation. */
interface AgedIssue {
  key: string;
  ageDays: number;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Computes the open-item aging breakdown from a team's NOT-Done issues.
 *
 * Every issue counts toward its group's total; an issue with a null or unparseable created date still
 * counts but contributes no age to any statistic or bucket. Types are sorted oldest-average first (a type
 * with no measurable age sorts last), tie-broken by type name. An overall "All" row aggregates the same
 * statistics across the whole backlog. It never reads the clock — `input.todayIso` anchors every age.
 */
export function computeIssueAging(input: IssueAgingInput): IssueAgingResult {
  const todayMs = Date.parse(input.todayIso);
  const issuesByType = groupIssuesByType(input.issues);

  const byType = Array.from(issuesByType.entries())
    .map(([issueType, issues]) => buildGroupAging(issueType, issues, todayMs))
    .sort(compareByAverageAgeThenType);

  const overall = buildGroupAging(OVERALL_GROUP_LABEL, input.issues, todayMs);
  return {
    totalCount: input.issues.length,
    overallAverageAgeDays: overall.averageAgeDays,
    overall,
    byType,
  };
}

// ── Group aggregation (shared by per-type rows and the overall row) ────────────

/**
 * Builds one IssueTypeAging summary from a label and its issues — the single aggregation used for BOTH the
 * per-type rows and the overall "All" row, so the two can never drift. Issues with an unparseable created
 * date count toward `count` but are excluded from every age statistic and bucket.
 */
function buildGroupAging(
  label: string,
  issues: readonly IssueAgingIssueInput[],
  todayMs: number,
): IssueTypeAging {
  const agedIssues = collectAgedIssues(issues, todayMs);
  const ages = agedIssues.map((agedIssue) => agedIssue.ageDays);
  return {
    issueType: label,
    count: issues.length,
    averageAgeDays: computeMean(ages),
    medianAgeDays: computeMedian(ages),
    oldestAgeDays: ages.length === 0 ? null : Math.max(...ages),
    oldestIssueKey: pickOldestIssueKey(agedIssues),
    buckets: buildBuckets(ages),
  };
}

/** Buckets every issue by its (normalized) type, preserving first-seen order so grouping is deterministic. */
function groupIssuesByType(
  issues: readonly IssueAgingIssueInput[],
): Map<string, IssueAgingIssueInput[]> {
  const issuesByType = new Map<string, IssueAgingIssueInput[]>();
  for (const issue of issues) {
    const issueType = normalizeIssueType(issue.issueType);
    const bucket = issuesByType.get(issueType) ?? [];
    bucket.push(issue);
    issuesByType.set(issueType, bucket);
  }
  return issuesByType;
}

/** Pairs each issue that has a measurable age with that age, dropping issues whose created date is unknown. */
function collectAgedIssues(issues: readonly IssueAgingIssueInput[], todayMs: number): AgedIssue[] {
  const agedIssues: AgedIssue[] = [];
  for (const issue of issues) {
    const ageDays = computeAgeDays(issue.createdIso, todayMs);
    if (ageDays !== null) {
      agedIssues.push({ key: issue.key, ageDays });
    }
  }
  return agedIssues;
}

/** Returns the key of the issue with the greatest age (first one wins a tie), or null when none have an age. */
function pickOldestIssueKey(agedIssues: readonly AgedIssue[]): string | null {
  let oldest: AgedIssue | null = null;
  for (const agedIssue of agedIssues) {
    if (oldest === null || agedIssue.ageDays > oldest.ageDays) {
      oldest = agedIssue;
    }
  }
  return oldest === null ? null : oldest.key;
}

/**
 * Tallies the measurable ages into the four day-range buckets. The boundaries are inclusive on their upper
 * edge (an age of exactly 7, 30, or 90 lands in the LOWER bucket), and everything over 90 days is stale.
 */
function buildBuckets(ages: readonly number[]): IssueAgingBuckets {
  const buckets: IssueAgingBuckets = {
    ageZeroToSeven: 0, ageEightToThirty: 0, ageThirtyOneToNinety: 0, ageOverNinety: 0,
  };
  for (const ageDays of ages) {
    if (ageDays <= BUCKET_YOUNG_MAX_DAYS) buckets.ageZeroToSeven += 1;
    else if (ageDays <= BUCKET_MID_MAX_DAYS) buckets.ageEightToThirty += 1;
    else if (ageDays <= BUCKET_OLD_MAX_DAYS) buckets.ageThirtyOneToNinety += 1;
    else buckets.ageOverNinety += 1;
  }
  return buckets;
}

/** Normalizes an issue-type name, falling back to a named label when it is blank so no row reads empty. */
function normalizeIssueType(issueType: string): string {
  const trimmed = issueType.trim();
  return trimmed === '' ? UNKNOWN_ISSUE_TYPE_LABEL : trimmed;
}

// ── Age math ─────────────────────────────────────────────────────────────────

/**
 * Calendar-day age of an issue: the days between its creation and today, floored at zero so a future-dated
 * creation never reads negative. Returns null when the created date is null or cannot be parsed, so such an
 * issue counts toward its group but never distorts the age statistics or buckets.
 */
function computeAgeDays(createdIso: string | null, todayMs: number): number | null {
  const createdMs = parseIsoOrNull(createdIso);
  if (createdMs === null) return null;
  return Math.max(0, (todayMs - createdMs) / MILLISECONDS_PER_DAY);
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Orders type rows by average age descending (oldest-on-average first) so the most-aged backlog leads.
 * A type with no measurable average (null) always sorts last; ties are broken by type name ascending.
 */
function compareByAverageAgeThenType(first: IssueTypeAging, second: IssueTypeAging): number {
  if (first.averageAgeDays !== second.averageAgeDays) {
    if (first.averageAgeDays === null) return 1; // nulls sink to the bottom
    if (second.averageAgeDays === null) return -1;
    return second.averageAgeDays - first.averageAgeDays;
  }
  return first.issueType < second.issueType ? -1 : first.issueType > second.issueType ? 1 : 0;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

/** Returns the arithmetic mean of the values, or null for an empty list. */
function computeMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((runningTotal, value) => runningTotal + value, 0);
  return total / values.length;
}

/**
 * Returns the median of the values, or null for an empty list: the middle value for an odd count, or the
 * mean of the two middle values for an even count. Sorts a copy so the caller's ordering is untouched.
 */
function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((first, second) => first - second);
  const middleIndex = Math.floor(sortedValues.length / 2);
  const hasOddCount = sortedValues.length % 2 === 1;
  if (hasOddCount) return sortedValues[middleIndex];
  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

/** Parses an ISO date string to epoch milliseconds, returning null for null or unparseable input. */
function parseIsoOrNull(isoString: string | null): number | null {
  if (isoString === null) return null;
  const parsedMs = Date.parse(isoString);
  return Number.isNaN(parsedMs) ? null : parsedMs;
}
