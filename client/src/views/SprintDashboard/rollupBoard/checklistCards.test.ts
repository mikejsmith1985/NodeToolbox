// checklistCards.test.ts — Proves a checklist item lands in the column of its OWN state.

import { describe, expect, it } from 'vitest';

import type { ChecklistItem } from './checklistItems.ts';
import type { RollupBoardItem } from './rollupBoardTypes.ts';
import {
  buildChecklistCards,
  buildChecklistDragId,
  parseChecklistCardId,
  parseChecklistDragId,
  resolveChecklistColumnId,
  resolveChecklistStateForColumn,
  suggestChecklistColumnMapping,
  type ChecklistColumnMapping,
} from './checklistCards.ts';

const MAPPING: ChecklistColumnMapping = {
  openColumnId: 'col-todo',
  inProgressColumnId: 'col-working',
  doneColumnId: 'col-done',
};

/** One checklist item with only what the card build reads. */
function buildItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'item-43628', text: 'this is a test', state: 'open', assigneeUserId: null,
    headingText: null, rank: 0, ...overrides,
  };
}

/** One board item carrying a checklist. */
function buildParent(key: string, checklistItems: ChecklistItem[]): RollupBoardItem {
  return { key, featureKey: 'FEAT-1', checklistItems } as unknown as RollupBoardItem;
}

describe('resolveChecklistColumnId', () => {
  it('puts a FINISHED item in the done column, not its parent’s column', () => {
    // The defect this whole module exists for: a done checklist item sat in To Do because its
    // parent had not moved, which breaks the one rule the board enforces.
    expect(resolveChecklistColumnId(MAPPING, 'done')).toBe('col-done');
    expect(resolveChecklistColumnId(MAPPING, 'in-progress')).toBe('col-working');
    expect(resolveChecklistColumnId(MAPPING, 'open')).toBe('col-todo');
  });

  it('answers empty when the team has not mapped the states, which means Unmapped', () => {
    // Never a guessed home: the board's rule is that unplaceable work is VISIBLE, not filed away.
    expect(resolveChecklistColumnId(undefined, 'done')).toBe('');
  });
});

describe('resolveChecklistStateForColumn', () => {
  it('reads a drop target column back into the state it stands for', () => {
    expect(resolveChecklistStateForColumn(MAPPING, 'col-done')).toBe('done');
    expect(resolveChecklistStateForColumn(MAPPING, 'col-working')).toBe('in-progress');
    expect(resolveChecklistStateForColumn(MAPPING, 'col-todo')).toBe('open');
  });

  it('refuses a column that stands for no checklist state', () => {
    // Dropping a checklist card in Code Review means nothing, so the drop writes nothing.
    expect(resolveChecklistStateForColumn(MAPPING, 'col-review')).toBeNull();
    expect(resolveChecklistStateForColumn(undefined, 'col-done')).toBeNull();
  });

  it('round-trips with the placement, so a card dropped where it sits does not move', () => {
    expect(resolveChecklistStateForColumn(MAPPING, resolveChecklistColumnId(MAPPING, 'in-progress')))
      .toBe('in-progress');
  });
});

describe('suggestChecklistColumnMapping', () => {
  const COLUMNS = [
    { id: 'col-todo', mappings: ['x'] },
    { id: 'col-working', mappings: ['x'] },
    { id: 'col-review', mappings: ['x'] },
    { id: 'col-done', mappings: ['x'] },
    { id: 'col-unmapped', mappings: [], isUnmappedColumn: true },
  ];

  it('opens with first, middle and last of the columns the team actually built', () => {
    expect(suggestChecklistColumnMapping(COLUMNS)).toEqual({
      openColumnId: 'col-todo', inProgressColumnId: 'col-working', doneColumnId: 'col-done',
    });
  });

  it('never suggests the Unmapped column, which is where things go when nothing fits', () => {
    expect(Object.values(suggestChecklistColumnMapping(COLUMNS))).not.toContain('col-unmapped');
  });

  it('never suggests a column claiming no Jira status, which could not accept a move', () => {
    const withUnclaimed = [{ id: 'col-empty', mappings: [] }, { id: 'col-real', mappings: ['x'] }];

    expect(suggestChecklistColumnMapping(withUnclaimed).openColumnId).toBe('col-real');
  });

  it('suggests nothing at all when no column is mapped yet', () => {
    expect(suggestChecklistColumnMapping([])).toEqual({
      openColumnId: '', inProgressColumnId: '', doneColumnId: '',
    });
  });
});

describe('buildChecklistCards', () => {
  it('draws one card per item, in its parent’s lane', () => {
    const cards = buildChecklistCards([
      buildParent('DEV-1', [buildItem(), buildItem({ id: 'item-2', state: 'done', rank: 1 })]),
    ], MAPPING);

    expect(cards.map((card) => [card.parentKey, card.columnId])).toEqual([
      ['DEV-1', 'col-todo'],
      ['DEV-1', 'col-done'],
    ]);
    expect(cards.every((card) => card.featureKey === 'FEAT-1')).toBe(true);
  });

  it('gives each card an id built from its parent AND the app’s own item id', () => {
    // Stable across inserts: a positional id would renumber every item below an insertion, and the
    // drag order, the selection and the pending marker would all move to the wrong line.
    expect(buildChecklistCards([buildParent('DEV-1', [buildItem()])], MAPPING)[0].id)
      .toBe('DEV-1#item-43628');
  });

  it('respects the order somebody arranged in the checklist app', () => {
    const cards = buildChecklistCards([
      buildParent('DEV-1', [
        buildItem({ id: 'item-a', text: 'second', rank: 5 }),
        buildItem({ id: 'item-b', text: 'first', rank: 1 }),
      ]),
    ], MAPPING);

    expect(cards.map((card) => card.text)).toEqual(['first', 'second']);
  });

  it('carries the owner through, so the assignee filter can match the card itself', () => {
    const cards = buildChecklistCards([
      buildParent('DEV-1', [buildItem({
        assigneeUserId: 'C8Q6T3', ownerFilterId: 'acc-11', ownerDisplayName: 'Smith, Michael (CTR)',
      })]),
    ], MAPPING);

    expect(cards[0].ownerFilterId).toBe('acc-11');
    expect(cards[0].ownerDisplayName).toBe('Smith, Michael (CTR)');
  });

  it('produces nothing for an issue with no checklist', () => {
    expect(buildChecklistCards([buildParent('DEV-1', [])], MAPPING)).toEqual([]);
  });
});

describe('checklist drag ids', () => {
  it('is distinguishable from an issue key, so one drag is never taken for the other', () => {
    const card = buildChecklistCards([buildParent('DEV-1', [buildItem()])], MAPPING)[0];
    const dragId = buildChecklistDragId(card);

    expect(parseChecklistDragId(dragId)).toBe('DEV-1#item-43628');
    expect(parseChecklistDragId('DEV-1')).toBeNull();
  });

  it('splits back into the issue to write to and the item within it', () => {
    expect(parseChecklistCardId('DEV-1#item-43628'))
      .toEqual({ parentKey: 'DEV-1', itemId: 'item-43628' });
  });
});
