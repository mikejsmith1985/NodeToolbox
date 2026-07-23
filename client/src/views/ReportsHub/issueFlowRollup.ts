// issueFlowRollup.ts — Aggregates many issues' stages into "where is the flow lost", and the honest team totals.
//
// Two separate jobs live here, both pure.
//
// The ROLL-UPS answer where time accumulates. They report a median and a p85 rather than a mean,
// because one issue stuck in review for three months would drag a mean far enough to describe a
// healthy stage as broken. The typical case and the tail are different findings and are reported as
// two figures.
//
// The DELIVERY TOTALS are the fix for the defect that prompted this feature. The existing per-person
// columns credit one whole issue — and its full story points — to EVERY person who advanced it. That
// is correct for measuring a person and wrong for measuring a team: summing the column counts
// hand-offs, not issues. These totals are computed over the distinct issue set instead, from a
// different direction entirely, so they cannot inherit the same error.

import type { IssueFlow } from './issueFlow.ts';
import type { StatusFlowClass } from './issueFlowStatusClass.ts';

/** The percentile used as the "spread" figure beside the median. */
const TAIL_PERCENTILE = 0.85;

/** How much time all issues spent in one status, and how that time was distributed. */
export interface StageRollup {
  statusId: string | null;
  statusName: string;
  flowClass: StatusFlowClass;
  /** Total working days across every issue that passed through this status. */
  totalWorkingDays: number;
  /** The typical per-issue duration — resistant to a single extreme issue. */
  medianWorkingDays: number;
  /** The tail: 85% of issues cleared the status in this many working days or fewer. */
  p85WorkingDays: number;
  issueCount: number;
  /** The issues behind the figure, so it can be opened and checked. */
  issueKeys: string[];
}

/** Team delivery counted over distinct issues, never by summing per-person figures. */
export interface DeliveryTotals {
  deliveredIssueCount: number;
  deliveredStoryPoints: number;
}

/**
 * Groups every stage by status and summarises each group.
 *
 * Rows come back largest-first, so the biggest single drain on flow is the first thing read — and
 * each row carries its class, so "our issues wait four days in QA" is never presented as though it
 * were four days of somebody working.
 */
export function summariseStageRollups(issueFlows: readonly IssueFlow[]): StageRollup[] {
  const groupsByStatus = new Map<string, {
    statusId: string | null;
    statusName: string;
    flowClass: StatusFlowClass;
    perIssueDays: Map<string, number>;
  }>();

  for (const issueFlow of issueFlows) {
    for (const stage of issueFlow.stages) {
      const groupKey = stage.statusId ?? stage.statusName;
      const group = groupsByStatus.get(groupKey) ?? {
        statusId: stage.statusId,
        statusName: stage.statusName,
        flowClass: stage.flowClass,
        perIssueDays: new Map<string, number>(),
      };
      // An issue that held one status across several hand-offs contributes ONE duration to the
      // spread; otherwise a much-passed-around issue would look like several quick ones.
      group.perIssueDays.set(
        issueFlow.issueKey,
        (group.perIssueDays.get(issueFlow.issueKey) ?? 0) + stage.workingDays,
      );
      groupsByStatus.set(groupKey, group);
    }
  }

  return [...groupsByStatus.values()]
    .map((group) => toRollup(group))
    .sort((first, second) => second.totalWorkingDays - first.totalWorkingDays);
}

/** Converts one status group into its reportable row. */
function toRollup(group: {
  statusId: string | null;
  statusName: string;
  flowClass: StatusFlowClass;
  perIssueDays: Map<string, number>;
}): StageRollup {
  const durations = [...group.perIssueDays.values()];
  return {
    statusId: group.statusId,
    statusName: group.statusName,
    flowClass: group.flowClass,
    totalWorkingDays: durations.reduce((total, days) => total + days, 0),
    medianWorkingDays: readPercentile(durations, 0.5),
    p85WorkingDays: readPercentile(durations, TAIL_PERCENTILE),
    issueCount: group.perIssueDays.size,
    issueKeys: [...group.perIssueDays.keys()],
  };
}

/**
 * Reads a percentile from a set of durations using nearest-rank.
 *
 * Nearest-rank returns a value that a real issue actually took, rather than an interpolated figure
 * no issue ever exhibited — which matters when a reader opens the issues to check the number.
 */
function readPercentile(durations: readonly number[], percentile: number): number {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((first, second) => first - second);
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)];
}

/**
 * Counts what the team actually delivered: distinct issues, and each issue's points once.
 *
 * Deliberately computed from the issue set rather than by adding up per-person columns. Those
 * columns each credit the whole issue to a different person, so adding them would report an 8-point
 * story touched by four people as 32 points of team output.
 *
 * It takes the minimum shape both callers can supply — the flow analysis' issues and the Personal
 * Workflow report's credited rows — so the two screens cannot report different team totals.
 */
export function computeDeliveryTotals(
  deliveredIssues: ReadonlyArray<{ issueKey: string; storyPoints: number | null }>,
): DeliveryTotals {
  const pointsByIssueKey = new Map<string, number>();
  for (const deliveredIssue of deliveredIssues) {
    pointsByIssueKey.set(deliveredIssue.issueKey, deliveredIssue.storyPoints ?? 0);
  }

  return {
    deliveredIssueCount: pointsByIssueKey.size,
    deliveredStoryPoints: [...pointsByIssueKey.values()].reduce((total, points) => total + points, 0),
  };
}
