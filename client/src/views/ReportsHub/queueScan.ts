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

/** One issue sitting somewhere, with how long it has been there. */
export interface QueueIssueInput {
  key: string;
  summary: string;
  statusName: string;
  assigneeName: string | null;
  /** When it entered its current status. Null when history did not say, and then it is not aged. */
  enteredStatusIso: string | null;
  storyPoints: number | null;
}

/** One issue's wait, once measured. */
export interface QueuedIssue {
  key: string;
  summary: string;
  statusName: string;
  assigneeName: string;
  waitingDays: number;
  storyPoints: number | null;
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
    });
  });

  measured.sort((first, second) => second.waitingDays - first.waitingDays
    || first.key.localeCompare(second.key));

  return {
    stages: buildStages(measured),
    holders: buildHolders(measured),
    issues: measured,
    totalIssueCount: measured.length,
    totalWaitingDays: roundDays(measured.reduce((total, issue) => total + issue.waitingDays, 0)),
    undatedCount,
  };
}

/**
 * Names the constraint, in one sentence.
 *
 * States the stage's SHARE of all the waiting, because "112 days in Ready for Testing" means nothing
 * on its own and "41% of every waiting day on this board" is the whole finding.
 */
export function describeConstraint(result: QueueScanResult): string {
  if (result.stages.length === 0) {
    return 'Nothing is waiting — no open work was found in this scope.';
  }

  const [worstStage] = result.stages;
  const sharePercent = result.totalWaitingDays > 0
    ? Math.round((worstStage.totalWaitingDays / result.totalWaitingDays) * 100)
    : 0;

  return `Work is piling up most in ${worstStage.statusName}: ${worstStage.issueCount} issue(s) holding `
    + `${worstStage.totalWaitingDays} waiting days — ${sharePercent}% of all the waiting in this scope. `
    + `The middle one has been there ${worstStage.medianWaitingDays} days; the oldest, `
    + `${worstStage.longestWaitingDays}.`;
}
