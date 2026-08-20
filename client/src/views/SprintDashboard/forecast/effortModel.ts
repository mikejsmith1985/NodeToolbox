// effortModel.ts — How much work is LEFT in one issue, in working days.
//
// The size somebody put on a story answers "how big was this". A forecast needs "how much is still
// to do", and the two stop being the same number the moment work starts. Charging an almost-finished
// story its full size makes every board look permanently over capacity — and the remedy that
// suggests, removing scope, would be aimed at the work closest to done.
//
// The credit comes from the Roll-Up Board's OWN column rule, imported rather than reimplemented.
// That is what makes the lane's progress bar and the capacity figure printed beside it agree: they
// are the same arithmetic, not two arithmetics that currently match.

import { readColumnCredit } from '../rollupBoard/featureProgress.ts';
import type { RemainingEffort } from './forecastTypes.ts';

/** Used when a caller supplies a rate that cannot divide, so this module never produces Infinity. */
const FALLBACK_POINTS_PER_WORKING_DAY = 1;

/** The least a caller may be told an unfinished, estimated issue will take. */
const MINIMUM_UNFINISHED_WORKING_DAYS = 1;

const PERCENT_MULTIPLIER = 100;

/** Describes what an unestimated issue is, without implying a size it does not have. */
function describeUnestimated(): string {
  return 'no estimate — excluded from every total and counted as unsized';
}

/** Spells out the arithmetic, so a figure somebody disputes can be checked rather than argued about. */
function describeWorkings(
  storyPoints: number,
  columnCredit: number,
  remainingPoints: number,
  remainingWorkingDays: number,
): string {
  const creditPercent = Math.round(columnCredit * PERCENT_MULTIPLIER);
  const roundedRemaining = Math.round(remainingPoints * 10) / 10;
  return `${storyPoints} pts, ${creditPercent}% column credit, ${roundedRemaining} pts left`
    + ` → ${remainingWorkingDays} working day${remainingWorkingDays === 1 ? '' : 's'}`;
}

/**
 * Works out how much of one issue is still to do, and how many working days that is.
 *
 * `storyPoints` of null means nobody has sized it: the result says so and carries no day count,
 * because inventing one would let unmeasured work be reported as on track. An estimate of zero is a
 * different fact — somebody measured it and it is nothing — and is kept as such.
 */
export function computeRemainingEffort(
  storyPoints: number | null,
  columnId: string,
  orderedColumnIds: readonly string[],
  isComplete: boolean,
  pointsPerWorkingDay: number,
): RemainingEffort {
  // Finished is finished, whatever column it happens to be sitting in.
  const columnCredit = isComplete ? 1 : readColumnCredit(columnId, orderedColumnIds);

  if (storyPoints === null) {
    return {
      storyPoints: null,
      columnCredit,
      remainingPoints: null,
      remainingWorkingDays: null,
      isEstimated: false,
      basis: describeUnestimated(),
    };
  }

  const remainingPoints = Math.max(0, storyPoints * (1 - columnCredit));
  const rate = pointsPerWorkingDay > 0 ? pointsPerWorkingDay : FALLBACK_POINTS_PER_WORKING_DAY;
  const rawWorkingDays = Math.ceil(remainingPoints / rate);
  // A story 96% of the way through its columns still has somebody's day left in it. Rounding that
  // remainder to zero is how a forecast comes to promise free work, and a release then "fits".
  const remainingWorkingDays = remainingPoints > 0
    ? Math.max(MINIMUM_UNFINISHED_WORKING_DAYS, rawWorkingDays)
    : 0;

  return {
    storyPoints,
    columnCredit,
    remainingPoints,
    remainingWorkingDays,
    isEstimated: true,
    basis: describeWorkings(storyPoints, columnCredit, remainingPoints, remainingWorkingDays),
  };
}
