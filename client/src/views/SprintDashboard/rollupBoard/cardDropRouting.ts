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
  | { kind: 'reorder'; item: RollupBoardItem; targetIssueKey: string };

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
      return { kind: 'reorder', item: draggedItem, targetIssueKey };
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

  if (targetColumn.mappings.length === 0) {
    return {
      kind: 'refused',
      reason: `"${targetColumn.name}" does not claim any Jira status yet, so there is nothing to write.`,
    };
  }

  return { kind: 'move', item: draggedItem, targetColumn };
}
