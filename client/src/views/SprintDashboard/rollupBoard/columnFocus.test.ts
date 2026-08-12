// columnFocus.test.ts — Proves focusing a column narrows what is DRAWN and nothing else, and that a
// focus pointing at a column that no longer exists shows the whole board instead of a blank one.

import { describe, expect, it } from 'vitest';

import { selectDetailIssueKeys, selectVisibleColumns, toggleColumnFocus } from './columnFocus.ts';
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
