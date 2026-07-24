// piReviewLoad.ts — Totals the points planned on a PI Review board and compares them to capacity.
//
// A Product Owner plans a PI by sizing Features, then commits a subset. Two questions decide whether
// the plan is realistic: does the COMMITTED work fit the team's recommended (80%) capacity, and how
// much TOTAL work (committed plus stretch) is on the board. These are pure sums with no React and no
// I/O, so the arithmetic can be verified in milliseconds and the panel just renders the result.

import type { PiReviewRow } from './piReviewTable.ts';

/** Whether a row is committed work (its Committed cell reads "Yes"), as opposed to a stretch goal. */
export function isPiReviewRowCommitted(row: PiReviewRow): boolean {
  return row.committed.trim().toLowerCase() === 'yes';
}

/** Reads a row's point estimate as a number; a blank or non-numeric estimate counts as zero. */
export function parsePiReviewPointEstimate(pointEstimate: string): number {
  const parsedPointEstimate = Number(pointEstimate);
  return Number.isFinite(parsedPointEstimate) ? parsedPointEstimate : 0;
}

/** How the board's planned points compare to the team's recommended (80%) capacity. */
export interface PiReviewLoadComparison {
  /** Points across EVERY Feature on the board — committed and stretch alike. */
  totalFeaturePoints: number;
  /** Points across only the committed Features. */
  committedPoints: number;
  /**
   * The team's recommended capacity in points — the 80% planning target. Null when no capacity plan
   * has been saved, in which case there is nothing to compare against.
   */
  capacityTargetPoints: number | null;
  /**
   * Committed points minus the 80% target. Positive means the commitment is OVER the recommended
   * capacity (a warning); negative means it is under. Null when there is no target to compare to.
   */
  committedVsTarget: number | null;
  /** Total points minus the 80% target. Positive means even the full board exceeds recommended capacity. */
  totalVsTarget: number | null;
  /** Committed points as a percentage of the 80% target (100 = exactly at target). Null without a target. */
  committedPercentOfTarget: number | null;
}

/**
 * Sums the board's points and compares committed and total load to the recommended (80%) capacity.
 *
 * @param rows - Every PI Review row on the board.
 * @param capacityTargetPoints - The recommended (80%) capacity in points, or null when unsaved.
 */
export function computePiReviewLoadComparison(
  rows: readonly PiReviewRow[],
  capacityTargetPoints: number | null,
): PiReviewLoadComparison {
  let totalFeaturePoints = 0;
  let committedPoints = 0;
  for (const row of rows) {
    const rowPoints = parsePiReviewPointEstimate(row.pointEstimate);
    totalFeaturePoints += rowPoints;
    if (isPiReviewRowCommitted(row)) {
      committedPoints += rowPoints;
    }
  }

  // Guard clause: without a saved capacity plan there is no target, so every comparison is null.
  const hasTarget = capacityTargetPoints !== null && Number.isFinite(capacityTargetPoints);
  if (!hasTarget) {
    return {
      totalFeaturePoints,
      committedPoints,
      capacityTargetPoints: null,
      committedVsTarget: null,
      totalVsTarget: null,
      committedPercentOfTarget: null,
    };
  }

  const target = capacityTargetPoints as number;
  return {
    totalFeaturePoints,
    committedPoints,
    capacityTargetPoints: target,
    committedVsTarget: committedPoints - target,
    totalVsTarget: totalFeaturePoints - target,
    // A zero target cannot yield a meaningful percentage, so report null rather than dividing by zero.
    committedPercentOfTarget: target === 0 ? null : (committedPoints / target) * 100,
  };
}
