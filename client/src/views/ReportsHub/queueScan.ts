// queueScan.ts — Finding where work is piling up, without being told where to look.
//
// The existing bottleneck panel asks which statuses count as internal testing, then measures the wait
// in those. That is backwards for the question people actually have. A report that has to be told
// where the bottleneck is cannot tell you where the bottleneck is — it can only confirm a guess, and
// the guess is the part that was hard.
//
// So this measures every status the work is actually sitting in, and ranks them. The stage holding the
// most accumulated waiting is the constraint, whatever it happens to be called on this board and
// whether or not anybody thought to nominate it.
//
// Two decisions shape what it reports:
//
//   - IT RANKS BY TOTAL WAITING, NOT BY COUNT. Thirty issues that arrived yesterday are not a
//     bottleneck; four that have been sitting a month are. Total days is the measure that tells those
//     apart, and the count alone is the one that confuses them.
//   - THE WAIT IS CALENDAR DAYS. A ticket untouched over a weekend has still been waiting, and a queue
//     that quietly discounts weekends under-reports itself by two days in every seven.
//
// Pure: no fetch, no storage, and the clock is passed in.

const MILLISECONDS_PER_DAY = 86_400_000;

/** Shown in the holder rollup when nobody is assigned, so the column never reads blank. */
const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Jira's own category for work that has not been picked up yet.
 *
 * The distinction is load-bearing rather than cosmetic. Ranked together, the BACKLOG wins every time:
 * a first run named "To Do" as the constraint on the strength of 62 issues holding 3,540 waiting days,
 * which is not a bottleneck at all — it is inventory, and it drowned the twelve items sitting in
 * shift-left testing that were the actual finding.
 *
 * A bottleneck is a queue INSIDE the flow. Work nobody has started is a different problem with a
 * different fix, so it is measured, reported, and kept out of the ranking.
 */
const NOT_STARTED_CATEGORY_KEY = 'new';

/** One issue sitting somewhere, with how long it has been there. */
export interface QueueIssueInput {
  key: string;
  summary: string;
  statusName: string;
  assigneeName: string | null;
  /** When it entered its current status. Null when history did not say, and then it is not aged. */
  enteredStatusIso: string | null;
  storyPoints: number | null;
  /** Jira's own status category: 'new' has not been started, anything else is in flight. */
  statusCategoryKey: string;
}

/** One issue's wait, once measured. */
export interface QueuedIssue {
  key: string;
  summary: string;
  statusName: string;
  assigneeName: string;
  waitingDays: number;
  storyPoints: number | null;
  /** False while nobody has picked it up — backlog rather than a queue in the flow. */
  hasStarted: boolean;
}

/** One stage's queue. */
export interface QueueStage {
  statusName: string;
  issueCount: number;
  /** Every waiting day held in this stage. The measure the ranking uses. */
  totalWaitingDays: number;
  /** The middle wait, so one ancient ticket does not describe the stage. */
  medianWaitingDays: number;
  /** The longest wait in the stage — the one worth naming out loud. */
  longestWaitingDays: number;
  storyPoints: number;
  /** False for a backlog stage, which is measured but never ranked as the constraint. */
  hasStarted: boolean;
}

/** One person's share of the waiting, across every stage. */
export interface QueueHolder {
  holderName: string;
  issueCount: number;
  totalWaitingDays: number;
}

/** What the scan found. */
export interface QueueScanResult {
  /** Every stage holding work, worst first. */
  stages: QueueStage[];
  /** Who is holding the waiting, worst first. */
  holders: QueueHolder[];
  /** Every issue measured, longest wait first. */
  issues: QueuedIssue[];
  totalIssueCount: number;
  totalWaitingDays: number;
  /** Issues whose entry date history did not give, so they could not be aged. */
  undatedCount: number;
  /** Work nobody has started: a real problem, but a different one from a queue in the flow. */
  notStartedCount: number;
  /** The longest anything has sat unstarted — the age of the oldest thing in the backlog. */
  notStartedOldestDays: number;
}

/** Calendar days since a moment, or null when the timestamp is missing or unreadable. */
export function calendarDaysWaiting(enteredIso: string | null, nowMs: number): number | null {
  if (enteredIso === null) {
    return null;
  }
  const enteredMs = Date.parse(enteredIso);
  if (Number.isNaN(enteredMs)) {
    return null;
  }
  return Math.max(0, Math.round(((nowMs - enteredMs) / MILLISECONDS_PER_DAY) * 10) / 10);
}

/** The middle value, or 0 for an empty set. */
function readMedian(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const middleIndex = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
    : sorted[middleIndex];
  return Math.round(median * 10) / 10;
}

/** Rounds a day total to one decimal, which is as precise as a queue reading deserves. */
function roundDays(days: number): number {
  return Math.round(days * 10) / 10;
}

/** Rolls the measured issues up by the status they are sitting in. */
function buildStages(issues: readonly QueuedIssue[]): QueueStage[] {
  const issuesByStatus = new Map<string, QueuedIssue[]>();
  issues.forEach((issue) => {
    const stageIssues = issuesByStatus.get(issue.statusName) ?? [];
    stageIssues.push(issue);
    issuesByStatus.set(issue.statusName, stageIssues);
  });

  const stages = [...issuesByStatus.entries()].map(([statusName, stageIssues]): QueueStage => ({
    statusName,
    issueCount: stageIssues.length,
    totalWaitingDays: roundDays(stageIssues.reduce((total, issue) => total + issue.waitingDays, 0)),
    medianWaitingDays: readMedian(stageIssues.map((issue) => issue.waitingDays)),
    longestWaitingDays: roundDays(Math.max(...stageIssues.map((issue) => issue.waitingDays))),
    storyPoints: stageIssues.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0),
    hasStarted: stageIssues[0].hasStarted,
  }));

  // Ranked by ACCUMULATED waiting: thirty issues that arrived yesterday are not a bottleneck, and four
  // that have sat a month are. Count alone cannot tell those apart.
  return stages.sort((first, second) => second.totalWaitingDays - first.totalWaitingDays
    || first.statusName.localeCompare(second.statusName));
}

