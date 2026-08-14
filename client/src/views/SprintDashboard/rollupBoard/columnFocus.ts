// columnFocus.ts — Opening one status column to the full width of the board.
//
// A dozen columns across a dozen lanes means every card is a narrow slice, wide enough for a key and
// a truncated summary and nothing else. Most of the time that is the right trade: the board is for
// seeing where everything is. But when the question becomes "what is actually going on in Ready for
// QA", the other eleven columns are just consuming the width the answer needs.
//
// Focusing a column hides the rest and gives that one all the room, which is what lets its cards
// carry a description, an attachment count, and the last thing anybody said. Nothing else changes:
// the quick filters, the lane order, and each Feature's roll-up figures behave exactly as before,
// because focus only narrows WHICH columns are drawn, not which work the board is looking at.

import type { RenderedColumn } from './rollupBoardTypes.ts';

/**
 * The columns the board should draw.
 *
 * Returns every column when nothing is focused, and returns every column again when the focused id
 * matches nothing — a stale focus (a column renamed or removed from the vocabulary since) must fall
 * back to the whole board rather than leaving a blank one.
 */
export function selectVisibleColumns(
  columns: readonly RenderedColumn[],
  focusedColumnId: string | null,
): RenderedColumn[] {
  if (focusedColumnId === null) return [...columns];

  const focusedColumns = columns.filter((column) => column.id === focusedColumnId);
  return focusedColumns.length > 0 ? focusedColumns : [...columns];
}

/**
 * What a double-click on a header should set the focus to.
 *
 * Clicking the already-focused column releases it, which is what makes the same gesture both the way
 * in and the way out — the user was told "double-click to revert", not "double-click something else".
 */
export function toggleColumnFocus(currentFocusedColumnId: string | null, clickedColumnId: string): string | null {
  return currentFocusedColumnId === clickedColumnId ? null : clickedColumnId;
}

/**
 * The issue keys whose extra detail is worth reading.
 *
 * Only the focused column's, and only while one is focused: descriptions and comment threads for a
 * whole board would be a large payload for information nobody has asked to see.
 */
export function selectDetailIssueKeys(
  items: readonly { key: string; columnId: string }[],
  focusedColumnId: string | null,
): string[] {
  if (focusedColumnId === null) return [];
  return items.filter((item) => item.columnId === focusedColumnId).map((item) => item.key);
}

/**
 * Which key a click on a card should highlight the family of.
 *
 * The highlight exists to answer "where is the rest of this work?" — click a Story and its sub-tasks
 * light up wherever they have got to across the columns. That is worth having, because the whole
 * point of this board is that a piece of work's parentage is never something you have to infer.
 *
 * It degenerated when the card's parent was the LANE'S OWN FEATURE. Clicking any Story then
 * highlighted every Story in the lane — because they all share that parent — which tells you only
 * that they are in the same swimlane, and the swimlane already told you that. Two Stories ringed
 * together for no reason reads as a signal that something is related, when nothing is.
 *
 * So a parent is used as the family root only when it groups something the LANE does not already
 * group. Where it does not, the card itself is the root and its own children light up instead.
 */
export function selectFamilyKey(item: {
  key: string;
  parentKey: string | null;
  featureKey: string | null;
}): string {
  const parentKey = item.parentKey;
  if (parentKey === null || parentKey === item.featureKey) return item.key;
  return parentKey;
}
