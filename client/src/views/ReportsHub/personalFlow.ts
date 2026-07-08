// personalFlow.ts — Pure, deterministic compute for the Personal Flow report: it
// measures one person's throughput (issues and story points per day / week / two
// weeks over a lookback window) and cycle time (calendar days from first
// in-progress to last done), derived entirely from their closed issues'
// changelogs. It takes no clock — the caller injects `todayIso` — so the same
// input always yields the same output and the module is trivially unit-testable.

// ── Domain constants ─────────────────────────────────────────────────────────

/** Days in one week, used to scale a per-day rate up to a per-week rate. */
const DAYS_PER_WEEK = 7;

/** Days in a two-week sprint, used to scale a per-day rate up to a per-fortnight rate. */
const DAYS_PER_TWO_WEEKS = 14;

/** Milliseconds in one calendar day, used to convert epoch differences into day counts. */
const MILLISECONDS_PER_DAY = 86_400_000;

/** Jira status category key for work that is actively being progressed. */
const STATUS_CATEGORY_IN_PROGRESS = 'indeterminate';

/** Jira status category key for work that is finished. */
const STATUS_CATEGORY_DONE = 'done';

/** Smallest allowed window, so a zero or negative windowDays cannot divide throughput by zero. */
const MINIMUM_WINDOW_DAYS = 1;

// ── Public types ─────────────────────────────────────────────────────────────

/** One status transition pulled from an issue's changelog: the status it moved TO and when. */
export interface PersonalFlowTransition {
  toStatusId: string;
  atIso: string;
}

/** A closed issue for one person, with the transitions needed to measure cycle time. */
export interface PersonalFlowIssue {
  key: string;
  summary: string;
  storyPoints: number | null;
  resolvedIso: string | null; // when it closed (resolution/last done transition)
  transitions: PersonalFlowTransition[]; // status changes, any order
}

/** Everything the report needs to compute one person's flow, including the injected anchor day. */
export interface PersonalFlowInput {
  issues: readonly PersonalFlowIssue[];
  /** statusId -> Jira status category key ('new' | 'indeterminate' | 'done'); unknown ids treated as 'new'. */
  statusCategoryByStatusId: Readonly<Record<string, string>>;
  windowDays: number; // e.g. 90; must be > 0
  todayIso: string; // injected anchor (YYYY-MM-DD)
}

/** Throughput rates expressed at three cadences for both issues and story points. */
export interface PersonalFlowThroughput {
  issuesPerDay: number;
  issuesPerWeek: number;
  issuesPerTwoWeeks: number;
  pointsPerDay: number;
  pointsPerWeek: number;
  pointsPerTwoWeeks: number;
}

/** Aggregate cycle-time statistics over the in-window issues that had a measurable cycle. */
export interface PersonalFlowCycleTime {
  averageDays: number | null;
  medianDays: number | null;
  countWithCycleTime: number;
}

/** Per-issue detail row, including the issue's own cycle time (null when unmeasurable). */
export interface PersonalFlowIssueMetric {
  key: string;
  summary: string;
  storyPoints: number | null;
  resolvedIso: string | null;
  cycleTimeDays: number | null;
}