/** Rolls the measured issues up by who is holding them. */
function buildHolders(issues: readonly QueuedIssue[]): QueueHolder[] {
  const issuesByHolder = new Map<string, QueuedIssue[]>();
  issues.forEach((issue) => {
    const heldIssues = issuesByHolder.get(issue.assigneeName) ?? [];
    heldIssues.push(issue);
    issuesByHolder.set(issue.assigneeName, heldIssues);
  });

  return [...issuesByHolder.entries()]
    .map(([holderName, heldIssues]): QueueHolder => ({
      holderName,
      issueCount: heldIssues.length,
      totalWaitingDays: roundDays(heldIssues.reduce((total, issue) => total + issue.waitingDays, 0)),
    }))
    .sort((first, second) => second.totalWaitingDays - first.totalWaitingDays
      || first.holderName.localeCompare(second.holderName));
}

/**
 * Measures where the open work is sitting and how long it has been there.
 *
 * An issue whose entry date could not be read is counted separately rather than aged at zero: a
 * silent zero would drag a stage's median down and make a queue look healthier than it is.
 */
export function scanQueues(issues: readonly QueueIssueInput[], nowMs: number): QueueScanResult {
  const measured: QueuedIssue[] = [];
  let undatedCount = 0;

  issues.forEach((issue) => {
    const waitingDays = calendarDaysWaiting(issue.enteredStatusIso, nowMs);
    if (waitingDays === null) {
      undatedCount += 1;
      return;
    }
    measured.push({
      key: issue.key,
      summary: issue.summary,
      statusName: issue.statusName,
      assigneeName: issue.assigneeName ?? UNASSIGNED_LABEL,
      waitingDays,
      storyPoints: issue.storyPoints,
      hasStarted: issue.statusCategoryKey !== NOT_STARTED_CATEGORY_KEY,
    });
  });

  measured.sort((first, second) => second.waitingDays - first.waitingDays
    || first.key.localeCompare(second.key));

  const notStarted = measured.filter((issue) => !issue.hasStarted);

  return {
    stages: buildStages(measured),
    holders: buildHolders(measured),
    issues: measured,
    totalIssueCount: measured.length,
    totalWaitingDays: roundDays(measured.reduce((total, issue) => total + issue.waitingDays, 0)),
    undatedCount,
    notStartedCount: notStarted.length,
    notStartedOldestDays: notStarted.length === 0
      ? 0
      : roundDays(Math.max(...notStarted.map((issue) => issue.waitingDays))),
  };
}

/** Stages that are actually in the flow — the only ones that can be a bottleneck. */
export function readInFlightStages(result: QueueScanResult): QueueStage[] {
  return result.stages.filter((stage) => stage.hasStarted);
}

/** Stages holding work nobody has started — the backlog, measured but never ranked. */
export function readBacklogStages(result: QueueScanResult): QueueStage[] {
  return result.stages.filter((stage) => !stage.hasStarted);
}

/**
 * The stage the flow is actually stuck in, or null when nothing has been started.
 *
 * Read from the IN-FLIGHT stages only. Ranked against the backlog, the backlog wins every time and
 * names itself the constraint, which is both true and useless: work nobody has started is inventory,
 * and the fix for inventory is not the fix for a queue.
 */
export function readConstraintStage(result: QueueScanResult): QueueStage | null {
  return readInFlightStages(result)[0] ?? null;
}

/**
 * Names the constraint, in one sentence.
 *
 * The share is stated against the waiting IN THE FLOW rather than against everything, so a backlog
 * five times the size of the work in progress cannot make a real bottleneck look like a rounding error.
 */
export function describeConstraint(result: QueueScanResult): string {
  const constraintStage = readConstraintStage(result);
  if (constraintStage === null) {
    return result.notStartedCount > 0
      ? `Nothing has been started — all ${result.notStartedCount} open issue(s) are still waiting to be `
        + 'picked up, so there is no queue in the flow to be stuck in.'
      : 'Nothing is waiting — no open work was found in this scope.';
  }

  const inFlightWaitingDays = readInFlightStages(result)
    .reduce((total, stage) => total + stage.totalWaitingDays, 0);
  const sharePercent = inFlightWaitingDays > 0
    ? Math.round((constraintStage.totalWaitingDays / inFlightWaitingDays) * 100)
    : 0;

  return `Of the work that has been started, it is piling up most in ${constraintStage.statusName}: `
    + `${constraintStage.issueCount} issue(s) holding ${constraintStage.totalWaitingDays} waiting days — `
    + `${sharePercent}% of all the waiting inside the flow. The middle one has been there `
    + `${constraintStage.medianWaitingDays} days; the oldest, ${constraintStage.longestWaitingDays}.`;
}

/** Says what is sitting unstarted, which is a real finding but not the constraint. */
export function describeBacklog(result: QueueScanResult): string {
  if (result.notStartedCount === 0) {
    return 'Everything open has been started.';
  }
  return `${result.notStartedCount} open issue(s) have not been started at all; the oldest has been `
    + `waiting ${result.notStartedOldestDays} days. That is inventory rather than a bottleneck — it is `
    + 'not ranked above, because the fix for a backlog is not the fix for a queue.';
}
