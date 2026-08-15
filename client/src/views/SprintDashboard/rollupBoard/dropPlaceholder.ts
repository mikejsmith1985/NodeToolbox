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

/**
 * The gap a card is lifted OUT of, so the cell does not appear to gain a slot while one is in the air.
 *
 * Without this, dragging a card within its own column shows a gap where it came from and another
 * where it might land — two openings for one card, which reads as though it is about to be copied.
 */
export function shouldHideDraggedEntry(draggedItemKey: string | null, itemKey: string | null): boolean {
  return draggedItemKey !== null && itemKey === draggedItemKey;
}
