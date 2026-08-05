// kanbanFlow.test.ts — Unit tests for the Kanban flow metrics: weekly throughput bucketing and
// the cycle-time-consistency reading that stands in for sprint predictability on Kanban boards.

import { describe, expect, it } from 'vitest';

import { computeWeeklyThroughput, describeFlowPredictability } from './kanbanFlow.ts';

const FIXED_NOW_ISO = '2026-08-05T12:00:00.000Z';

describe('computeWeeklyThroughput', () => {
  it('buckets resolution dates into rolling 7-day weeks, oldest first', () => {
    const resolutionDates = [
      '2026-08-05T09:00:00.000Z', // today → newest bucket
      '2026-08-01T09:00:00.000Z', // 4 days ago → newest bucket
      '2026-07-27T09:00:00.000Z', // 9 days ago → second bucket
      '2026-07-16T09:00:00.000Z', // 20 days ago → third bucket
    ];

    const weeklyPoints = computeWeeklyThroughput(resolutionDates, 4, FIXED_NOW_ISO);

    expect(weeklyPoints).toHaveLength(4);
    expect(weeklyPoints.map((point) => point.completedIssues)).toEqual([0, 1, 1, 2]);
    // Buckets are ordered oldest → newest so charts read left to right.
    expect(weeklyPoints[0].weekStartIso < weeklyPoints[3].weekStartIso).toBe(true);
  });

  it('ignores resolutions outside the requested window and unparseable dates', () => {
    const resolutionDates = [
      '2026-05-01T00:00:00.000Z', // far outside a 2-week window
      'not-a-date',
      '2026-08-04T00:00:00.000Z',
    ];

    const weeklyPoints = computeWeeklyThroughput(resolutionDates, 2, FIXED_NOW_ISO);

    expect(weeklyPoints).toHaveLength(2);
    expect(weeklyPoints.map((point) => point.completedIssues)).toEqual([0, 1]);
  });

  it('returns an all-zero series when nothing resolved in the window', () => {
    const weeklyPoints = computeWeeklyThroughput([], 3, FIXED_NOW_ISO);

    expect(weeklyPoints.map((point) => point.completedIssues)).toEqual([0, 0, 0]);
  });
});

describe('describeFlowPredictability', () => {
  it('rates a tight p90-to-median spread as steady', () => {
    const reading = describeFlowPredictability({ sampleCount: 20, meanDays: 3, medianDays: 3, p90Days: 5 });

    expect(reading.ratingLabel).toBe('Steady');
    expect(reading.p90OverMedianRatio).toBeCloseTo(5 / 3, 5);
  });

  it('rates a moderate spread as variable', () => {
    const reading = describeFlowPredictability({ sampleCount: 20, meanDays: 4, medianDays: 2, p90Days: 7 });

    expect(reading.ratingLabel).toBe('Variable');
  });

  it('rates a wide spread as erratic', () => {
    const reading = describeFlowPredictability({ sampleCount: 20, meanDays: 6, medianDays: 2, p90Days: 12 });

    expect(reading.ratingLabel).toBe('Erratic');
  });

  it('treats a zero median (same-day completions) without dividing by zero', () => {
    const reading = describeFlowPredictability({ sampleCount: 10, meanDays: 0.4, medianDays: 0, p90Days: 1 });

    expect(Number.isFinite(reading.p90OverMedianRatio)).toBe(true);
    expect(reading.ratingLabel).toBe('Steady');
  });
});
