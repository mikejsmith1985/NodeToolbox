// carryOverMarks.test.ts — Proves the board can read the Carry-Over ticks the team already maintains,
// rather than deriving carry-over and dragging in Features nobody is working on.

import { describe, expect, it } from 'vitest';

import {
  describeCarryOverMarks,
  findPiReviewPageForPi,
  readCarryOverFeatureKeys,
} from './carryOverMarks.ts';
import type { PiReviewRow } from '../../ArtView/piReviewTable.ts';

/** One PI Review row, reduced to the two cells this reads. */
function buildRow(feature: string, carryOver: string): PiReviewRow {
  return { feature, carryOver } as unknown as PiReviewRow;
}

describe('findPiReviewPageForPi — the CURRENT PI\'s page', () => {
  const PAGES = [
    { piName: 'PI 26.3', pageUrl: 'https://conf/26-3' },
    { piName: 'PI 26.4', pageUrl: 'https://conf/26-4' },
  ];

  it('finds the page for the PI asked for', () => {
    // The current PI's page is the right one: its Carry-Over column marks what arrived from 26.3.
    expect(findPiReviewPageForPi(PAGES, 'PI 26.4')).toBe('https://conf/26-4');
  });

  it('tolerates padding around the configured PI name', () => {
    expect(findPiReviewPageForPi([{ piName: '  PI 26.4  ', pageUrl: 'https://conf/x' }], 'PI 26.4'))
      .toBe('https://conf/x');
  });

  it('returns null when no page is configured for that PI', () => {
    expect(findPiReviewPageForPi(PAGES, 'PI 27.1')).toBeNull();
  });

  it('ignores a configured page with no URL', () => {
    expect(findPiReviewPageForPi([{ piName: 'PI 26.4', pageUrl: '   ' }], 'PI 26.4')).toBeNull();
  });

  it('returns null for a blank PI rather than matching something arbitrary', () => {
    expect(findPiReviewPageForPi(PAGES, '  ')).toBeNull();
  });
});

describe('readCarryOverFeatureKeys — only what was ticked', () => {
  it('takes the ticked rows and nothing else', () => {
    const rows = [
      buildRow('DENP-1371 — Enhance IPM', 'Yes'),
      buildRow('DENP-1393 — H Plan Consolidation', ''),
      buildRow('DENP-1420 — ESI Scope', 'Yes'),
    ];

    expect(readCarryOverFeatureKeys(rows)).toEqual(['DENP-1371', 'DENP-1420']);
  });

  it('reads the key out of a "KEY — summary" cell', () => {
    expect(readCarryOverFeatureKeys([buildRow('DASP-925 — Something long', 'Yes')])).toEqual(['DASP-925']);
  });

  it('accepts a bare key with no summary', () => {
    expect(readCarryOverFeatureKeys([buildRow('DENP-1371', 'Yes')])).toEqual(['DENP-1371']);
  });

  it('matches the tick regardless of case', () => {
    expect(readCarryOverFeatureKeys([buildRow('DENP-1', 'YES')])).toEqual(['DENP-1']);
  });

  it('ignores a row whose Feature cell is not a key', () => {
    expect(readCarryOverFeatureKeys([buildRow('to be decided', 'Yes')])).toEqual([]);
  });

  it('reports each Feature once even if the page lists it twice', () => {
    expect(readCarryOverFeatureKeys([buildRow('DENP-1', 'Yes'), buildRow('DENP-1 — dup', 'Yes')]))
      .toEqual(['DENP-1']);
  });

  it('returns nothing for an empty page', () => {
    expect(readCarryOverFeatureKeys([])).toEqual([]);
  });
});

describe('describeCarryOverMarks — an empty result is not a failure', () => {
  it('names the Features it found', () => {
    expect(describeCarryOverMarks(['DENP-1371', 'DASP-925'], 'PI 26.4'))
      .toContain('2 Features ticked as Carry-Over');
  });

  it('says plainly when nothing is ticked, rather than looking broken', () => {
    expect(describeCarryOverMarks([], 'PI 26.4'))
      .toBe('No Features are ticked as Carry-Over on the PI 26.4 PI Review page.');
  });

  it('uses the singular for one', () => {
    expect(describeCarryOverMarks(['DENP-1371'], 'PI 26.4')).toContain('1 Feature ticked');
  });
});
