// columnFocus.test.ts — Proves focusing a column narrows what is DRAWN and nothing else, and that a
// focus pointing at a column that no longer exists shows the whole board instead of a blank one.

import { describe, expect, it } from 'vitest';

import { selectDetailIssueKeys, selectFamilyKey, selectVisibleColumns, toggleColumnFocus } from './columnFocus.ts';
import type { RenderedColumn } from './rollupBoardTypes.ts';

function buildColumn(columnId: string): RenderedColumn {
  return {
    id: columnId,
    name: columnId,
    order: 0,
    mappings: [],
    isUnmappedColumn: false,
  };
}

const COLUMNS: RenderedColumn[] = [buildColumn('build'), buildColumn('ready-for-qa'), buildColumn('done')];

describe('selectVisibleColumns', () => {
  it('draws every column when nothing is focused', () => {
    expect(selectVisibleColumns(COLUMNS, null).map((column) => column.id))
      .toEqual(['build', 'ready-for-qa', 'done']);
  });

  it('draws only the focused column', () => {
    expect(selectVisibleColumns(COLUMNS, 'ready-for-qa').map((column) => column.id)).toEqual(['ready-for-qa']);
  });

  it('falls back to the whole board when the focused column no longer exists', () => {
    expect(selectVisibleColumns(COLUMNS, 'a-column-that-was-renamed')).toHaveLength(COLUMNS.length);
  });
});

describe('toggleColumnFocus', () => {
  it('focuses a column that was not focused', () => {
    expect(toggleColumnFocus(null, 'build')).toBe('build');
  });

  it('releases the column that is already focused, so the same gesture reverts', () => {
    expect(toggleColumnFocus('build', 'build')).toBeNull();
  });

  it('moves the focus when a different column is double-clicked', () => {
    expect(toggleColumnFocus('build', 'done')).toBe('done');
  });
});

describe('selectDetailIssueKeys', () => {
  const ITEMS = [
    { key: 'DENP-1', columnId: 'build' },
    { key: 'DENP-2', columnId: 'ready-for-qa' },
    { key: 'DENP-3', columnId: 'ready-for-qa' },
  ];

  it('reads nothing while the board is unfocused', () => {
    expect(selectDetailIssueKeys(ITEMS, null)).toEqual([]);
  });

  it('reads only the focused column, so an unopened column costs no fetch', () => {
    expect(selectDetailIssueKeys(ITEMS, 'ready-for-qa')).toEqual(['DENP-2', 'DENP-3']);
  });
});

describe('selectFamilyKey — highlighting the rest of THIS work, not the whole lane', () => {
  it('uses a sub-task\'s parent, so clicking one lights up its Story and its siblings', () => {
    expect(selectFamilyKey({ key: 'DEV-1-1', parentKey: 'DEV-1', featureKey: 'DENP-1389' })).toBe('DEV-1');
  });

  it('uses the card itself when its parent is the lane\'s own Feature', () => {
    // The degenerate case: every Story in a lane shares that parent, so using it ringed every Story
    // together to say only "these are in the same swimlane" — which the swimlane already said.
    expect(selectFamilyKey({ key: 'DEV-1', parentKey: 'DENP-1389', featureKey: 'DENP-1389' })).toBe('DEV-1');
  });

  it('uses the card itself when it has no parent at all', () => {
    expect(selectFamilyKey({ key: 'DEV-1', parentKey: null, featureKey: 'DENP-1389' })).toBe('DEV-1');
  });

  it('still uses a parent that is not the lane Feature, since that groups something real', () => {
    expect(selectFamilyKey({ key: 'DEV-2', parentKey: 'DEV-1', featureKey: null })).toBe('DEV-1');
  });
});
