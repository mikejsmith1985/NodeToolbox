// reworkScan.ts — Finding the work that was done twice and charged once.
//
// A story that stays open until the whole downstream chain finishes absorbs its own rework for free.
// A defect comes back from shift-left testing, or from QE, or from business testing; the developer
// fixes it inside the open ticket; no points are added, no new item is created, and the cost of that
// round trip is recorded precisely nowhere. Nobody hid it — the process never asked for it.
//
// The evidence, though, is already sitting in the changelog. An issue that reached delivery — the
// team's own line, "Ready for QA" or beyond — and then moved BACKWARDS out of it went round again.
//
// What the report is FOR decides what counts. The useful question is not "how many tickets moved
// backwards" but "when work comes back, what does it cost to recover" — a flow figure, in days. Three
// rules keep that figure honest, and each of them exists because the first version reported a number
// that was true and useless:
//
//   - AN ABANDONED ISSUE IS NOT REWORK. Falling into Cancelled means the work stopped, not that it was
//     done again. Counting it inflated the total with work nobody ever redid.
//   - A SAME-DAY BOUNCE IS NOT REWORK. A ticket corrected minutes after a mis-click is somebody fixing
//     a mistake in Jira, not a developer doing the job twice.
//   - WORK STILL OUT IS REPORTED SEPARATELY. Its clock is still running, so averaging it in with
//     settled round trips produces a "cost per return" that no completed return ever cost.
//
// Pure: no fetch, no storage, and the clock is passed in.

import { businessMillisBetween, MILLISECONDS_PER_DAY, parseIsoOrNull } from './issueTimeline.ts';
import { isDeliveredWorkflowStatusName } from '../../utils/workflowDelivery.ts';

/**
 * Statuses that mean the work STOPPED rather than went round again.
 *
 * An issue moving into one of these has been abandoned. It is not rework, and counting it was putting
 * days into the total that nobody ever spent redoing anything.
 */
const ABANDONED_STATUS_NAMES = ['cancelled', 'canceled', 'rejected', 'withdrawn', 'duplicate', "won't do", 'wont do'];

/**
 * Round trips shorter than this are corrections, not rework.
 *
 * Half a working day. A ticket that fell out of delivery and climbed back the same afternoon is
 * somebody fixing a mis-click; treating it as a developer doing the job twice put eight rows of zeroes
 * into a table that was supposed to be evidence.
 */
export const MINIMUM_REWORK_WORKING_DAYS = 0.5;

/** One status change from an issue's changelog: the status it moved TO, and when. */
export interface ReworkStatusTransition {
  toStatusName: string;
  atIso: string;
}

/** One issue's history, reduced to what finding rework needs. */
export interface ReworkIssue {
  key: string;
  summary: string;
  storyPoints: number | null;
  assigneeName: string | null;
  /** The status it was in at creation, or null when unknown. */
  initialStatusName: string | null;
  /** Status changes in any order — they are sorted here. */
  statusTransitions: readonly ReworkStatusTransition[];
}

/** Why a round trip was not counted, so an excluded one is never silently dropped. */
export type ExcludedReworkReason = 'abandoned' | 'too-short';

/** One round trip: the issue left delivery, and either came back or has not yet. */
export interface ReworkRound {
  /** When it fell out of delivery. */
  leftAtIso: string;
  /** The status it fell back INTO — the best available answer to "who sent it back". */
  fellBackToStatus: string;
  /** When it regained delivery, or null when it is still out. */
  returnedAtIso: string | null;
  /** Working days spent out of delivery. Measured to today while it is still out. */
  workingDays: number;
  /** True while the issue has not yet climbed back — an open cost, not a settled one. */
  isStillOut: boolean;
}

/** One issue's rework history. */
export interface ReworkIssueResult {
  key: string;
  summary: string;
  storyPoints: number | null;
  assigneeName: string | null;
  rounds: ReworkRound[];
  /** Working days across every round. */
  totalWorkingDays: number;
}

/** What the whole scan found. */
export interface ReworkScanResult {
  /** Every issue that went round again, worst first. */
  issues: ReworkIssueResult[];
  /** How many issues were examined, so a rate can be stated rather than a bare count. */
  examinedCount: number;
  /** Issues that reached delivery at least once — the only ones that COULD show rework. */
  deliveredCount: number;
  /** Issues that fell back at least once. */
  reworkedCount: number;
  /** Every counted round across every issue. */
  totalRounds: number;
  /** Working days of rework across every counted round. */
  totalWorkingDays: number;

  /** Rounds that finished — the issue came back. These are what "cost per return" is measured on. */
  settledRounds: number;
  /** The middle settled round trip, in working days. The number worth saying out loud. */
  medianSettledWorkingDays: number | null;
  /** Rounds whose clock is still running. */
  stillOutRounds: number;
  /** Working days those open rounds have run so far. */
  stillOutWorkingDays: number;

