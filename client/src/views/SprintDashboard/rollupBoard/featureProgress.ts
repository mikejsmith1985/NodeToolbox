// featureProgress.ts — Works out how far a Feature has got, and on what basis.
//
// The basis is returned WITH the number rather than alongside it, because "60% complete" is a
// different claim weighted by points than counted by issues, and a reader who cannot tell which was
// used cannot check the figure. Returning them together means a caller cannot show one without the
// other even by accident.

import type { FeatureProgress, RollupBoardItem } from './rollupBoardTypes.ts';

/** Jira status-category names that mean the work is finished. */
const DONE_STATUS_CATEGORY_NAMES = new Set(['done', 'complete', 'completed']);

const PERCENT_MULTIPLIER = 100;

/** True when this item's Jira status category says the work is finished. */
function isItemComplete(item: RollupBoardItem): boolean {
  const statusField = (item.issue.fields as { status?: { statusCategory?: { name?: string }; name?: string } }).status;
  const statusCategoryName = (statusField?.statusCategory?.name ?? statusField?.name ?? '').trim().toLowerCase();
  return DONE_STATUS_CATEGORY_NAMES.has(statusCategoryName);
}

/** Rounds to a whole percent — sub-percent precision implies an accuracy this data does not have. */
function calculatePercent(completedUnits: number, totalUnits: number): number {
  return Math.round((completedUnits / totalUnits) * PERCENT_MULTIPLIER);
}

/**
 * How much credit an item earns for the column it is sitting in.
 *
 * Every unfinished item counted zero before this, so a Feature whose work was all in Code Review read
 * the same as one that had not been started — and moving a card across the board changed nothing until
 * it reached the end. A large story nearly finished was worth exactly as much as a small one nobody
 * had picked up.
 *
 * The credit comes from the team's OWN column order rather than from weights invented here. That order
 * is already a statement about their workflow: column 5 of 10 is halfway through it by their own
 * definition, and nothing has to be configured twice for the number to mean something.
 */
export function readColumnCredit(
  columnId: string,
  orderedColumnIds: readonly string[],
): number {
  const lastIndex = orderedColumnIds.length - 1;
  if (lastIndex <= 0) return 0;

  const columnIndex = orderedColumnIds.indexOf(columnId);
  // A column outside the team's vocabulary — Unmapped, or one just deleted. Unplaced work has not
  // demonstrably moved anywhere, so it earns nothing rather than a guess.
  if (columnIndex < 0) return 0;
  return columnIndex / lastIndex;
}

/**
 * Computes a Feature's completion from the items delivering it.
 *
 * Points weighting is used only when EVERY contributing item carries an estimate. One missing
 * estimate demotes the whole Feature to counting issues, because a points sum that quietly omits
 * unestimated work reports a Feature as further behind than it is — and does so invisibly.
 */
export function computeFeatureProgress(
  items: readonly RollupBoardItem[],
  orderedColumnIds: readonly string[] = [],
): FeatureProgress {
  if (items.length === 0) {
    return { percentComplete: null, basis: 'none', completedUnits: 0, totalUnits: 0 };
  }

  // Absent columns means the caller has none to give, and the figure stays exactly what it was before
  // part credit existed. Nothing regresses by adopting this late.
  const isPartCredited = orderedColumnIds.length > 1;
  /** What one item has earned: finished is finished, otherwise how far its column says it has got. */
  const readItemCredit = (item: RollupBoardItem): number => {
    if (isItemComplete(item)) return 1;
    return isPartCredited ? readColumnCredit(item.columnId, orderedColumnIds) : 0;
  };

  const isEveryItemEstimated = items.every((item) => item.storyPoints !== null);
  const totalStoryPoints = items.reduce((runningTotal, item) => runningTotal + (item.storyPoints ?? 0), 0);

  if (isEveryItemEstimated && totalStoryPoints > 0) {
    const earnedStoryPoints = items
      .reduce((runningTotal, item) => runningTotal + (item.storyPoints ?? 0) * readItemCredit(item), 0);
    return {
      percentComplete: calculatePercent(earnedStoryPoints, totalStoryPoints),
      basis: isPartCredited ? 'story-points-part-credit' : 'story-points',
      // Rounded for display: a Feature reading "12.7 of 34 points" implies a precision that partial
      // credit does not have, and the percentage is the figure anybody acts on.
      completedUnits: Math.round(earnedStoryPoints),
      totalUnits: totalStoryPoints,
    };
  }

  const earnedItemCount = items.reduce((runningTotal, item) => runningTotal + readItemCredit(item), 0);
  return {
    percentComplete: calculatePercent(earnedItemCount, items.length),
    basis: isPartCredited ? 'issue-count-part-credit' : 'issue-count',
    completedUnits: Math.round(earnedItemCount),
    totalUnits: items.length,
  };
}
