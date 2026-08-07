// boardLayout.ts — Arranges resolved work into swimlanes, columns and parent containers.
//
// The order of operations below is load-bearing rather than stylistic. A Feature's headline numbers
// are computed from its COMPLETE item set before filtering happens at all, which is the only reason
// a filter can never quietly change what a Feature appears to be worth.
//
// The other rule worth stating out loud: a parent issue may head a grouping container in several
// columns at once (its children are wherever they actually are), but it is drawn as a CARD exactly
// once — in the column of its own status. Drawing it per column would inflate every count on the
// board while looking entirely plausible on screen.

import { buildCardCellKey } from './boardPreferencesStore.ts';
import { selectMatchingItems } from './boardFilters.ts';
import {
  type BoardLayout,
  type BoardPreferences,
  type LaneCell,
  type MasterCard,
  type MasterCardVitals,
  type ParentContainer,
  type QuickFilterState,
  type RenderedColumn,
  type RenderedLane,
  type RollupBoardItem,
} from './rollupBoardTypes.ts';

export interface BuildBoardLayoutInput {
  masterCards: readonly MasterCard[];
  columns: readonly RenderedColumn[];
  filters: QuickFilterState;
  preferences: BoardPreferences;
}

/**
 * Step 1 — a Feature's vital signs, taken from its UNFILTERED items.
 *
 * Deliberately a separate function called before filtering, so no later edit can accidentally feed
 * it a narrowed set.
 */
function computeLaneVitals(masterCard: MasterCard): MasterCardVitals {
  return masterCard.vitals;
}

/** Step 3 — puts each item in the column its own status resolved to. */
function distributeItemsIntoColumns(
  items: readonly RollupBoardItem[],
  columns: readonly RenderedColumn[],
): Map<string, RollupBoardItem[]> {
  const itemsByColumnId = new Map<string, RollupBoardItem[]>(
    columns.map((column) => [column.id, [] as RollupBoardItem[]]),
  );

  for (const item of items) {
    // A column the vocabulary no longer defines would otherwise drop the item silently; falling back
    // to the last column (always Unmapped) keeps the board's "nothing is hidden" promise intact.
    const targetColumnId = itemsByColumnId.has(item.columnId)
      ? item.columnId
      : columns[columns.length - 1]?.id ?? item.columnId;
    itemsByColumnId.set(targetColumnId, [...(itemsByColumnId.get(targetColumnId) ?? []), item]);
  }

  return itemsByColumnId;
}

/**
 * Puts a column's cards in the sequence the viewer arranged them in.
 *
 * A board that shows work in the order it has to happen is worth far more than one sorted by
 * whatever Jira returned, so a hand-placed order wins and anything new sorts to the end.
 */
function orderCardsWithinCell(
  items: readonly RollupBoardItem[],
  orderedIssueKeys: readonly string[],
): RollupBoardItem[] {
  if (orderedIssueKeys.length === 0) return [...items];

  const positionByIssueKey = new Map(orderedIssueKeys.map((issueKey, position) => [issueKey, position]));
  return [...items].sort((leftItem, rightItem) => {
    const leftPosition = positionByIssueKey.get(leftItem.key) ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = positionByIssueKey.get(rightItem.key) ?? Number.MAX_SAFE_INTEGER;
    return leftPosition - rightPosition;
  });
}

/**
 * Step 4 — groups one column's items under their parents, and step 5 drops any container left empty.
 *
 * An item whose parent is not in the lane at all becomes a loose card rather than being hidden.
 */
function groupItemsIntoParentContainers(
  columnItems: readonly RollupBoardItem[],
  itemsByKeyInLane: ReadonlyMap<string, RollupBoardItem>,
  orderedIssueKeys: readonly string[],
): LaneCell {
  const containersByParentKey = new Map<string, ParentContainer>();
  const looseItems: RollupBoardItem[] = [];

  for (const item of orderCardsWithinCell(columnItems, orderedIssueKeys)) {
    if (item.parentKey === null) {
      looseItems.push(item);
      continue;
    }

    const existingContainer = containersByParentKey.get(item.parentKey);
    if (existingContainer) {
      existingContainer.items.push(item);
      continue;
    }

    const parentItem = itemsByKeyInLane.get(item.parentKey);
    containersByParentKey.set(item.parentKey, {
      parentKey: item.parentKey,
      parentSummary: parentItem?.summary ?? '',
      // The parent may be real but outside this board's scope. The header still names it, so the
      // structure is intact and the reader can see why no parent card appears.
      isParentInScope: parentItem !== undefined,
      items: [item],
    });
  }

  return {
    // Step 5: a container with no items would imply work that is not there.
    containers: [...containersByParentKey.values()].filter((container) => container.items.length > 0),
    looseItems,
  };
}

/** Step 6 — the viewer's chosen lane order, with anything new appended rather than inserted at random. */
function orderLanes(lanes: readonly RenderedLane[], laneOrder: readonly string[]): RenderedLane[] {
  const orderIndexByFeatureKey = new Map(laneOrder.map((featureKey, orderIndex) => [featureKey, orderIndex]));

  return [...lanes].sort((leftLane, rightLane) => {
    const leftIndex = orderIndexByFeatureKey.get(leftLane.masterCard.featureKey) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndexByFeatureKey.get(rightLane.masterCard.featureKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    // Unordered lanes keep their incoming order, which masterCards already made deterministic.
    return 0;
  });
}

/** Builds one swimlane: vitals from everything, cells from what the filters left. */
function buildLane(
  masterCard: MasterCard,
  columns: readonly RenderedColumn[],
  filters: QuickFilterState,
  preferences: BoardPreferences,
): RenderedLane {
  const vitals = computeLaneVitals(masterCard);
  const matchedItems = selectMatchingItems(masterCard.items, filters);
  const itemsByKeyInLane = new Map(masterCard.items.map((item) => [item.key, item]));
  const itemsByColumnId = distributeItemsIntoColumns(matchedItems, columns);

  const cellsByColumnId: Record<string, LaneCell> = {};
  for (const column of columns) {
    cellsByColumnId[column.id] = groupItemsIntoParentContainers(
      itemsByColumnId.get(column.id) ?? [],
      itemsByKeyInLane,
      preferences.cardOrderByCell?.[buildCardCellKey(masterCard.featureKey, column.id)] ?? [],
    );
  }

  return {
    masterCard: { ...masterCard, vitals },
    // A lane the viewer has never touched starts collapsed, so the board opens as an overview.
    isCollapsed: preferences.collapsedByFeatureKey[masterCard.featureKey] ?? true,
    matchedItemCount: matchedItems.length,
    totalItemCount: masterCard.items.length,
    cellsByColumnId,
  };
}

/**
 * Arranges the whole board.
 *
 * Pure by design — same inputs, same output, no clock and no randomness — so its guarantees can be
 * asserted arithmetically instead of inspected on screen.
 */
export function buildBoardLayout(input: BuildBoardLayoutInput): BoardLayout {
  const lanes = input.masterCards.map((masterCard) =>
    buildLane(masterCard, input.columns, input.filters, input.preferences),
  );

  return {
    columns: [...input.columns],
    lanes: orderLanes(lanes, input.preferences.laneOrder),
  };
}
