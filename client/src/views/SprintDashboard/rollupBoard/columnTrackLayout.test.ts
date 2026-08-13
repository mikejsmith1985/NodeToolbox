// columnTrackLayout.test.ts — Proves the header row and every lane's cells are laid out by ONE
// calculation, and that a collapsed column narrows without ever disappearing.

import { describe, expect, it } from 'vitest';

import {
  COLLAPSED_COLUMN_WIDTH,
  buildColumnTracks,
  isColumnCollapsed,
  toggleColumnCollapsed,
} from './columnTrackLayout.ts';

const FOUR_COLUMNS = [{ id: 'col-a' }, { id: 'col-b' }, { id: 'col-c' }, { id: 'col-d' }];

describe('buildColumnTracks', () => {
  it('gives every column an equal, floor-width track when none is collapsed', () => {
    const tracks = buildColumnTracks(FOUR_COLUMNS, new Set(), '136px');

    expect(tracks.gridTemplateColumns).toBe('minmax(136px, 1fr) minmax(136px, 1fr) minmax(136px, 1fr) minmax(136px, 1fr)');
  });

  it('gives a collapsed column a fixed narrow track and takes it out of the shared space', () => {
    const tracks = buildColumnTracks(FOUR_COLUMNS, new Set(['col-b']), '136px');

    expect(tracks.gridTemplateColumns)
      .toBe(`minmax(136px, 1fr) ${COLLAPSED_COLUMN_WIDTH} minmax(136px, 1fr) minmax(136px, 1fr)`);
  });

  it('counts the collapsed column into the board width at its NARROW size, which is the whole point', () => {
    const expanded = buildColumnTracks(FOUR_COLUMNS, new Set(), '136px');
    const collapsed = buildColumnTracks(FOUR_COLUMNS, new Set(['col-b', 'col-d']), '136px');

    expect(expanded.minWidth).toBe('calc(4 * 136px + 0 * 40px + 3 * var(--spacing-xs))');
    expect(collapsed.minWidth).toBe('calc(2 * 136px + 2 * 40px + 3 * var(--spacing-xs))');
  });

  it('keeps the gap count tied to the COLUMN count, since a collapsed column still has gaps', () => {
    // The board is only narrower because the tracks are, never because a column stopped existing.
    const tracks = buildColumnTracks(FOUR_COLUMNS, new Set(['col-a', 'col-b', 'col-c', 'col-d']), '136px');

    expect(tracks.gridTemplateColumns.split(' ')).toHaveLength(4);
    expect(tracks.minWidth).toContain('3 * var(--spacing-xs)');
  });

  it('lays out an empty board without producing a broken template', () => {
    const tracks = buildColumnTracks([], new Set(), '136px');

    expect(tracks.gridTemplateColumns).toBe('');
    expect(tracks.minWidth).toBe('calc(0 * 136px + 0 * 40px + 0 * var(--spacing-xs))');
  });

  it('ignores a collapsed id for a column that is no longer on the board', () => {
    // Column ids outlive the columns themselves in stored preferences; a stale one must not shift
    // the tracks of the columns that remain.
    const tracks = buildColumnTracks(FOUR_COLUMNS, new Set(['col-retired']), '136px');

    expect(tracks.gridTemplateColumns).toBe(buildColumnTracks(FOUR_COLUMNS, new Set(), '136px').gridTemplateColumns);
  });
});

describe('toggleColumnCollapsed', () => {
  it('collapses a column that is open, and opens one that is collapsed', () => {
    expect([...toggleColumnCollapsed([], 'col-a')]).toEqual(['col-a']);
    expect([...toggleColumnCollapsed(['col-a'], 'col-a')]).toEqual([]);
  });

  it('leaves the other columns exactly as they were', () => {
    expect([...toggleColumnCollapsed(['col-a', 'col-b'], 'col-c')].sort()).toEqual(['col-a', 'col-b', 'col-c']);
  });
});

describe('isColumnCollapsed', () => {
  it('reads the stored list, treating an absent one as nothing collapsed', () => {
    expect(isColumnCollapsed(['col-a'], 'col-a')).toBe(true);
    expect(isColumnCollapsed(['col-a'], 'col-b')).toBe(false);
    expect(isColumnCollapsed(undefined, 'col-a')).toBe(false);
  });
});
