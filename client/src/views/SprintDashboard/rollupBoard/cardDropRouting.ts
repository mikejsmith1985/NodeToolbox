// cardDropRouting.ts — Works out what a card drop actually means, before anything is written.
//
// Drag-and-drop libraries hand back opaque ids, so the interpretation lives here as plain functions
// that a test can exercise without a browser.
//
// A drop can mean four different things, and the difference is worth being precise about because
// three of them write to Jira:
//   • onto a column cell in the SAME lane      → change the issue's status
//   • onto a column cell in ANOTHER lane       → change which Feature the issue rolls up to
//   • onto the middle of another card          → make it contained in that card
//   • onto the top or bottom edge of a card    → sequence it, which touches nothing in Jira
//
// Nesting is restricted to cards in the same column on purpose. Dropping onto a card elsewhere still
// means "move to that column", because one gesture producing two different writes at once is the kind
// of surprise that stops people trusting drag-and-drop at all.

import type { BoardColumn, RenderedColumn, RollupBoardItem } from './rollupBoardTypes.ts';

/** Separator between the lane and column parts of a drop-target id. Not valid in a Jira key. */
const DROP_TARGET_SEPARATOR = '::';

/** Builds the id for one lane's column cell. */
export function buildDropTargetId(featureKey: string, columnId: string): string {
  return `${featureKey}${DROP_TARGET_SEPARATOR}${columnId}`;
}

/** Prefix marking a drop target that is another CARD rather than a column cell. */
const CARD_TARGET_PREFIX = 'card::';

/** Builds the id for a card used as a drop target, so cards can be dropped onto one another. */
export function buildCardTargetId(issueKey: string): string {
  return `${CARD_TARGET_PREFIX}${issueKey}`;
}

/** The issue key a card drop target names, or null when the target is not a card. */
export function parseCardTargetId(dropTargetId: string): string | null {
  return dropTargetId.startsWith(CARD_TARGET_PREFIX)
    ? dropTargetId.slice(CARD_TARGET_PREFIX.length)
    : null;
}

/** Reads a drop-target id back into the lane and column it names. */
export function parseDropTargetId(dropTargetId: string): { featureKey: string; columnId: string } | null {
  const separatorIndex = dropTargetId.indexOf(DROP_TARGET_SEPARATOR);
  if (separatorIndex < 0) return null;
  return {
    featureKey: dropTargetId.slice(0, separatorIndex),
    columnId: dropTargetId.slice(separatorIndex + DROP_TARGET_SEPARATOR.length),
  };
}

/** What the board should do with a drop. */
export type CardDropDecision =
  | { kind: 'ignore' }
  | { kind: 'refused'; reason: string }
  | { kind: 'move'; item: RollupBoardItem; targetColumn: BoardColumn | RenderedColumn }
  /** Same lane, same column: the viewer is sequencing the work, not changing its state. */
  | { kind: 'reorder'; item: RollupBoardItem; targetIssueKey: string }
  /** Dropped in another Feature's lane: re-point the issue's Feature Link at that Feature. */
  | { kind: 'relink'; item: RollupBoardItem; targetFeatureKey: string }
  /** Dropped onto the body of another card: record that this issue is contained in that one. */
  | { kind: 'nest'; item: RollupBoardItem; containerIssueKey: string }
  /**
   * Dropped on the COLUMN itself rather than on a card in it — to the top or to the bottom.
   *
   * Its own answer because the cell knows nothing about which cards it holds. Dropping in the space
   * above the first card used to be `ignore`, so aiming at the top of a column did nothing at all,
   * and the only way to sequence anything was to land precisely on another card. The caller resolves
   * which card this lands beside, because the caller is what knows the order.
   */
  | { kind: 'reorder-edge'; item: RollupBoardItem; edge: 'top' | 'bottom' };

/**
 * Where within a card a drop landed.
 *
 * `nest` is no longer produced by dragging at all — see resolveCardDropZone. It remains in the type
 * because a containment link is still a thing the board can record; it is now asked for explicitly
 * from the card's own menu rather than inferred from where a drop happened to land.
 */
export type CardDropZone = 'before' | 'nest' | 'after';

/**
 * Whether a drop onto a card lands above or below it.
 *
 * This used to have a third answer. The middle half of a card meant "put this inside", which made
 * containment something you could do **by accident** while trying to sequence — and it was worse
 * than that in practice, because the zone was measured against the dragged card's CENTRE rather than
 * the pointer. A card is often 250px tall, so its centre only clears a target's top quarter once the
 * card is most of a card-height above it. Sequencing was therefore nearly unreachable and virtually
 * every drop nested.
 *
 * Dragging now only ever sequences. Nesting writes to Jira and sequencing writes nothing, so the two
 * should not have shared one gesture in the first place; the explicit action lives in the card menu.
 */
