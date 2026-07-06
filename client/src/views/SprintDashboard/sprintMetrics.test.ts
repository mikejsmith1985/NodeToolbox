// sprintMetrics.test.ts — Verifies schedule-aware health and running-average velocity.

import { describe, expect, it } from 'vitest';

import { assessBoardHealth, computeAverageVelocity } from './sprintMetrics.ts';

describe('assessBoardHealth', () => {
  it('is NOT on track when point progress lags the window elapsed (the "false green" bug)', () => {
    // 67/210 points = 32% done, 67% of the PI elapsed, 0 blocked → clearly behind.
    expect(assessBoardHealth({ pointsDone: 67, pointsTotal: 210, timeElapsedFraction: 0.67, blockedCount: 0 })).toBe('at-risk');
  });

  it('is on track when point progress keeps pace with the window', () => {
    expect(assessBoardHealth({ pointsDone: 100, pointsTotal: 200, timeElapsedFraction: 0.5, blockedCount: 0 })).toBe('on-track');
  });

  it('drops a slightly-behind board to watch', () => {
    // 40% done at 60% elapsed → 0.20 gap → watch.
    expect(assessBoardHealth({ pointsDone: 40, pointsTotal: 100, timeElapsedFraction: 0.6, blockedCount: 0 })).toBe('watch');
  });

  it('several blockers force at-risk regardless of schedule', () => {
    expect(assessBoardHealth({ pointsDone: 100, pointsTotal: 100, timeElapsedFraction: 0.1, blockedCount: 3 })).toBe('at-risk');
  });

  it('keeps an on-pace board with a single blocker at watch, not clean on-track', () => {
    expect(assessBoardHealth({ pointsDone: 100, pointsTotal: 200, timeElapsedFraction: 0.5, blockedCount: 1 })).toBe('watch');
  });

  it('falls back to the blocker-only signal when no date window is known', () => {
    expect(assessBoardHealth({ pointsDone: 0, pointsTotal: 0, timeElapsedFraction: null, blockedCount: 0 })).toBe('on-track');
    expect(assessBoardHealth({ pointsDone: 0, pointsTotal: 0, timeElapsedFraction: null, blockedCount: 1 })).toBe('watch');
  });
});

describe('computeAverageVelocity', () => {
  it('averages completed points per sprint (rounded)', () => {
    expect(computeAverageVelocity([{ completedPoints: 30 }, { completedPoints: 40 }, { completedPoints: 35 }])).toBe(35);
  });

  it('is 0 with no sprints', () => {
    expect(computeAverageVelocity([])).toBe(0);
  });
});
