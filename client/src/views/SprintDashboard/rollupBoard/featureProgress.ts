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
 * Computes a Feature's completion from the items delivering it.
 *
 * Points weighting is used only when EVERY contributing item carries an estimate. One missing
 * estimate demotes the whole Feature to counting issues, because a points sum that quietly omits
 * unestimated work reports a Feature as further behind than it is — and does so invisibly.
 */
export function computeFeatureProgress(items: readonly RollupBoardItem[]): FeatureProgress {
  if (items.length === 0) {
    return { percentComplete: null, basis: 'none', completedUnits: 0, totalUnits: 0 };
  }

  const isEveryItemEstimated = items.every((item) => item.storyPoints !== null);
  const totalStoryPoints = items.reduce((runningTotal, item) => runningTotal + (item.storyPoints ?? 0), 0);

  if (isEveryItemEstimated && totalStoryPoints > 0) {
    const completedStoryPoints = items
      .filter(isItemComplete)
      .reduce((runningTotal, item) => runningTotal + (item.storyPoints ?? 0), 0);
    return {
      percentComplete: calculatePercent(completedStoryPoints, totalStoryPoints),
      basis: 'story-points',
      completedUnits: completedStoryPoints,
      totalUnits: totalStoryPoints,
    };
  }

  const completedItemCount = items.filter(isItemComplete).length;
  return {
    percentComplete: calculatePercent(completedItemCount, items.length),
    basis: 'issue-count',
    completedUnits: completedItemCount,
    totalUnits: items.length,
  };
}