export function resolveCardDropZone(
  pointerY: number,
  targetTopY: number,
  targetHeight: number,
): CardDropZone {
  if (targetHeight <= 0) return 'after';
  return pointerY < targetTopY + targetHeight / 2 ? 'before' : 'after';
}

/**
 * Where the pointer is now, from what a drag event carries.
 *
 * dnd-kit reports the pointer only at the moment the drag STARTED, plus how far it has moved since,
 * so adding them is the only way to get its current position — and the position is what every zone
 * decision should be made against.
 */
export function readPointerY(activatorEvent: Event | null, deltaY: number): number | null {
  const startY = (activatorEvent as PointerEvent | null)?.clientY;
  return typeof startY === 'number' ? startY + deltaY : null;
}

export interface ResolveCardDropInput {
  draggedItemKey: string;
  dropTargetId: string | null;
  itemsByKey: ReadonlyMap<string, RollupBoardItem>;
  columnsById: ReadonlyMap<string, RenderedColumn>;
  /** Where in the target card the drop landed. Defaults to sequencing, which writes nothing. */
  cardDropZone?: CardDropZone;
  /** Which half of a COLUMN CELL the drop landed in, when it landed on the cell rather than a card. */
  cellDropEdge?: 'top' | 'bottom';
}

/**
 * Decides what a drop means.
 *
 * Returns `ignore` for the non-events (dropped outside anything, dropped back where it started) so
 * the caller writes nothing, and `refused` with a reason for the drops that are real attempts at
 * something the board cannot do.
 */
export function resolveCardDrop(input: ResolveCardDropInput): CardDropDecision {
  if (input.dropTargetId === null) {
    return { kind: 'ignore' };
  }

  const draggedItem = input.itemsByKey.get(input.draggedItemKey);
  if (!draggedItem) {
    return { kind: 'ignore' };
  }

  // Dropped onto another card. Within the same column that is sequencing; across columns it is a
  // state change, so it falls through to the column rules below using that card's column.
  const targetIssueKey = parseCardTargetId(input.dropTargetId);
  if (targetIssueKey !== null) {
    const targetItem = input.itemsByKey.get(targetIssueKey);
    if (!targetItem || targetItem.key === draggedItem.key) return { kind: 'ignore' };
    if (targetItem.columnId === draggedItem.columnId) {
      return input.cardDropZone === 'nest'
        ? { kind: 'nest', item: draggedItem, containerIssueKey: targetIssueKey }
        : { kind: 'reorder', item: draggedItem, targetIssueKey };
    }
    const targetColumnForCard = input.columnsById.get(targetItem.columnId);
    if (!targetColumnForCard) return { kind: 'ignore' };
    if (targetColumnForCard.mappings.length === 0) {
      return {
        kind: 'refused',
        reason: `"${targetColumnForCard.name}" does not claim any Jira status yet, so there is nothing to write.`,
      };
    }
    return { kind: 'move', item: draggedItem, targetColumn: targetColumnForCard };
  }

  const dropTarget = parseDropTargetId(input.dropTargetId);
  if (!dropTarget) {
    return { kind: 'ignore' };
  }

  // Dropped on its OWN column: a sequencing request, not a non-event. This was `ignore`, which is
  // why aiming at the top of a column did nothing — the space above the first card is not a card, so
  // there was nothing there to land on.
  if (dropTarget.columnId === draggedItem.columnId) {
    return input.cellDropEdge === undefined
      ? { kind: 'ignore' }
      : { kind: 'reorder-edge', item: draggedItem, edge: input.cellDropEdge };
  }

  // A lane IS the Feature an issue delivers, so dropping a card in another lane is a request to
  // change that — the drag says exactly what the write should be. This was previously refused, on the
  // grounds that a lane is a fact rather than a position; the fact simply turned out to be editable.
  const draggedItemLaneKey = draggedItem.featureKey ?? dropTarget.featureKey;
  if (dropTarget.featureKey !== draggedItemLaneKey) {
    return { kind: 'relink', item: draggedItem, targetFeatureKey: dropTarget.featureKey };
  }

  const targetColumn = input.columnsById.get(dropTarget.columnId);
  if (!targetColumn) {
    return { kind: 'ignore' };
  }

  if (targetColumn.mappings.length === 0) {
    return {
      kind: 'refused',
      reason: `"${targetColumn.name}" does not claim any Jira status yet, so there is nothing to write.`,
    };
  }

  return { kind: 'move', item: draggedItem, targetColumn };
}
