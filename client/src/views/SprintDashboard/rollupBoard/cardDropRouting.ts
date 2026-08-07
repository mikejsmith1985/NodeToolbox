// cardDropRouting.ts — Works out what a card drop actually means, before anything is written.
//
// Drag-and-drop libraries hand back opaque ids, so the interpretation lives here as plain functions
// that a test can exercise without a browser. The rule worth stating: a card's LANE is decided by
// which Feature it delivers, never by where someone drops it. Dragging a card into another Feature's
// lane is refused rather than silently ignored, because silently ignoring it looks like a bug.

import type { BoardColumn, RenderedColumn, RollupBoardItem } from './rollupBoardTypes.ts';

/** Separator between the lane and column parts of a drop-target id. Not valid in a Jira key. */
const DROP_TARGET_SEPARATOR = '::';

/** Builds the id for one lane's column cell. */
export function buildDropTargetId(featureKey: string, columnId: string): string {
  return `${featureKey}${DROP_TARGET_SEPARATOR}${columnId}`;
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
  | { kind: 'move'; item: RollupBoardItem; targetColumn: BoardColumn | RenderedColumn };

export interface ResolveCardDropInput {
  draggedItemKey: string;
  dropTargetId: string | null;
  itemsByKey: ReadonlyMap<string, RollupBoardItem>;
  columnsById: ReadonlyMap<string, RenderedColumn>;
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

  const dropTarget = parseDropTargetId(input.dropTargetId);
  const draggedItem = input.itemsByKey.get(input.draggedItemKey);
  if (!dropTarget || !draggedItem) {
    return { kind: 'ignore' };
  }

  if (dropTarget.columnId === draggedItem.columnId) {
    return { kind: 'ignore' };
  }

  // A lane is where this work rolls up to, which is a fact about the Jira links — not a position
  // somebody can drag. Saying so beats appearing to accept the drop and then undoing it.
  const draggedItemLaneKey = draggedItem.featureKey ?? dropTarget.featureKey;
  if (dropTarget.featureKey !== draggedItemLaneKey) {
    return {
      kind: 'refused',
      reason:
        'A card sits in the lane of the Feature it delivers, so it cannot be dragged into another '
        + 'Feature. Change what it links to in Jira to move it.',
    };
  }

  const targetColumn = input.columnsById.get(dropTarget.columnId);
  if (!targetColumn) {
    return { kind: 'ignore' };
  }

  if (targetColumn.mapping === null) {
    return {
      kind: 'refused',
      reason: `"${targetColumn.name}" is not mapped to a Jira state yet, so there is nothing to write.`,
    };
  }

  return { kind: 'move', item: draggedItem, targetColumn };
}
