// effortModel.test.ts — How much work is LEFT, which is a different question from how big it was.
//
// Two decisions carry the weight here and both are easy to get wrong in a way that looks fine:
//
//   • Charging an almost-finished story at full size makes every board look permanently over
//     capacity, and the fix — "remove scope" — would be aimed at work that is nearly done.
//   • Rounding the last fraction of a story down to zero makes the forecast promise free work, and
//     a release then "fits" when it does not.

import { describe, expect, it } from 'vitest';

import { computeRemainingEffort } from './effortModel.ts';

/** A five-rung board, so a column index maps to an obvious fraction. */
const FIVE_COLUMNS = ['col-1', 'col-2', 'col-3', 'col-4', 'col-5'];

describe('computeRemainingEffort', () => {
  it('charges an untouched story its full size', () => {
    const effort = computeRemainingEffort(5, 'col-1', FIVE_COLUMNS, false, 1);
    expect(effort.columnCredit).toBe(0);
    expect(effort.remainingPoints).toBe(5);
    expect(effort.remainingWorkingDays).toBe(5);
    expect(effort.isEstimated).toBe(true);
  });

  it('charges a half-finished story half its size, rounded up to whole days', () => {
    // The middle of five columns is half of the team's own workflow, so 5 points has 2.5 left —
    // which is three days of somebody's time, not two.
    const effort = computeRemainingEffort(5, 'col-3', FIVE_COLUMNS, false, 1);
    expect(effort.columnCredit).toBe(0.5);
    expect(effort.remainingPoints).toBe(2.5);
    expect(effort.remainingWorkingDays).toBe(3);
  });

  it('charges a finished story nothing', () => {
    const effort = computeRemainingEffort(5, 'col-1', FIVE_COLUMNS, true, 1);
    expect(effort.columnCredit).toBe(1);
    expect(effort.remainingPoints).toBe(0);
    expect(effort.remainingWorkingDays).toBe(0);
  });

  it('never rounds an unfinished story down to no work at all', () => {
    // 96% of the way through still leaves somebody a day. Rounding it to zero is how a forecast
    // comes to promise free work, and a release then fits when it does not.
    const nearlyDoneColumns = Array.from({ length: 26 }, (_, index) => `col-${index + 1}`);
    const effort = computeRemainingEffort(5, 'col-25', nearlyDoneColumns, false, 1);
    expect(effort.remainingWorkingDays).toBe(1);
  });

  it('says an unestimated issue is unestimated rather than guessing a size', () => {
    const effort = computeRemainingEffort(null, 'col-1', FIVE_COLUMNS, false, 1);
    expect(effort.isEstimated).toBe(false);
    expect(effort.remainingPoints).toBeNull();
    expect(effort.remainingWorkingDays).toBeNull();
  });

  it('treats an estimate of zero as a measurement, not an absence', () => {
    // Somebody deliberately sized this at nothing. That is a different fact from nobody sizing it,
    // and merging the two would hide one of them.
    const effort = computeRemainingEffort(0, 'col-1', FIVE_COLUMNS, false, 1);
    expect(effort.isEstimated).toBe(true);
    expect(effort.remainingWorkingDays).toBe(0);
  });

  it('honours a rate other than one point a day', () => {
    const effort = computeRemainingEffort(8, 'col-1', FIVE_COLUMNS, false, 2);
    expect(effort.remainingWorkingDays).toBe(4);
  });

  it('charges full size for a column the team does not have', () => {
    // Unmapped work has not demonstrably moved anywhere, so it earns nothing rather than a guess.
    const effort = computeRemainingEffort(5, '__unmapped__', FIVE_COLUMNS, false, 1);
    expect(effort.columnCredit).toBe(0);
    expect(effort.remainingWorkingDays).toBe(5);
  });

  it('charges full size when no column order is available at all', () => {
    const effort = computeRemainingEffort(5, 'col-1', [], false, 1);
    expect(effort.columnCredit).toBe(0);
    expect(effort.remainingWorkingDays).toBe(5);
  });

  it('charges full size when the board has a single column, which says nothing about progress', () => {
    const effort = computeRemainingEffort(5, 'col-1', ['col-1'], false, 1);
    expect(effort.columnCredit).toBe(0);
  });

  it('always states its workings, so a disputed figure can be checked', () => {
    const cases = [
      computeRemainingEffort(5, 'col-3', FIVE_COLUMNS, false, 1),
      computeRemainingEffort(null, 'col-1', FIVE_COLUMNS, false, 1),
      computeRemainingEffort(5, 'col-1', FIVE_COLUMNS, true, 1),
    ];
    cases.forEach((effort) => expect(effort.basis.length).toBeGreaterThan(0));
  });

  it('names the estimate and the credit in the workings', () => {
    const effort = computeRemainingEffort(5, 'col-3', FIVE_COLUMNS, false, 1);
    expect(effort.basis).toContain('5');
    expect(effort.basis).toContain('50%');
  });

  it('falls back to one point a day rather than dividing by a rate it cannot use', () => {
    // The config layer refuses a rate of zero, but this module is pure and callable directly, so
    // it guards its own divisor rather than trusting every future caller.
    const effort = computeRemainingEffort(4, 'col-1', FIVE_COLUMNS, false, 0);
    expect(effort.remainingWorkingDays).toBe(4);
  });
});