/** The full Personal Flow result: window summary, throughput, cycle time, and per-issue rows. */
export interface PersonalFlowResult {
  windowDays: number;
  issueCount: number; // issues closed within the window
  totalStoryPoints: number; // summed over those issues (null points = 0)
  throughput: PersonalFlowThroughput;
  cycleTime: PersonalFlowCycleTime;
  perIssue: PersonalFlowIssueMetric[]; // one row per in-window issue, most-recently-resolved first
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Computes one person's throughput and cycle time from their closed issues.
 *
 * The calculation is a pipeline: clamp the window, keep only issues resolved
 * inside it, measure each issue's cycle time, then aggregate throughput and
 * cycle-time statistics. It never reads the clock — `input.todayIso` anchors the
 * window — so the output is a pure function of the input.
 */
export function computePersonalFlow(input: PersonalFlowInput): PersonalFlowResult {
  const effectiveWindowDays = clampWindowDays(input.windowDays);
  const todayMs = Date.parse(input.todayIso);
  const windowStartMs = todayMs - effectiveWindowDays * MILLISECONDS_PER_DAY;

  const inWindowIssues = keepIssuesResolvedInWindow(input.issues, windowStartMs, todayMs);
  const perIssue = buildSortedIssueMetrics(inWindowIssues, input.statusCategoryByStatusId);

  const issueCount = perIssue.length;
  const totalStoryPoints = sumStoryPoints(perIssue);

  return {
    windowDays: effectiveWindowDays,
    issueCount,
    totalStoryPoints,
    throughput: buildThroughput(issueCount, totalStoryPoints, effectiveWindowDays),
    cycleTime: buildCycleTimeStats(perIssue),
    perIssue,
  };
}

// ── Window filtering ─────────────────────────────────────────────────────────

/** Clamps windowDays up to a minimum of 1 so throughput is never divided by zero. */
function clampWindowDays(windowDays: number): number {
  return windowDays > MINIMUM_WINDOW_DAYS ? windowDays : MINIMUM_WINDOW_DAYS;
}

/**
 * Returns only issues whose resolvedIso parses and falls inside the inclusive
 * [windowStartMs, todayMs] range. Issues with a null or unparseable resolvedIso
 * cannot count toward throughput and are dropped.
 */
function keepIssuesResolvedInWindow(
  issues: readonly PersonalFlowIssue[],
  windowStartMs: number,
  todayMs: number,
): PersonalFlowIssue[] {
  return issues.filter((issue) => {
    const resolvedMs = parseIsoOrNull(issue.resolvedIso);
    if (resolvedMs === null) return false;
    return resolvedMs >= windowStartMs && resolvedMs <= todayMs;
  });
}

// ── Per-issue metrics ────────────────────────────────────────────────────────

/**
 * Maps each in-window issue to a metric row (including its cycle time) and sorts
 * the rows most-recently-resolved first, tie-breaking by key ascending for a
 * stable, deterministic order.
 */
function buildSortedIssueMetrics(
  issues: PersonalFlowIssue[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
): PersonalFlowIssueMetric[] {
  const metrics = issues.map((issue) => ({
    key: issue.key,
    summary: issue.summary,
    storyPoints: issue.storyPoints,
    resolvedIso: issue.resolvedIso,
    cycleTimeDays: computeCycleTimeDays(issue, statusCategoryByStatusId),
  }));

  return metrics.sort(compareByResolvedThenKey);
}

/** Orders rows by resolvedIso descending, then by key ascending as a stable tie-break. */
function compareByResolvedThenKey(
  first: PersonalFlowIssueMetric,
  second: PersonalFlowIssueMetric,
): number {
  const firstMs = parseIsoOrNull(first.resolvedIso) ?? 0;
  const secondMs = parseIsoOrNull(second.resolvedIso) ?? 0;
  if (firstMs !== secondMs) return secondMs - firstMs; // most recent first
  return first.key < second.key ? -1 : first.key > second.key ? 1 : 0;
}

/**
 * Measures an issue's cycle time in calendar days: from the earliest transition
 * into an in-progress status to the latest transition into a done status (or the
 * resolution date when no done transition exists). Returns null when the issue
 * never entered in-progress or when the done moment precedes the in-progress
 * start (an out-of-order or corrupt changelog).
 */
function computeCycleTimeDays(
  issue: PersonalFlowIssue,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
): number | null {
  const inProgressStartMs = findEarliestTransitionMs(
    issue.transitions,
    statusCategoryByStatusId,
    STATUS_CATEGORY_IN_PROGRESS,
  );
  if (inProgressStartMs === null) return null;

  const latestDoneMs = findLatestTransitionMs(
    issue.transitions,
    statusCategoryByStatusId,
    STATUS_CATEGORY_DONE,
  );
  const doneMs = latestDoneMs ?? parseIsoOrNull(issue.resolvedIso);
  if (doneMs === null || doneMs < inProgressStartMs) return null;

  // Keep fractional days so sub-day cycles are not lost to flooring.
  return (doneMs - inProgressStartMs) / MILLISECONDS_PER_DAY;
}

/** Finds the earliest parseable transition time whose target status is in the given category. */
function findEarliestTransitionMs(
  transitions: readonly PersonalFlowTransition[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  targetCategory: string,
): number | null {
  let earliestMs: number | null = null;
  for (const transition of transitions) {
    if (categoryFor(transition.toStatusId, statusCategoryByStatusId) !== targetCategory) continue;
    const atMs = parseIsoOrNull(transition.atIso);
    if (atMs === null) continue;
    if (earliestMs === null || atMs < earliestMs) earliestMs = atMs;
  }
  return earliestMs;
}

/** Finds the latest parseable transition time whose target status is in the given category. */
function findLatestTransitionMs(
  transitions: readonly PersonalFlowTransition[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  targetCategory: string,
): number | null {
  let latestMs: number | null = null;
  for (const transition of transitions) {
    if (categoryFor(transition.toStatusId, statusCategoryByStatusId) !== targetCategory) continue;
    const atMs = parseIsoOrNull(transition.atIso);
    if (atMs === null) continue;
    if (latestMs === null || atMs > latestMs) latestMs = atMs;
  }
  return latestMs;
}

/** Resolves a status id to its category, defaulting unknown ids to the 'new' category. */
function categoryFor(
  statusId: string,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
): string {
  return statusCategoryByStatusId[statusId] ?? 'new';
}

// ── Aggregations ─────────────────────────────────────────────────────────────

/** Sums story points across issue rows, treating a null point value as zero. */
function sumStoryPoints(metrics: readonly PersonalFlowIssueMetric[]): number {
  return metrics.reduce((runningTotal, metric) => runningTotal + (metric.storyPoints ?? 0), 0);
}

/** Builds per-day, per-week, and per-two-week rates for both issues and points. */
function buildThroughput(
  issueCount: number,
  totalStoryPoints: number,
  windowDays: number,
): PersonalFlowThroughput {
  const issuesPerDay = issueCount / windowDays;
  const pointsPerDay = totalStoryPoints / windowDays;
  return {
    issuesPerDay,
    issuesPerWeek: issuesPerDay * DAYS_PER_WEEK,
    issuesPerTwoWeeks: issuesPerDay * DAYS_PER_TWO_WEEKS,
    pointsPerDay,
    pointsPerWeek: pointsPerDay * DAYS_PER_WEEK,
    pointsPerTwoWeeks: pointsPerDay * DAYS_PER_TWO_WEEKS,
  };
}

/** Computes average, median, and count over the issues that had a measurable cycle time. */
function buildCycleTimeStats(metrics: readonly PersonalFlowIssueMetric[]): PersonalFlowCycleTime {
  const cycleTimes = metrics
    .map((metric) => metric.cycleTimeDays)
    .filter((cycleTimeDays): cycleTimeDays is number => cycleTimeDays !== null)
    .sort((first, second) => first - second);

  if (cycleTimes.length === 0) {
    return { averageDays: null, medianDays: null, countWithCycleTime: 0 };
  }

  return {
    averageDays: computeMean(cycleTimes),
    medianDays: computeMedianOfSorted(cycleTimes),
    countWithCycleTime: cycleTimes.length,
  };
}

/** Returns the arithmetic mean of a non-empty list of numbers. */
function computeMean(values: readonly number[]): number {
  const total = values.reduce((runningTotal, value) => runningTotal + value, 0);
  return total / values.length;
}

/**
 * Returns the median of an already-ascending, non-empty list: the middle value
 * for an odd count, or the mean of the two middle values for an even count.
 */
function computeMedianOfSorted(sortedValues: readonly number[]): number {
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
