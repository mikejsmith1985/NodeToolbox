// boardFilters.ts — Decides which cards a viewer is currently looking at.
//
// Filters here only ever narrow what is DISPLAYED. They never reach a Feature's headline numbers,
// which are worked out before any of this runs — so "60% complete" always describes the whole
// Feature, whatever the viewer has filtered down to.

import type { ChecklistCard } from './checklistCards.ts';
import { isChecklistItemOwnedBy } from './checklistOwners.ts';
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
  // A checklist item is work somebody was given, and the person given it is often not the person the
  // card is assigned to — a Story assigned to its developer routinely carries a checklist line owned
  // by a tester. Filtering to that tester used to hide the card, and with it the only place their
  // work appears at all, so a board filtered to one person could show them nothing while they had a
  // day's work on it.
  if (filters.assigneeAccountId !== null
    && item.assigneeAccountId !== filters.assigneeAccountId
    && !item.checklistItems.some((checklistItem) =>
      isChecklistItemOwnedBy(checklistItem, filters.assigneeAccountId ?? ''))) {
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

/**
 * Narrows the checklist cards the same way, so one filter means one thing everywhere.
 *
 * A checklist card carries an owner and nothing else a filter asks about, so a fix-version filter
 * excludes them all — which is right: a checklist item genuinely has no fix version, and pretending
 * it inherits its parent's would put work in a release nobody put it in.
 */
export function selectMatchingChecklistCards(
  checklistCards: readonly ChecklistCard[],
  filters: QuickFilterState,
): ChecklistCard[] {
  if (filters.fixVersionName !== null) return [];

  return checklistCards.filter((checklistCard) => {
    if (filters.typeBuckets.size > 0 && !filters.typeBuckets.has('checklist')) return false;
    if (filters.assigneeAccountId !== null) {
      const ownerId = checklistCard.ownerFilterId;
      if (ownerId === null) return false;
      if (ownerId.trim().toLowerCase() !== filters.assigneeAccountId.trim().toLowerCase()) return false;
    }
    return true;
  });
}

/** True when any filter is active, so the board can say that its lane counts are narrowed. */
export function hasActiveFilters(filters: QuickFilterState): boolean {
  return filters.typeBuckets.size > 0
    || filters.assigneeAccountId !== null
    || filters.fixVersionName !== null;
}
