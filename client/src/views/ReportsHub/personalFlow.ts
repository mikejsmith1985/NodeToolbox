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
  // Summed hands-on working days across in-window completed stints. Null means the issue COMPLETED
  // under the person but no in-progress time could be measured (e.g. To-Do → Done, or an unmapped
  // status) — it still counts as advanced, but is excluded from the cycle-time average/median.
  cycleTimeDays: number | null;
  lastActiveIso: string | null; // ISO of the latest in-window completion moment
}

/**
 * Why a fetched issue was NOT credited, in the order the engine tests them:
 *   • 'not-owned'               — the target never appears in the issue's ownership timeline.
 *   • 'wip-open'                — she still holds it and it never reached done (a WIP, still-open stint).
 *   • 'completed-out-of-window' — her stint completed, but before the reporting window began.
 *
 * A completed, in-window issue is now ALWAYS credited — even with zero measurable in-progress time —
 * so "no in-progress time" is no longer an exclusion reason. Such issues carry a null cycle time instead.
 */
export type PersonalFlowExclusionReason =
  | 'not-owned'
  | 'wip-open'
  | 'completed-out-of-window';

/** One fetched-but-not-credited issue, carrying the reason it was dropped for the audit breakdown. */
export interface PersonalFlowExcludedIssue {
  key: string;
  summary: string;
  reason: PersonalFlowExclusionReason;
}

/** The full Personal Flow result: window summary, throughput, cycle time, and per-issue rows. */
export interface PersonalFlowResult {
  windowDays: number;
  issueCount: number; // issues she moved forward within the window
  totalStoryPoints: number; // summed over those issues (null points = 0)
  throughput: PersonalFlowThroughput;
  cycleTime: PersonalFlowCycleTime;
  perIssue: PersonalFlowIssueMetric[]; // one row per CREDITED issue, most-recently-active first
  excludedIssues: PersonalFlowExcludedIssue[]; // fetched issues that were not credited, in fetch order, with why
  // Diagnostic partition of the SAME credited hands-on time, split by the individual in-progress status id it
  // was spent in (statusId -> hands-on DAYS), aggregated across all credited issues. It reveals WHERE the
  // hands-on days land — e.g. how much sat in a queue-like "Ready to Work" status versus a real "Working" one.
  // It only partitions the existing total: the sum of its values equals the sum of the credited cycle-time days.
  handsOnDaysByStatusId: Record<string, number>;
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
  // The same hands-on time as `handsOnDays`, but kept in milliseconds and split by the in-progress status id
  // it was spent in — so the credited total can be partitioned by status without re-deriving it.
  handsOnMillisByStatusId: Record<string, number>;
}

/**
 * The outcome of evaluating one issue: either a CREDITED metric, or an exclusion with its reason.
 * Discriminating on `kind` lets the caller split the fetched issues into the credited per-issue rows
 * and the audit list of what was dropped and why — without a second, duplicate evaluation pass.
 */
type IssueEvaluation =
  | {
      readonly kind: 'credited';
      readonly metric: PersonalFlowIssueMetric;
      // The credited hands-on time (milliseconds) split by in-progress status id, so the aggregate can
      // partition the grand total by status. Not surfaced on the per-issue row — it feeds the summary only.
      readonly handsOnMillisByStatusId: Record<string, number>;
    }
  | { readonly kind: 'excluded'; readonly reason: PersonalFlowExclusionReason };

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Computes one person's hands-on cycle time and calendar throughput from her issues.
 *
 * The pipeline clamps the window, evaluates each issue into an optional qualifying
 * metric (any completed, in-window stint — with or without measurable hands-on time),
 * then aggregates throughput and cycle-time statistics over the survivors. It never
 * reads the clock — `input.todayIso` anchors the window — so it is a pure function.
 */
