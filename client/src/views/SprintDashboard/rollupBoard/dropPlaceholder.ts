// dropPlaceholder.ts — Where the empty "move here" box goes while a card is being dragged.
//
// The board used to mark a drop with a thin blue line along the top edge of the card underneath. A
// line says "something will happen near here" and leaves the rest to be inferred: how far the cards
// move, what ends up where, whether you are about to land above this card or inside it. A gap that
// actually opens says all of it without a word — and with a word in it, there is nothing left to
// infer at all.
//
// The rule lives here rather than in the lane because it is arithmetic about position, and arithmetic
// is worth being able to test without a browser and a pointer.

/** What the board is currently offering to do with the dragged card. */
export interface DropPreview {
  /** The cell the gap belongs in, keyed exactly as the drop targets are: `featureKey::columnId`. */
  cellId: string;
  /**
   * The card the gap sits beside, or null when it belongs at one END of the cell.
   *
   * A key rather than an index: a cell re-orders under the pointer while the drag is in progress, and
   * an index would then point at whatever had moved into that slot.
   */
  anchorKey: string | null;
  edge: 'before' | 'after';
}

/** One thing drawn in a cell, reduced to the only part this needs: which card, if any, it is. */
export interface PlaceholderCandidate {
  /** The issue key this entry draws, or null for a container, which is never an anchor. */
  itemKey: string | null;
}

/**
 * Which slot the gap occupies, counting the same way `Array.splice` does.
 *
 * Returns null when this cell is not the one being hovered, which is every cell but one — so the
 * board draws exactly one gap however many columns and lanes are on screen.
 */
export function resolvePlaceholderIndex(
  preview: DropPreview | null,
  cellId: string,
  entries: readonly PlaceholderCandidate[],
): number | null {
  if (preview === null || preview.cellId !== cellId) return null;

  // No anchor means an end of the cell: the top when the pointer was in its upper half, the bottom
  // when it was in the lower one.
  if (preview.anchorKey === null) {
    return preview.edge === 'before' ? 0 : entries.length;
  }

  const anchorIndex = entries.findIndex((entry) => entry.itemKey === preview.anchorKey);
  // The anchor has left the cell — dropped elsewhere, or filtered away mid-drag. Falling back to the
  // end is honest: the gap stays visible rather than vanishing and leaving nothing to aim at.
  if (anchorIndex < 0) return entries.length;

  return preview.edge === 'before' ? anchorIndex : anchorIndex + 1;
}

/** One container in a cell, reduced to the cards it holds. */
export interface PlaceholderContainer {
  parentKey: string;
  itemKeys: readonly string[];
}

/** Where the one gap on the board goes: loose in a cell, or inside one of its containers. */
export type PlaceholderPlacement =
  | { target: 'cell'; index: number }
  | { target: 'container'; parentKey: string; index: number };

/**
 * Resolves the ONE gap for a cell — including when it belongs inside a parent container.
 *
 * A container's cards are drawn inside it rather than in the cell's own list, so a cell that just
 * asked "where does the anchor sit in my entries?" could not find a contained card and fell back to
 * the end of the cell. That is what made a container's cards impossible to reorder: the gap opened
 * somewhere else entirely, and the drop it was previewing landed somewhere else again.
 *
 * Resolving both placements in one function is what keeps the gap unique. Two independent rules — one
 * for the cell, one for each container — would each have to decide the other is not drawing it, and
 * a cell of three containers would then be four opinions about one card.
 */
export function resolveCellPlaceholder(
  preview: DropPreview | null,
  cellId: string,
  entries: readonly PlaceholderCandidate[],
  containers: readonly PlaceholderContainer[],
): PlaceholderPlacement | null {
  if (preview === null || preview.cellId !== cellId) return null;

  // A contained card is the anchor: the gap opens between its siblings, inside their container.
  if (preview.anchorKey !== null) {
    const owningContainer = containers.find((container) => container.itemKeys.includes(preview.anchorKey ?? ''));
    if (owningContainer) {
      const anchorIndex = owningContainer.itemKeys.indexOf(preview.anchorKey);
      return {
        target: 'container',
        parentKey: owningContainer.parentKey,
        index: preview.edge === 'before' ? anchorIndex : anchorIndex + 1,
      };
    }
  }

  const cellIndex = resolvePlaceholderIndex(preview, cellId, entries);
  return cellIndex === null ? null : { target: 'cell', index: cellIndex };
}

/**
 * The gap a card is lifted OUT of, so the cell does not appear to gain a slot while one is in the air.
 *
 * Without this, dragging a card within its own column shows a gap where it came from and another
 * where it might land — two openings for one card, which reads as though it is about to be copied.
 */
export function shouldHideDraggedEntry(draggedItemKey: string | null, itemKey: string | null): boolean {
  return draggedItemKey !== null && itemKey === draggedItemKey;
}