  /** Story points carried by the reworked issues that HAVE points. */
  reworkedPoints: number;
  /** Reworked issues with no points at all, so a zero total is never read as no cost. */
  unpointedCount: number;

  /** Round trips left out because the work was abandoned rather than redone. */
  excludedAbandonedRounds: number;
  /** Round trips left out as same-day corrections. */
  excludedShortRounds: number;

  /** Which status the counted returns fell into, and how many, worst first. */
  returnsByStatus: { statusName: string; count: number }[];
}

/** True when a status means the work stopped rather than went round again. */
export function isAbandonedStatusName(statusName: string): boolean {
  return ABANDONED_STATUS_NAMES.includes(statusName.trim().toLowerCase());
}

/** Sorts transitions oldest first, dropping any whose timestamp cannot be read. */
function readSortedTransitions(issue: ReworkIssue): { toStatusName: string; atMs: number }[] {
  return issue.statusTransitions
    .map((transition) => ({ toStatusName: transition.toStatusName, atMs: parseIsoOrNull(transition.atIso) }))
    .filter((transition): transition is { toStatusName: string; atMs: number } => transition.atMs !== null)
    .sort((first, second) => first.atMs - second.atMs);
}

/** Whole working days between two moments, to one decimal so short trips are not lost. */
function workingDaysBetween(startMs: number, endMs: number): number {
  return Math.round((businessMillisBetween(startMs, endMs) / MILLISECONDS_PER_DAY) * 10) / 10;
}

/** Every round trip an issue took, before the counting rules are applied. */
export function findReworkRounds(issue: ReworkIssue, todayMs: number): ReworkRound[] {
  const transitions = readSortedTransitions(issue);
  const rounds: ReworkRound[] = [];

  let isDelivered = issue.initialStatusName !== null
    && isDeliveredWorkflowStatusName(issue.initialStatusName);
  let openRound: { leftAtMs: number; fellBackToStatus: string } | null = null;

  transitions.forEach((transition) => {
    const isNowDelivered = isDeliveredWorkflowStatusName(transition.toStatusName);

    if (isDelivered && !isNowDelivered) {
      openRound = { leftAtMs: transition.atMs, fellBackToStatus: transition.toStatusName };
    } else if (!isDelivered && isNowDelivered && openRound !== null) {
      const round: { leftAtMs: number; fellBackToStatus: string } = openRound;
      rounds.push({
        leftAtIso: new Date(round.leftAtMs).toISOString(),
        fellBackToStatus: round.fellBackToStatus,
        returnedAtIso: new Date(transition.atMs).toISOString(),
        workingDays: workingDaysBetween(round.leftAtMs, transition.atMs),
        isStillOut: false,
      });
      openRound = null;
    }

    isDelivered = isNowDelivered;
  });

  if (openRound !== null) {
    const round: { leftAtMs: number; fellBackToStatus: string } = openRound;
    rounds.push({
      leftAtIso: new Date(round.leftAtMs).toISOString(),
      fellBackToStatus: round.fellBackToStatus,
      returnedAtIso: null,
      workingDays: workingDaysBetween(round.leftAtMs, todayMs),
      isStillOut: true,
    });
  }

  return rounds;
}

/** Why this round trip does not count, or null when it does. */
export function readExclusionReason(round: ReworkRound): ExcludedReworkReason | null {
  if (isAbandonedStatusName(round.fellBackToStatus)) {
    return 'abandoned';
  }
  // A still-open round is never too short: its clock has not stopped, and today's reading is a
  // snapshot rather than a duration.
  if (!round.isStillOut && round.workingDays < MINIMUM_REWORK_WORKING_DAYS) {
    return 'too-short';
  }
  return null;
}

/** True when the issue reached the delivery line at least once — the only ones that could rework. */
function hasEverBeenDelivered(issue: ReworkIssue): boolean {
  if (issue.initialStatusName !== null && isDeliveredWorkflowStatusName(issue.initialStatusName)) {
    return true;
  }
  return issue.statusTransitions.some((transition) => isDeliveredWorkflowStatusName(transition.toStatusName));
}

/** Counts the returns by the status they fell into, worst first. */
function countReturnsByStatus(issues: readonly ReworkIssueResult[]): { statusName: string; count: number }[] {
  const countByStatus = new Map<string, number>();
  issues.forEach((issue) => {
    issue.rounds.forEach((round) => {
      countByStatus.set(round.fellBackToStatus, (countByStatus.get(round.fellBackToStatus) ?? 0) + 1);
    });
  });

  return [...countByStatus.entries()]
    .map(([statusName, count]) => ({ statusName, count }))
    .sort((first, second) => second.count - first.count || first.statusName.localeCompare(second.statusName));
}

/** The middle value, or null for an empty set. Median, not mean: one 108-day outlier is not typical. */
function readMedian(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const middleIndex = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
    : sorted[middleIndex];
  return Math.round(median * 10) / 10;
}

