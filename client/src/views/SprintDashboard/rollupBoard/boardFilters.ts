// boardFilters.ts — Decides which cards a viewer is currently looking at.
//
// Filters here only ever narrow what is DISPLAYED. They never reach a Feature's headline numbers,
// which are worked out before any of this runs — so "60% complete" always describes the whole
// Feature, whatever the viewer has filtered down to.

import type { QuickFilterState, RollupBoardItem } from './rollupBoardTypes.ts';

/** No filters at all — the state the board opens in. */
export const EMPTY_QUICK_FILTER_STATE: QuickFilterState = {
  typeBuckets: new Set(),
  assigneeAccountId: null,
  fixVersionName: null,
};

/** True when this item satisfies every active filter. Inactive filters exclude nothing. */
function doesItemMatchFilters(item: RollupBoardItem, filters: QuickFilterState): boolean {
  // An empty set means "no type filter chosen", not "match nothing" — the difference between a
  // viewer who has not filtered and a board that has hidden everything.
  if (filters.typeBuckets.size > 0 && !filters.typeBuckets.has(item.typeBucket)) {
    return false;
  }
  if (filters.assigneeAccountId !== null && item.assigneeAccountId !== filters.assigneeAccountId) {
    return false;
  }
  if (filters.fixVersionName !== null && !item.fixVersionNames.includes(filters.fixVersionName)) {
    return false;
  }
  return true;
}

/** Narrows a Feature's items to those the viewer is currently looking at. Filters combine with AND. */
export function selectMatchingItems(
  items: readonly RollupBoardItem[],
  filters: QuickFilterState,
): RollupBoardItem[] {
  return items.filter((item) => doesItemMatchFilters(item, filters));
}

/** True when any filter is active, so the board can say that its lane counts are narrowed. */
export function hasActiveFilters(filters: QuickFilterState): boolean {
  return filters.typeBuckets.size > 0
    || filters.assigneeAccountId !== null
    || filters.fixVersionName !== null;
}
