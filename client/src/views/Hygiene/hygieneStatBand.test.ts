// hygieneStatBand.test.ts — Four figures somebody acts on, instead of twenty they have to add up.

import { describe, expect, it } from 'vitest';

import { buildHygieneStatBand } from './hygieneStatBand.ts';
import type { HygieneFinding } from './checks/hygieneChecks.ts';

function finding(issueKey: string, flags: Array<[checkId: string, severity: 'error' | 'warn']>): HygieneFinding {
  return {
    issue: { key: issueKey, fields: { summary: issueKey } },
    flags: flags.map(([checkId, severity]) => ({ checkId, label: checkId, severity })),
  } as unknown as HygieneFinding;
}

describe('buildHygieneStatBand', () => {
  it('leads with the four figures in the order they are acted on', () => {
    const band = buildHygieneStatBand([], 0);

    expect(band.map((stat) => stat.id)).toEqual(['errors', 'warnings', 'fixable-dates', 'clean']);
  });

  it('counts issues, not flags', () => {
    // An issue is the thing somebody opens and fixes. Counting flags would overstate the work by
    // however many problems happen to share one ticket.
    const band = buildHygieneStatBand([finding('A-1', [['no-assignee', 'error'], ['no-ac', 'error']])], 10);

    expect(band[0].count).toBe(1);
  });

  it('counts an issue with both an error and a warning only as broken', () => {
    // Counting it twice would make the figures sum to more than the board, and the more serious
    // verdict is the one that decides what happens to the issue.
    const band = buildHygieneStatBand([finding('A-1', [['no-assignee', 'error'], ['missing-sp', 'warn']])], 10);

    expect(band[0].count).toBe(1);
    expect(band[1].count).toBe(0);
  });

  it('counts the issues a deterministic date write could clear', () => {
    const band = buildHygieneStatBand([
      finding('A-1', [['missing-target-start', 'warn']]),
      finding('A-2', [['dates-out-of-sync', 'warn']]),
      finding('A-3', [['missing-sp', 'warn']]),
    ], 10);

    expect(band[2].count).toBe(2);
  });

  it('does not count an overdue flag as fixable — rewriting that date hides a true statement', () => {
    const band = buildHygieneStatBand([finding('A-1', [['due-date-overdue', 'warn']])], 10);

    expect(band[2].count).toBe(0);
  });

  it('reports the rest of the scan as clean', () => {
    const band = buildHygieneStatBand([finding('A-1', [['missing-sp', 'warn']])], 31);

    expect(band[3].count).toBe(30);
  });

  it('never reports a negative clean count', () => {
    // A truncated scan can report fewer issues than it holds findings for, and a negative figure is
    // a nonsense the reader then has to work out how to discount.
    const band = buildHygieneStatBand([finding('A-1', [['missing-sp', 'warn']]), finding('A-2', [['no-ac', 'warn']])], 1);

    expect(band[3].count).toBe(0);
  });

  it('is all zeroes for a scan that found nothing to flag', () => {
    expect(buildHygieneStatBand([], 0).every((stat) => stat.count === 0)).toBe(true);
  });
});
