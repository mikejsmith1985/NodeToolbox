// cycleTime.test.ts — Unit coverage for simplified Metrics cycle-time helpers.

import { describe, expect, it } from 'vitest';

import { computeStats, daysBetween } from './cycleTime.ts';

describe('daysBetween', () => {
  it('floors partial days so same-day work reports as zero whole days', () => {
    expect(daysBetween('2024-01-01T08:00:00.000Z', '2024-01-01T20:00:00.000Z')).toBe(0);
  });

  it('returns whole elapsed days between Jira timestamps', () => {
    expect(daysBetween('2024-01-01T08:00:00.000Z', '2024-01-03T20:00:00.000Z')).toBe(2);
  });

  it('returns zero for invalid dates', () => {
    expect(daysBetween('not-a-date', '2024-01-03T20:00:00.000Z')).toBe(0);
  });
});

describe('computeStats', () => {
  it('returns zeroed stats for an empty sample', () => {
    expect(computeStats([])).toEqual({ sampleCount: 0, meanDays: 0, medianDays: 0, p90Days: 0 });
  });

  it('computes odd-count median, mean, and p90', () => {
    expect(computeStats([7, 1, 3])).toEqual({ sampleCount: 3, meanDays: 3.7, medianDays: 3, p90Days: 7 });
  });

  it('computes even-count median as the midpoint average', () => {
    expect(computeStats([1, 10, 3, 5])).toEqual({ sampleCount: 4, meanDays: 4.8, medianDays: 4, p90Days: 10 });
  });

  it('uses nearest-rank p90 at the upper boundary', () => {
    expect(computeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).p90Days).toBe(9);
  });

  it('ignores non-finite samples before computing stats', () => {
    expect(computeStats([1, Number.NaN, 5])).toEqual({ sampleCount: 2, meanDays: 3, medianDays: 3, p90Days: 5 });
  });
});
