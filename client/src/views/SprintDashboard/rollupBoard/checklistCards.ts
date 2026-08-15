// checklistCards.ts — Drawing a Smart Checklist item as a card, in the column of its own state.
//
// The board's central promise is that every piece of work sits in the column of ITS OWN status. That
// held for Stories and sub-tasks and quietly did not hold for the third way this team breaks work
// down: a checklist item was drawn as a line inside its parent's card, so a FINISHED checklist item
// sat in the To Do column because its parent had not moved. The one rule the board exists to enforce
// was broken for one work type.
//
// A checklist item is not a Jira issue, and this deliberately does not pretend otherwise. It has no
// key, no permalink, no transitions and no children, so the card it becomes offers none of those. It
// has exactly three things a board can use — a state, an owner and a parent — and those are what it
// is drawn with.
//
// What it does NOT do is count toward a Feature's progress. Adding it there would change every
// Feature's headline number the moment this shipped, and put the board's percentage permanently at
// odds with anything Jira reports. That is a decision to take deliberately, not a side effect of a
// rendering change.

import type { ChecklistItem, ChecklistItemState } from './checklistItems.ts';
import type { RollupBoardItem } from './rollupBoardTypes.ts';

/** Separates a parent's key from its item's id. Not valid in a Jira key, so it can never collide. */
const CHECKLIST_CARD_SEPARATOR = '#';

/** Prefix marking a drag id as a checklist card rather than an issue. */
const CHECKLIST_DRAG_PREFIX = 'checklist::';

/** Which of the team's columns each checklist state belongs in. */
export interface ChecklistColumnMapping {
  openColumnId: string;
  inProgressColumnId: string;
  doneColumnId: string;
}

/** One checklist item, ready to draw as a card. */
export interface ChecklistCard {
  /** `PARENT-1#item-43628` — stable across edits, because the app's own item id is stable. */
  id: string;
  parentKey: string;
  /** The lane this belongs in, which is always its parent's lane. */
  featureKey: string | null;
  columnId: string;
  text: string;
  state: ChecklistItemState;
  ownerFilterId: string | null;
  ownerDisplayName: string | null;
  /** The app's own item id, which is what a write has to name. */
  itemId: string;
  rank: number;
}

/** Builds the drag id for a checklist card, kept distinct from an issue key. */
export function buildChecklistDragId(card: ChecklistCard): string {
  return `${CHECKLIST_DRAG_PREFIX}${card.id}`;
}

/** The card id a drag names, or null when the drag is an ordinary issue. */
export function parseChecklistDragId(dragId: string): string | null {
  return dragId.startsWith(CHECKLIST_DRAG_PREFIX)
    ? dragId.slice(CHECKLIST_DRAG_PREFIX.length)
    : null;
}

/** Splits a card id back into the issue it belongs to and the item within it. */
export function parseChecklistCardId(cardId: string): { parentKey: string; itemId: string } | null {
  const separatorIndex = cardId.indexOf(CHECKLIST_CARD_SEPARATOR);
  if (separatorIndex < 0) return null;
  return {
    parentKey: cardId.slice(0, separatorIndex),
    itemId: cardId.slice(separatorIndex + CHECKLIST_CARD_SEPARATOR.length),
  };
}

/**
 * Column names that say what a state is, so the guess reads the board rather than counting it.
 *
 * Position alone put "Working" in the sixth of eleven columns — which happened to be SL Testing —
 * on a board that has a column literally called WORKING. Names first, position only as the fallback.
 */
const NAME_HINTS: Record<keyof ChecklistColumnMapping, RegExp> = {
  openColumnId: /^(to.?do|backlog|triage|new|open|ready)/i,
  inProgressColumnId: /(in.?progress|working|doing|develop)/i,
  doneColumnId: /(done|complete|accepted|closed)/i,
};

/**
 * A starting mapping, from the columns the team already built.

 * A guess, and meant to be one — the point is that the board opens with something workable rather
 * than with every checklist item in Unmapped, and that the guess is then visible and changeable in
 * Board setup. Only columns that CLAIM a Jira status are considered, because the Unmapped column is
 * where things go when nothing else fits, never a default home.
 */
