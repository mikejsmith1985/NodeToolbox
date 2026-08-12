// columnDensity.test.ts — Proves the board fits a normal screen at 100% zoom, which is the whole
// point of the board sizing its own columns instead of borrowing a form-control width.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLUMN_DENSITY,
  describeColumnFit,
  measureBoardWidth,
  readColumnMinWidth,
  suggestDensityForWidth,
} from './columnDensity.ts';

/** A 1920px screen with the app's own chrome taken off — the case the user was zooming out to solve. */
const TYPICAL_BOARD_WIDTH = 1820;

describe('measureBoardWidth', () => {
  it('fits twelve columns on a normal screen at the default density', () => {
    expect(measureBoardWidth(12, DEFAULT_COLUMN_DENSITY)).toBeLessThanOrEqual(TYPICAL_BOARD_WIDTH);
  });

  it('fits fourteen columns when the team chooses compact', () => {
    expect(measureBoardWidth(14, 'compact')).toBeLessThanOrEqual(TYPICAL_BOARD_WIDTH);
  });

  it('counts the gaps between columns, not just the columns', () => {
    expect(measureBoardWidth(2, 'standard')).toBeGreaterThan(2 * 136);
  });

  it('charges no gap for a single column, which is what a focused column is', () => {
    expect(measureBoardWidth(1, 'standard')).toBe(136);
  });
});

describe('readColumnMinWidth', () => {
  it('falls back to the default for a density stored by an older version', () => {
    expect(readColumnMinWidth(undefined)).toBe(readColumnMinWidth(DEFAULT_COLUMN_DENSITY));
  });

  it('never returns a viewport unit, because that makes the fit depend on window size', () => {
    for (const density of ['compact', 'standard', 'roomy'] as const) {
      expect(readColumnMinWidth(density)).not.toContain('vw');
    }
  });
});

describe('suggestDensityForWidth', () => {
  it('prefers the roomiest density that still fits everything', () => {
    expect(suggestDensityForWidth(8, TYPICAL_BOARD_WIDTH)).toBe('roomy');
  });

  it('drops to compact when that is the only one that fits', () => {
    expect(suggestDensityForWidth(14, TYPICAL_BOARD_WIDTH)).toBe('compact');
  });

  it('suggests nothing when no density fits, rather than pretending compact will do', () => {
    expect(suggestDensityForWidth(40, TYPICAL_BOARD_WIDTH)).toBeNull();
  });
});

describe('describeColumnFit', () => {
  it('confirms the board fits when it does', () => {
    expect(describeColumnFit(10, 'standard', TYPICAL_BOARD_WIDTH)).toContain('fit without scrolling');
  });

  it('names the density that would fit when the board overflows', () => {
    expect(describeColumnFit(14, 'roomy', TYPICAL_BOARD_WIDTH)).toContain('compact');
  });

  it('admits when even compact will not fit them all', () => {
    expect(describeColumnFit(40, 'roomy', TYPICAL_BOARD_WIDTH)).toContain('retiring a column');
  });
});