/**
 * Scans a set of issues and reports what coming back costs.
 *
 * The denominator is the DELIVERED count, not the examined count. A rate of "21 of 208" is misleading
 * when most of those never reached delivery and so had no opportunity to come back.
 */
export function scanRework(issues: readonly ReworkIssue[], todayMs: number): ReworkScanResult {
  const deliveredIssues = issues.filter((issue) => hasEverBeenDelivered(issue));

  const results: ReworkIssueResult[] = [];
  let excludedAbandonedRounds = 0;
  let excludedShortRounds = 0;

  deliveredIssues.forEach((issue) => {
    const countedRounds: ReworkRound[] = [];
    findReworkRounds(issue, todayMs).forEach((round) => {
      const exclusionReason = readExclusionReason(round);
      if (exclusionReason === 'abandoned') {
        excludedAbandonedRounds += 1;
      } else if (exclusionReason === 'too-short') {
        excludedShortRounds += 1;
      } else {
        countedRounds.push(round);
      }
    });

    if (countedRounds.length === 0) {
      return;
    }
    results.push({
      key: issue.key,
      summary: issue.summary,
      storyPoints: issue.storyPoints,
      assigneeName: issue.assigneeName,
      rounds: countedRounds,
      totalWorkingDays: Math.round(countedRounds.reduce((total, round) => total + round.workingDays, 0) * 10) / 10,
    });
  });

  results.sort((first, second) => second.totalWorkingDays - first.totalWorkingDays
    || first.key.localeCompare(second.key));

  const allRounds = results.flatMap((issue) => issue.rounds);
  const settled = allRounds.filter((round) => !round.isStillOut);
  const stillOut = allRounds.filter((round) => round.isStillOut);

  return {
    issues: results,
    examinedCount: issues.length,
    deliveredCount: deliveredIssues.length,
    reworkedCount: results.length,
    totalRounds: allRounds.length,
    totalWorkingDays: Math.round(allRounds.reduce((total, round) => total + round.workingDays, 0) * 10) / 10,
    settledRounds: settled.length,
    medianSettledWorkingDays: readMedian(settled.map((round) => round.workingDays)),
    stillOutRounds: stillOut.length,
    stillOutWorkingDays: Math.round(stillOut.reduce((total, round) => total + round.workingDays, 0) * 10) / 10,
    reworkedPoints: results.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0),
    unpointedCount: results.filter((issue) => issue.storyPoints === null).length,
    excludedAbandonedRounds,
    excludedShortRounds,
    returnsByStatus: countReturnsByStatus(results),
  };
}

/**
 * States what the scan found, as the sentence somebody reads out.
 *
 * Leads with the FLOW figure — how long a return takes to recover — because that is the number the
 * report exists to produce. The first version led with a points total, which was zero, because the
 * issues that come back are defects and nobody points defects. A cost argument resting on a zero is
 * worse than no argument at all.
 */
export function describeReworkScan(result: ReworkScanResult): string {
  if (result.deliveredCount === 0) {
    return 'No issue in this window reached the delivery line, so none could have come back.';
  }
  if (result.reworkedCount === 0) {
    return `None of the ${result.deliveredCount} issues that reached delivery came back.`;
  }

  const percentage = Math.round((result.reworkedCount / result.deliveredCount) * 100);
  const sentences = [
    `${percentage}% of the work that reached delivery came back — ${result.reworkedCount} of `
      + `${result.deliveredCount} issues, across ${result.totalRounds} returns.`,
  ];

  if (result.medianSettledWorkingDays !== null) {
    sentences.push(`A return that has since been resolved took a median of ${result.medianSettledWorkingDays} `
      + `working days to recover, over ${result.settledRounds} of them.`);
  }
  if (result.stillOutRounds > 0) {
    sentences.push(`${result.stillOutRounds} more are still out, and have been for `
      + `${result.stillOutWorkingDays} working days so far.`);
  }

  // Said plainly, because a zero here is the whole point rather than an absence of one.
  sentences.push(result.unpointedCount === result.reworkedCount
    ? 'None of these carried story points, so the cost of coming back is recorded nowhere at all — '
      + 'which is why it has to be read out of history like this.'
    : `${result.unpointedCount} of them carried no story points, so the ${result.reworkedPoints} points `
      + 'shown are only the part of this that was ever sized.');

  return sentences.join(' ');
}

/** What the scan chose not to count, so an exclusion is stated rather than silently applied. */
export function describeReworkExclusions(result: ReworkScanResult): string {
  const parts: string[] = [];
  if (result.excludedAbandonedRounds > 0) {
    parts.push(`${result.excludedAbandonedRounds} moved into a cancelled or rejected status — abandoned, not redone`);
  }
  if (result.excludedShortRounds > 0) {
    parts.push(`${result.excludedShortRounds} came back within half a working day — a correction, not rework`);
  }
  return parts.length === 0 ? '' : `Not counted: ${parts.join('; ')}.`;
}