export function suggestChecklistColumnMapping(
  columns: readonly { id: string; name?: string; mappings: readonly unknown[]; isUnmappedColumn?: boolean }[],
): ChecklistColumnMapping {
  const mappedColumns = columns.filter((column) => !column.isUnmappedColumn && column.mappings.length > 0);
  if (mappedColumns.length === 0) return { openColumnId: '', inProgressColumnId: '', doneColumnId: '' };

  const lastIndex = mappedColumns.length - 1;
  const positionFallback: ChecklistColumnMapping = {
    openColumnId: mappedColumns[0].id,
    inProgressColumnId: mappedColumns[Math.floor(lastIndex / 2)].id,
    doneColumnId: mappedColumns[lastIndex].id,
  };

  /** The first column whose NAME says this state, or the positional guess when none does. */
  function pickColumnId(stateKey: keyof ChecklistColumnMapping): string {
    const named = mappedColumns.find((column) => NAME_HINTS[stateKey].test(column.name ?? ''));
    return named?.id ?? positionFallback[stateKey];
  }

  return {
    openColumnId: pickColumnId('openColumnId'),
    inProgressColumnId: pickColumnId('inProgressColumnId'),
    // Done is read from the END, because a board's later columns are the finished ones and an early
    // column named "Ready for Testing / Done" would otherwise claim it.
    doneColumnId: [...mappedColumns].reverse()
      .find((column) => NAME_HINTS.doneColumnId.test(column.name ?? ''))?.id
      ?? positionFallback.doneColumnId,
  };
}

/** The column one state lands in, or '' when the team has not said — which means Unmapped. */
export function resolveChecklistColumnId(
  mapping: ChecklistColumnMapping | undefined,
  state: ChecklistItemState,
): string {
  if (mapping === undefined) return '';
  if (state === 'done') return mapping.doneColumnId;
  if (state === 'in-progress') return mapping.inProgressColumnId;
  return mapping.openColumnId;
}

/** The state a column stands for, or null when that column is not a checklist destination. */
export function resolveChecklistStateForColumn(
  mapping: ChecklistColumnMapping | undefined,
  columnId: string,
): ChecklistItemState | null {
  if (mapping === undefined || columnId === '') return null;
  if (mapping.doneColumnId === columnId) return 'done';
  if (mapping.inProgressColumnId === columnId) return 'in-progress';
  if (mapping.openColumnId === columnId) return 'open';
  return null;
}

/**
 * Every checklist item on the board, as cards.
 *
 * Built from the issues rather than injected into them: a checklist item is not an issue, and putting
 * one into the board's item list would quietly add it to every count, every percentage and every
 * rollup that reads that list. Keeping them separate makes "does this count?" a decision each of
 * those makes for itself.
 */
export function buildChecklistCards(
  items: readonly RollupBoardItem[],
  mapping: ChecklistColumnMapping | undefined,
): ChecklistCard[] {
  const cards: ChecklistCard[] = [];

  for (const item of items) {
    for (const checklistItem of item.checklistItems) {
      cards.push(buildChecklistCard(item, checklistItem, mapping));
    }
  }

  // The app's own rank, so the board shows the order somebody actually arranged in Jira.
  return cards.sort((leftCard, rightCard) => leftCard.rank - rightCard.rank);
}

/** One card from one item. */
function buildChecklistCard(
  parentItem: RollupBoardItem,
  checklistItem: ChecklistItem,
  mapping: ChecklistColumnMapping | undefined,
): ChecklistCard {
  return {
    id: `${parentItem.key}${CHECKLIST_CARD_SEPARATOR}${checklistItem.id}`,
    parentKey: parentItem.key,
    featureKey: parentItem.featureKey,
    columnId: resolveChecklistColumnId(mapping, checklistItem.state),
    text: checklistItem.text,
    state: checklistItem.state,
    ownerFilterId: checklistItem.ownerFilterId ?? checklistItem.assigneeUserId,
    ownerDisplayName: checklistItem.ownerDisplayName ?? null,
    itemId: checklistItem.id,
    rank: checklistItem.rank ?? 0,
  };
}
