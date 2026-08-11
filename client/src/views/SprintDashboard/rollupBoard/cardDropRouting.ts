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
  | { kind: 'nest'; item: RollupBoardItem; containerIssueKey: string };

/** Where within a card a drop landed, which decides whether it sequences or nests. */
export type CardDropZone = 'before' | 'nest' | 'after';

/** The middle share of a card's height that means "put this inside", not "put it near". */
const NEST_ZONE_SHARE = 0.5;

/**
 * Works out whether a drop onto a card was aimed at its body or at the gap above or below it.
 *
 * Edge-versus-middle is how every tree control behaves, and it means nesting needs no modifier key —
 * which matters because a hidden keyboard shortcut is a feature nobody finds.
 */
export function resolveCardDropZone(
  draggedCenterY: number,
  targetTopY: number,
  targetHeight: number,
): CardDropZone {
  if (targetHeight <= 0) return 'nest';

  const positionWithinTarget = (draggedCenterY - targetTopY) / targetHeight;
  const nestBegins = (1 - NEST_ZONE_SHARE) / 2;

  if (positionWithinTarget < nestBegins) return 'before';
  if (positionWithinTarget > 1 - nestBegins) return 'after';
  return 'nest';
}

export interface ResolveCardDropInput {
  draggedItemKey: string;
  dropTargetId: string | null;
  itemsByKey: ReadonlyMap<string, RollupBoardItem>;
  columnsById: ReadonlyMap<string, RenderedColumn>;
  /** Where in the target card the drop landed. Defaults to sequencing, which writes nothing. */
  cardDropZone?: CardDropZone;
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

  if (dropTarget.columnId === draggedItem.columnId) {
    return { kind: 'ignore' };
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
