// personalFlow.ts — Pure, deterministic compute for the Personal Flow report.
//
// It measures one person ("the target") in two ways, both reconstructed from each
// issue's status-category timeline and an ownership timeline expressed relative to
// the target:
//   • Cycle time credits only the target's HANDS-ON in-progress time — the Mon–Fri
//     working time an issue spent in an "in progress" status WHILE assigned to her.
//     Because it is reassignment-aware, work she advanced and handed off still
//     counts, and time the ticket sat with someone else never does.
//   • Throughput credits every issue she moved forward (any completed hands-on
//     stint), not just tickets she personally closed, and stays CALENDAR-based.
//
// The module takes no clock — the caller injects `todayIso` — so identical input
// always yields identical output and the engine is trivially unit-testable.

// ── Domain constants ─────────────────────────────────────────────────────────

/** Days in one week, used to scale a per-day throughput rate up to a per-week rate. */
const DAYS_PER_WEEK = 7;

/** Days in a two-week sprint, used to scale a per-day rate up to a per-fortnight rate. */
const DAYS_PER_TWO_WEEKS = 14;

/** Milliseconds in one calendar day, used to convert epoch differences into day counts. */
const MILLISECONDS_PER_DAY = 86_400_000;

/** Jira status category key for work that has not started. */
const STATUS_CATEGORY_NEW = 'new';

/** Jira status category key for work that is actively being progressed. */
const STATUS_CATEGORY_IN_PROGRESS = 'indeterminate';

/** Jira status category key for work that is finished. */
const STATUS_CATEGORY_DONE = 'done';

/** Smallest allowed window, so a zero or negative windowDays cannot divide throughput by zero. */
const MINIMUM_WINDOW_DAYS = 1;

/** getUTCDay() index for Monday — the first working day counted toward hands-on time. */
const FIRST_WORKDAY_INDEX = 1;

/** getUTCDay() index for Friday — the last working day counted toward hands-on time. */
const LAST_WORKDAY_INDEX = 5;

// ── Public types ─────────────────────────────────────────────────────────────

/** One status change from an issue's changelog: the status id it moved TO and when. */
export interface PersonalFlowStatusTransition {
  toStatusId: string;
  atIso: string;
}

/** One assignee change expressed relative to the target person: did it hand the issue TO her, and when. */
export interface PersonalFlowOwnershipTransition {
  assignedToTarget: boolean;
  atIso: string;
}

/**
 * One issue for the target person, carrying the reconstructed inputs the engine
 * needs: how status evolved and how ownership (relative to the target) evolved.
 */
export interface PersonalFlowIssue {
  key: string;
  summary: string;
  storyPoints: number | null;
  createdIso: string | null; // when the issue was created — the anchor for both timelines
  initialStatusId: string | null; // the issue's status at creation (null -> treated as 'new')
  statusTransitions: PersonalFlowStatusTransition[]; // status changes, any order
  initiallyAssignedToTarget: boolean; // was the target the assignee at creation
  ownershipTransitions: PersonalFlowOwnershipTransition[]; // assignee changes relative to the target, any order
}