export function computePersonalFlow(input: PersonalFlowInput): PersonalFlowResult {
  const effectiveWindowDays = clampWindowDays(input.windowDays);
  const todayMs = Date.parse(input.todayIso);
  const windowStartMs = todayMs - effectiveWindowDays * MILLISECONDS_PER_DAY;

  const { perIssue, excludedIssues, handsOnDaysByStatusId } = buildIssueBreakdown(
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
    excludedIssues,
    handsOnDaysByStatusId,
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
 * Splits every fetched issue into the CREDITED per-issue metrics and the EXCLUDED audit rows.
 * Credited rows are sorted most-recently-active first (tie-broken by key); excluded rows keep the
 * original fetch order so the audit reads in the same sequence Jira returned — both deterministic.
 */
function buildIssueBreakdown(
  issues: readonly PersonalFlowIssue[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  windowStartMs: number,
  todayMs: number,
): {
  perIssue: PersonalFlowIssueMetric[];
  excludedIssues: PersonalFlowExcludedIssue[];
  handsOnDaysByStatusId: Record<string, number>;
} {
  const perIssue: PersonalFlowIssueMetric[] = [];
  const excludedIssues: PersonalFlowExcludedIssue[] = [];
  const totalHandsOnMillisByStatusId: Record<string, number> = {};
  for (const issue of issues) {
    const evaluation = evaluateIssue(issue, statusCategoryByStatusId, windowStartMs, todayMs);
    if (evaluation.kind === 'credited') {
      perIssue.push(evaluation.metric);
      addMillisByStatusId(totalHandsOnMillisByStatusId, evaluation.handsOnMillisByStatusId);
    } else {
      excludedIssues.push({ key: issue.key, summary: issue.summary, reason: evaluation.reason });
    }
  }
  perIssue.sort(compareByLastActiveThenKey);
  return {
    perIssue,
    excludedIssues,
    handsOnDaysByStatusId: convertMillisByStatusIdToDays(totalHandsOnMillisByStatusId),
  };
}

/**
 * Evaluates one issue into a CREDITED metric or an EXCLUDED reason. An issue qualifies whenever it has
 * at least one COMPLETED ownership stint whose completion falls in the window — regardless of how much
 * hands-on in-progress time was measured. The reasons are tested in a fixed precedence so a dropped
 * issue reports the FIRST gate it failed: never owned, then still WIP, then completed out of window.
 * A completed issue with zero measurable hands-on time is still credited, with a null cycle time.
 */
function evaluateIssue(
  issue: PersonalFlowIssue,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  windowStartMs: number,
  todayMs: number,
): IssueEvaluation {
  const originMs = resolveOriginMs(issue, todayMs);
  const statusIdSegments = buildStatusIdSegments(issue, originMs, todayMs);
  const ownershipIntervals = buildOwnershipIntervals(issue, originMs, todayMs);
  if (ownershipIntervals.length === 0) return { kind: 'excluded', reason: 'not-owned' };

  const doneTimesMs = collectDoneTimesMs(issue, statusCategoryByStatusId);
  const contributions = collectCompletedContributions(
    ownershipIntervals, statusIdSegments, statusCategoryByStatusId, doneTimesMs, todayMs,
  );
  if (contributions.length === 0) return { kind: 'excluded', reason: 'wip-open' };

  const inWindow = contributions.filter((one) => one.endMs >= windowStartMs && one.endMs <= todayMs);
  if (inWindow.length === 0) return { kind: 'excluded', reason: 'completed-out-of-window' };

  // The issue completed in-window, so it counts. A summed hands-on total of zero means no in-progress
  // time could be measured (e.g. To-Do → Done under her); record that as null, not a misleading 0.00,
  // so the issue still advances throughput while staying out of the honest cycle-time average/median.
  const summedHandsOnDays = inWindow.reduce((runningTotal, one) => runningTotal + one.handsOnDays, 0);
  const cycleTimeDays = summedHandsOnDays > 0 ? summedHandsOnDays : null;

  const lastActiveMs = inWindow.reduce((latest, one) => Math.max(latest, one.endMs), Number.NEGATIVE_INFINITY);
  return {
    kind: 'credited',
    metric: {
      key: issue.key,
      summary: issue.summary,
      storyPoints: issue.storyPoints,
      cycleTimeDays,
      lastActiveIso: new Date(lastActiveMs).toISOString(),
    },
    handsOnMillisByStatusId: sumContributionMillisByStatusId(inWindow),
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

/**
 * Builds the issue's status-id segments from its initial status and later status changes. Each segment
 * carries the raw status id it held over that span (null = created with no recorded status); a segment's
 * category is derived on demand via `categoryFor`, so the one timeline serves both the category-based
 * accounting and the per-status hands-on breakdown without a second reconstruction pass.
 */
function buildStatusIdSegments(
  issue: PersonalFlowIssue,
  originMs: number,
  todayMs: number,
): StateSegment<string | null>[] {
  const changePoints = issue.statusTransitions
    .map((transition) => ({
      atMs: parseIsoOrNull(transition.atIso),
      value: transition.toStatusId as string | null,
    }))
    .filter((point): point is { atMs: number; value: string | null } => point.atMs !== null);
  return buildStateSegments(originMs, issue.initialStatusId, changePoints, todayMs);
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
  statusIdSegments: readonly StateSegment<string | null>[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  doneTimesMs: readonly number[],
  todayMs: number,
): CompletedContribution[] {
  const contributions: CompletedContribution[] = [];
  for (const interval of intervals) {
    const contribution = evaluateInterval(
      interval, statusIdSegments, statusCategoryByStatusId, doneTimesMs, todayMs,
    );
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
  statusIdSegments: readonly StateSegment<string | null>[],
  statusCategoryByStatusId: Readonly<Record<string, string>>,
  doneTimesMs: readonly number[],
  todayMs: number,
): CompletedContribution | null {
  const wasReassignedAway = interval.endMs < todayMs;
  const firstDoneMs = findFirstDoneWithin(doneTimesMs, interval);
  if (firstDoneMs === null && !wasReassignedAway) return null;

  const endMs = pickEarliestEnd(firstDoneMs, wasReassignedAway ? interval.endMs : null);
  // Split the Mon–Fri in-progress time over the ownership interval by status id; the total hands-on time
  // is just the sum of that split, so the credited cycle time and its per-status breakdown always agree.
  const handsOnMillisByStatusId = inProgressBusinessMillisByStatusId(
    statusIdSegments,
    interval.startMs,
    interval.endMs,
    statusCategoryByStatusId,
  );
  const handsOnMs = sumRecordValues(handsOnMillisByStatusId);
  return { endMs, handsOnDays: handsOnMs / MILLISECONDS_PER_DAY, handsOnMillisByStatusId };
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

/**
 * Splits the Mon–Fri business milliseconds spent in an IN-PROGRESS status within [rangeStart, rangeEnd] by
 * the individual status id (statusId -> milliseconds). Only statuses whose category is 'indeterminate' are
 * counted, so the summed values equal the total in-progress business time for the same range — this
 * partitions the hands-on time by status without changing it.
 */
function inProgressBusinessMillisByStatusId(
  statusIdSegments: readonly StateSegment<string | null>[],
  rangeStartMs: number,
  rangeEndMs: number,
  statusCategoryByStatusId: Readonly<Record<string, string>>,
): Record<string, number> {
  const millisByStatusId: Record<string, number> = {};
  for (const segment of statusIdSegments) {
    const statusId = segment.value;
    // A null status id can never be 'indeterminate' (it maps to 'new'); skip it so the key is always real.
    if (statusId === null) continue;
    if (categoryFor(statusId, statusCategoryByStatusId) !== STATUS_CATEGORY_IN_PROGRESS) continue;
    const overlapStartMs = Math.max(segment.startMs, rangeStartMs);
    const overlapEndMs = Math.min(segment.endMs, rangeEndMs);
    if (overlapEndMs <= overlapStartMs) continue;
    millisByStatusId[statusId] = (millisByStatusId[statusId] ?? 0) + businessMillisBetween(overlapStartMs, overlapEndMs);
  }
  return millisByStatusId;
}

/** Merges each contribution's per-status hands-on milliseconds into one map for a single issue. */
function sumContributionMillisByStatusId(contributions: readonly CompletedContribution[]): Record<string, number> {
  const millisByStatusId: Record<string, number> = {};
  for (const contribution of contributions) {
    addMillisByStatusId(millisByStatusId, contribution.handsOnMillisByStatusId);
  }
  return millisByStatusId;
}

/** Adds every statusId -> milliseconds entry from `source` into the running `target` map, in place. */
function addMillisByStatusId(target: Record<string, number>, source: Readonly<Record<string, number>>): void {
  for (const [statusId, millis] of Object.entries(source)) {
    target[statusId] = (target[statusId] ?? 0) + millis;
  }
}

/** Converts a statusId -> milliseconds map into a statusId -> DAYS map (milliseconds / one calendar day). */
function convertMillisByStatusIdToDays(millisByStatusId: Readonly<Record<string, number>>): Record<string, number> {
  const daysByStatusId: Record<string, number> = {};
  for (const [statusId, millis] of Object.entries(millisByStatusId)) {
    daysByStatusId[statusId] = millis / MILLISECONDS_PER_DAY;
  }
  return daysByStatusId;
}

/** Sums the numeric values of a statusId -> number map (used to total a per-status millisecond split). */
function sumRecordValues(record: Readonly<Record<string, number>>): number {
  return Object.values(record).reduce((runningTotal, value) => runningTotal + value, 0);
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
