// reworkScan.ts — Finding the work that was done twice and charged once.
//
// A story that stays open until the whole downstream chain finishes absorbs its own rework for free.
// A defect comes back from shift-left testing, or from QE, or from business testing; the developer
// fixes it inside the open ticket; no points are added, no new item is created, and the cost of that
// round trip is recorded precisely nowhere. Nobody hid it — the process never asked for it.
//
// The effect is that a team cannot say what late defect discovery costs them, because on paper it
// costs nothing. That makes the case for testing capacity impossible to argue and the case for
// closing stories early impossible to win.
//
// The evidence, though, is already sitting in the changelog. An issue that reached delivery — the
// team's own line, "Ready for QA" or beyond — and then moved BACKWARDS out of it went round again.
// Each of those returns is a piece of rework, and the changelog says when it happened, how long the
// issue then spent before getting back, and which status sent it back.
//
// Two rules keep the count honest:
//
//   - ONLY A RETURN FROM DELIVERY COUNTS. Moving between two in-progress statuses is ordinary work,
//     not rework, and counting it would inflate the number until nobody believed any of it.
//   - AN ISSUE STILL IN REWORK IS COUNTED, AND SAID TO BE OPEN. Waiting for it to come back before
//     admitting it went away would under-report exactly the worst cases.
//
// Pure: no fetch, no storage, and the clock is passed in.

import { businessMillisBetween, MILLISECONDS_PER_DAY, parseIsoOrNull } from './issueTimeline.ts';
import { isDeliveredWorkflowStatusName } from '../../utils/workflowDelivery.ts';

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
  /** Every round across every issue. */
  totalRounds: number;
  /** Working days of rework across every round. */
  totalWorkingDays: number;
  /** Story points carried by the reworked issues — the effort that was done at least twice. */
  reworkedPoints: number;
  /** Which status the returns fell into, and how many, worst first. */
  returnsByStatus: { statusName: string; count: number }[];
}

/** Sorts transitions oldest first, dropping any whose timestamp cannot be read. */
function readSortedTransitions(issue: ReworkIssue): { toStatusName: string; atMs: number }[] {
  return issue.statusTransitions
    .map((transition) => ({ toStatusName: transition.toStatusName, atMs: parseIsoOrNull(transition.atIso) }))
    .filter((transition): transition is { toStatusName: string; atMs: number } => transition.atMs !== null)
    .sort((first, second) => first.atMs - second.atMs);
}

/** Whole working days between two moments, rounded to one decimal so short trips are not lost. */
function workingDaysBetween(startMs: number, endMs: number): number {
  return Math.round((businessMillisBetween(startMs, endMs) / MILLISECONDS_PER_DAY) * 10) / 10;
}

/**
 * Walks one issue's history and reports every time it fell out of delivery.
 *
 * Delivery is the team's own line, not Jira's: "Ready for QA" or beyond. That matters because a story
 * that reaches Ready for QA and is pushed back to In Progress has unmistakably been done twice, while
 * one that never got there is simply still being done the first time.
 */
export function findReworkRounds(issue: ReworkIssue, todayMs: number): ReworkRound[] {
  const transitions = readSortedTransitions(issue);
  const rounds: ReworkRound[] = [];

  let isDelivered = issue.initialStatusName !== null
    && isDeliveredWorkflowStatusName(issue.initialStatusName);
  let openRound: { leftAtMs: number; fellBackToStatus: string } | null = null;

  transitions.forEach((transition) => {
    const isNowDelivered = isDeliveredWorkflowStatusName(transition.toStatusName);

    if (isDelivered && !isNowDelivered) {
      // Fell out of delivery: the round trip starts here, named by where it landed.
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

  // Still out. Counted, and said to be open: waiting for it to come back before admitting it went
  // away would under-report exactly the worst cases.
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

/**
 * Scans a set of issues and reports what rework cost.
 *
 * The denominator reported is the DELIVERED count, not the examined count. A rate of "12 of 145" is
 * misleading when a hundred of those never reached delivery and so had no opportunity to come back;
 * "12 of 45 that got there" is the number somebody can act on.
 */
export function scanRework(issues: readonly ReworkIssue[], todayMs: number): ReworkScanResult {
  const deliveredIssues = issues.filter((issue) => hasEverBeenDelivered(issue));

  const results: ReworkIssueResult[] = [];
  deliveredIssues.forEach((issue) => {
    const rounds = findReworkRounds(issue, todayMs);
    if (rounds.length === 0) {
      return;
    }
    results.push({
      key: issue.key,
      summary: issue.summary,
      storyPoints: issue.storyPoints,
      assigneeName: issue.assigneeName,
      rounds,
      totalWorkingDays: Math.round(rounds.reduce((total, round) => total + round.workingDays, 0) * 10) / 10,
    });
  });

  // Worst first: the longest round trips are the ones worth reading out.
  results.sort((first, second) => second.totalWorkingDays - first.totalWorkingDays
    || first.key.localeCompare(second.key));

  return {
    issues: results,
    examinedCount: issues.length,
    deliveredCount: deliveredIssues.length,
    reworkedCount: results.length,
    totalRounds: results.reduce((total, issue) => total + issue.rounds.length, 0),
    totalWorkingDays: Math.round(results.reduce((total, issue) => total + issue.totalWorkingDays, 0) * 10) / 10,
    reworkedPoints: results.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0),
    returnsByStatus: countReturnsByStatus(results),
  };
}

/**
 * States what the scan found in one sentence, for the top of a report or a slide.
 *
 * Deliberately says what it does NOT know: the points figure is the size of the issues that came back,
 * which is an upper bound on the rework effort rather than a measurement of it. Nobody re-estimated
 * the second pass — that is the whole problem — and a number presented as exact would be the first
 * thing challenged in the room.
 */
export function describeReworkScan(result: ReworkScanResult): string {
  if (result.deliveredCount === 0) {
    return 'No issue in this window reached the delivery line, so none could have come back.';
  }
  if (result.reworkedCount === 0) {
    return `None of the ${result.deliveredCount} issues that reached delivery came back.`;
  }

  const percentage = Math.round((result.reworkedCount / result.deliveredCount) * 100);
  return `${result.reworkedCount} of ${result.deliveredCount} issues that reached delivery came back — `
    + `${percentage}%, across ${result.totalRounds} return(s) and ${result.totalWorkingDays} working days. `
    + `Those issues carry ${result.reworkedPoints} points, which were estimated once and delivered at `
    + 'least twice; the second pass was never sized, so this is the scale of the cost rather than a '
    + 'measurement of it.';
}