/** Everything the report needs to compute one person's flow, including the injected anchor day. */
export interface PersonalFlowInput {
  issues: readonly PersonalFlowIssue[];
  /** statusId -> Jira status category key ('new' | 'indeterminate' | 'done'); unknown ids treated as 'new'. */
  statusCategoryByStatusId: Readonly<Record<string, string>>;
  windowDays: number; // e.g. 90; clamped up to at least 1
  todayIso: string; // injected anchor (YYYY-MM-DD or full ISO)
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

/** Aggregate cycle-time statistics over the qualifying issues (all have positive hands-on time). */
export interface PersonalFlowCycleTime {
  averageDays: number | null;
  medianDays: number | null;
  countWithCycleTime: number;
}

/** Per-issue detail row: summed hands-on working-day cycle time plus the latest completion moment. */
export interface PersonalFlowIssueMetric {
  key: string;
  summary: string;
  storyPoints: number | null;
  cycleTimeDays: number | null; // summed hands-on working days across in-window completed stints
  lastActiveIso: string | null; // ISO of the latest in-window completion moment
}

/** The full Personal Flow result: window summary, throughput, cycle time, and per-issue rows. */
export interface PersonalFlowResult {
  windowDays: number;
  issueCount: number; // issues she moved forward within the window
  totalStoryPoints: number; // summed over those issues (null points = 0)
  throughput: PersonalFlowThroughput;
  cycleTime: PersonalFlowCycleTime;
  perIssue: PersonalFlowIssueMetric[]; // one row per qualifying issue, most-recently-active first
}

// ── Internal types ───────────────────────────────────────────────────────────

/** A contiguous span over which a reconstructed timeline holds one constant value. */
interface StateSegment<TValue> {
  startMs: number;
  endMs: number;
  value: TValue;
}

/** A maximal span during which the issue was assigned to the target person. */
interface OwnershipInterval {
  startMs: number;
  endMs: number; // reassign-away time, or todayMs when she still holds it (an open interval)
}

/** A completed hands-on stint's contribution: when it completed and how much working time it credited. */
interface CompletedContribution {
  endMs: number;
  handsOnDays: number;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Computes one person's hands-on cycle time and calendar throughput from her issues.
 *
 * The pipeline clamps the window, evaluates each issue into an optional qualifying
 * metric (a completed, in-window stint with real in-progress working time), then
 * aggregates throughput and cycle-time statistics over the survivors. It never
 * reads the clock — `input.todayIso` anchors the window — so it is a pure function.
 */
export function computePersonalFlow(input: PersonalFlowInput): PersonalFlowResult {
  const effectiveWindowDays = clampWindowDays(input.windowDays);
  const todayMs = Date.parse(input.todayIso);
  const windowStartMs = todayMs - effectiveWindowDays * MILLISECONDS_PER_DAY;

  const perIssue = buildQualifyingMetrics(
    input.issues,
    input.statusCategoryByStatusId,
    windowStartMs,
    todayMs,
  );
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

/** Clamps windowDays up to a minimum of 1 so throughput is never divided by zero. */
function clampWindowDays(windowDays: number): number {
  return windowDays > MINIMUM_WINDOW_DAYS ? windowDays : MINIMUM_WINDOW_DAYS;
}

// ── Business-time helper ─────────────────────────────────────────────────────

/**
 * Returns the milliseconds between two epoch instants that fall on a Monday–Friday.
 *
 * Weekends (Saturday and Sunday) contribute nothing; partial days are counted
 * proportionally. The day-of-week test uses UTC (`getUTCDay`) consistently so the
 * result is stable regardless of the machine's local timezone. Returns 0 when the
 * end is not strictly after the start.
 */
export function businessMillisBetween(startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;

  let businessMillis = 0;
  let cursorMs = startMs;
  while (cursorMs < endMs) {
    const nextUtcMidnightMs = Math.floor(cursorMs / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY
      + MILLISECONDS_PER_DAY;
    const segmentEndMs = Math.min(nextUtcMidnightMs, endMs);
    if (isWorkday(cursorMs)) {
      businessMillis += segmentEndMs - cursorMs;
    }
    cursorMs = segmentEndMs;
  }
  return businessMillis;
}

/** Reports whether the UTC calendar day containing the given instant is Monday–Friday. */
function isWorkday(instantMs: number): boolean {
  const dayOfWeek = new Date(instantMs).getUTCDay();
  return dayOfWeek >= FIRST_WORKDAY_INDEX && dayOfWeek <= LAST_WORKDAY_INDEX;
}

// ── Per-issue evaluation ─────────────────────────────────────────────────────

/**
 * Maps every issue to an optional qualifying metric and returns the survivors,
 * sorted most-recently-active first (tie-broken by key) for a deterministic order.
 */
function buildQualifyingMetrics(
  issues: readonly PersonalFlowIssue[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  windowStartMs: number,
  todayMs: number,
): PersonalFlowIssueMetric[] {
  const metrics: PersonalFlowIssueMetric[] = [];
  for (const issue of issues) {
    const metric = evaluateIssue(issue, statusCategoryByStatusId, windowStartMs, todayMs);
    if (metric !== null) metrics.push(metric);
  }
  return metrics.sort(compareByLastActiveThenKey);
}

/**
 * Evaluates one issue into a metric, or null when it does not qualify. An issue
 * qualifies only when it has at least one COMPLETED ownership stint whose completion
 * falls in the window AND whose hands-on in-progress working time is greater than
 * zero — i.e. the target actually advanced real in-progress work she then finished
 * or handed off inside the window.
 */
function evaluateIssue(
  issue: PersonalFlowIssue,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  windowStartMs: number,
  todayMs: number,
): PersonalFlowIssueMetric | null {
  const originMs = resolveOriginMs(issue, todayMs);
  const categorySegments = buildCategorySegments(issue, statusCategoryByStatusId, originMs, todayMs);
  const ownershipIntervals = buildOwnershipIntervals(issue, originMs, todayMs);
  const doneTimesMs = collectDoneTimesMs(issue, statusCategoryByStatusId);

  const contributions = collectCompletedContributions(ownershipIntervals, categorySegments, doneTimesMs, todayMs);
  const inWindow = contributions.filter((one) => one.endMs >= windowStartMs && one.endMs <= todayMs);
  if (inWindow.length === 0) return null;

  const cycleTimeDays = inWindow.reduce((runningTotal, one) => runningTotal + one.handsOnDays, 0);
  if (cycleTimeDays <= 0) return null; // completed, but no real in-progress work -> not counted

  const lastActiveMs = inWindow.reduce((latest, one) => Math.max(latest, one.endMs), Number.NEGATIVE_INFINITY);
  return {
    key: issue.key,
    summary: issue.summary,
    storyPoints: issue.storyPoints,
    cycleTimeDays,
    lastActiveIso: new Date(lastActiveMs).toISOString(),
  };
}

/**
 * Resolves the anchor time both timelines start from: the issue's creation time,
 * falling back to the earliest transition timestamp, or today when nothing dates it.
 */
function resolveOriginMs(issue: PersonalFlowIssue, todayMs: number): number {
  const createdMs = parseIsoOrNull(issue.createdIso);
  if (createdMs !== null) return createdMs;

  const transitionTimes = [
    ...issue.statusTransitions.map((transition) => transition.atIso),
    ...issue.ownershipTransitions.map((transition) => transition.atIso),
  ]
    .map(parseIsoOrNull)
    .filter((atMs): atMs is number => atMs !== null);
  return transitionTimes.length > 0 ? Math.min(...transitionTimes) : todayMs;
}

// ── Timeline reconstruction ──────────────────────────────────────────────────

/** Builds the issue's status-category segments from its initial status and later status changes. */
function buildCategorySegments(
  issue: PersonalFlowIssue,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  originMs: number,
  todayMs: number,
): StateSegment<string>[] {
  const initialCategory = categoryFor(issue.initialStatusId, statusCategoryByStatusId);
  const changePoints = issue.statusTransitions
    .map((transition) => ({
      atMs: parseIsoOrNull(transition.atIso),
      value: categoryFor(transition.toStatusId, statusCategoryByStatusId),
    }))
    .filter((point): point is { atMs: number; value: string } => point.atMs !== null);
  return buildStateSegments(originMs, initialCategory, changePoints, todayMs);
}

/** Builds the maximal spans during which the issue was assigned to the target person. */
function buildOwnershipIntervals(
  issue: PersonalFlowIssue,
  originMs: number,
  todayMs: number,
): OwnershipInterval[] {
  const changePoints = issue.ownershipTransitions
    .map((transition) => ({ atMs: parseIsoOrNull(transition.atIso), value: transition.assignedToTarget }))
    .filter((point): point is { atMs: number; value: boolean } => point.atMs !== null);
  const segments = buildStateSegments(originMs, issue.initiallyAssignedToTarget, changePoints, todayMs);

  const intervals: OwnershipInterval[] = [];
  for (const segment of segments) {
    if (segment.value !== true) continue;
    const lastInterval = intervals[intervals.length - 1];
    // Merge back-to-back "assigned" segments (a redundant re-assign to the same person) into one span.
    if (lastInterval !== undefined && lastInterval.endMs === segment.startMs) {
      lastInterval.endMs = segment.endMs;
    } else {
      intervals.push({ startMs: segment.startMs, endMs: segment.endMs });
    }
  }
  return intervals;
}

/**
 * Converts an initial value plus timestamped change points into contiguous, non-empty
 * segments spanning [originMs, todayMs]. Change points are clamped to the origin and
 * sorted ascending; when several share a timestamp the last one wins that instant.
 */
function buildStateSegments<TValue>(
  originMs: number,
  initialValue: TValue,
  changePoints: { atMs: number; value: TValue }[],
  todayMs: number,
): StateSegment<TValue>[] {
  const points = [
    { atMs: originMs, value: initialValue },
    ...changePoints.map((point) => ({ atMs: Math.max(point.atMs, originMs), value: point.value })),
  ].sort((first, second) => first.atMs - second.atMs);

  const segments: StateSegment<TValue>[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const startMs = points[index].atMs;
    const rawEndMs = index + 1 < points.length ? points[index + 1].atMs : todayMs;
    const endMs = Math.min(rawEndMs, todayMs);
    if (endMs > startMs) {
      segments.push({ startMs, endMs, value: points[index].value });
    }
  }
  return segments;
}

// ── Completion & hands-on accounting ─────────────────────────────────────────

/** Evaluates every ownership interval into a completed contribution, dropping the still-open ones. */
function collectCompletedContributions(
  intervals: readonly OwnershipInterval[],
  categorySegments: readonly StateSegment<string>[],
  doneTimesMs: readonly number[],
  todayMs: number,
): CompletedContribution[] {
  const contributions: CompletedContribution[] = [];
  for (const interval of intervals) {
    const contribution = evaluateInterval(interval, categorySegments, doneTimesMs, todayMs);
    if (contribution !== null) contributions.push(contribution);
  }
  return contributions;
}

/**
 * Turns one ownership interval into a completed contribution, or null when it is
 * still open. An interval is "completed" if she was reassigned away (a finite end
 * before today) OR the issue reached done within it. Its completion moment is the
 * earliest of those two events; its cycle credit is the Mon–Fri in-progress time.
 */
function evaluateInterval(
  interval: OwnershipInterval,
  categorySegments: readonly StateSegment<string>[],
  doneTimesMs: readonly number[],
  todayMs: number,
): CompletedContribution | null {
  const wasReassignedAway = interval.endMs < todayMs;
  const firstDoneMs = findFirstDoneWithin(doneTimesMs, interval);
  if (firstDoneMs === null && !wasReassignedAway) return null;

  const endMs = pickEarliestEnd(firstDoneMs, wasReassignedAway ? interval.endMs : null);
  const handsOnMs = businessMillisInCategory(
    categorySegments,
    interval.startMs,
    interval.endMs,
    STATUS_CATEGORY_IN_PROGRESS,
  );
  return { endMs, handsOnDays: handsOnMs / MILLISECONDS_PER_DAY };
}

/** Returns the earliest done timestamp that falls inside the interval, or null when none do. */
function findFirstDoneWithin(doneTimesMs: readonly number[], interval: OwnershipInterval): number | null {
  for (const doneMs of doneTimesMs) {
    if (doneMs >= interval.startMs && doneMs <= interval.endMs) return doneMs;
  }
  return null;
}

/** Returns the earliest of two candidate end times; at least one is always provided. */
function pickEarliestEnd(firstCandidate: number | null, secondCandidate: number | null): number {
  if (firstCandidate === null) return secondCandidate as number;
  if (secondCandidate === null) return firstCandidate;
  return Math.min(firstCandidate, secondCandidate);
}

/** Sums the Mon–Fri milliseconds the category-timeline spent in the given category within a range. */
function businessMillisInCategory(
  categorySegments: readonly StateSegment<string>[],
  rangeStartMs: number,
  rangeEndMs: number,
  category: string,
): number {
  let total = 0;
  for (const segment of categorySegments) {
    if (segment.value !== category) continue;
    const overlapStartMs = Math.max(segment.startMs, rangeStartMs);
    const overlapEndMs = Math.min(segment.endMs, rangeEndMs);
    if (overlapEndMs > overlapStartMs) {
      total += businessMillisBetween(overlapStartMs, overlapEndMs);
    }
  }
  return total;
}

/** Collects, ascending, the timestamps at which the issue transitioned into a done-category status. */
function collectDoneTimesMs(
  issue: PersonalFlowIssue,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
): number[] {
  return issue.statusTransitions
    .filter((transition) => categoryFor(transition.toStatusId, statusCategoryByStatusId) === STATUS_CATEGORY_DONE)
    .map((transition) => parseIsoOrNull(transition.atIso))
    .filter((atMs): atMs is number => atMs !== null)
    .sort((first, second) => first - second);
}

/** Resolves a status id to its category, defaulting a null or unknown id to the 'new' category. */
function categoryFor(
  statusId: string | null,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
): string {
  if (statusId === null) return STATUS_CATEGORY_NEW;
  return statusCategoryByStatusId[statusId] ?? STATUS_CATEGORY_NEW;
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/** Orders rows by lastActiveIso descending, then by key ascending as a stable tie-break. */
function compareByLastActiveThenKey(
  first: PersonalFlowIssueMetric,
  second: PersonalFlowIssueMetric,
): number {
  const firstMs = parseIsoOrNull(first.lastActiveIso) ?? 0;
  const secondMs = parseIsoOrNull(second.lastActiveIso) ?? 0;
  if (firstMs !== secondMs) return secondMs - firstMs; // most recent first
  return first.key < second.key ? -1 : first.key > second.key ? 1 : 0;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

/** Sums story points across issue rows, treating a null point value as zero. */
function sumStoryPoints(metrics: readonly PersonalFlowIssueMetric[]): number {
  return metrics.reduce((runningTotal, metric) => runningTotal + (metric.storyPoints ?? 0), 0);
}

/** Builds per-day, per-week, and per-two-week CALENDAR rates for both issues and points. */
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

/** Computes average, median, and count over the qualifying issues' hands-on cycle times. */
function buildCycleTimeStats(metrics: readonly PersonalFlowIssueMetric[]): PersonalFlowCycleTime {
  const cycleTimes = metrics
    .map((metric) => metric.cycleTimeDays)
    .filter((cycleTimeDays): cycleTimeDays is number => cycleTimeDays !== null && cycleTimeDays > 0)
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
 * Returns the median of an already-ascending, non-empty list: the middle value for
 * an odd count, or the mean of the two middle values for an even count.
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
