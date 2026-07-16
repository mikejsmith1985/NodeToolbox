// monthlyDeliveryScheduler.test.js — Unit tests for the Monthly Delivery Report scheduler:
// pure date math (2nd Tuesday, covered month, window), the once-per-month guard, and the DI tick.

'use strict';

const {
  computeSecondTuesdayDate,
  resolveCoveredMonth,
  buildCoveredMonthWindow,
  hasAlreadyFiredThisMonth,
} = require('./monthlyDeliveryScheduler');

describe('computeSecondTuesdayDate', () => {
  it('finds the 2nd Tuesday when the month starts mid-week', () => {
    // July 2026 starts on a Wednesday: Tuesdays fall on the 7th and 14th.
    expect(computeSecondTuesdayDate(2026, 6)).toBe('2026-07-14');
  });

  it('finds the 2nd Tuesday when the 1st IS a Tuesday (earliest possible: the 8th)', () => {
    // September 2026 starts on a Tuesday: the second Tuesday is the 8th.
    expect(computeSecondTuesdayDate(2026, 8)).toBe('2026-09-08');
  });

  it('finds the 2nd Tuesday when the month starts on a Wednesday (latest possible: the 14th)', () => {
    // April 2026 starts on a Wednesday: Tuesdays fall on the 7th and 14th.
    expect(computeSecondTuesdayDate(2026, 3)).toBe('2026-04-14');
  });
});

describe('resolveCoveredMonth', () => {
  it('covers the calendar month before the given day', () => {
    expect(resolveCoveredMonth('2026-07-16')).toBe('2026-06');
  });

  it('rolls the year back when the run happens in January', () => {
    expect(resolveCoveredMonth('2026-01-05')).toBe('2025-12');
  });
});

describe('buildCoveredMonthWindow', () => {
  it('spans the first local instant of the month to the last instant of its final day', () => {
    const juneWindow = buildCoveredMonthWindow('2026-06');
    expect(juneWindow.firstDayDate).toBe('2026-06-01');
    expect(juneWindow.lastDayDate).toBe('2026-06-30');
    expect(juneWindow.startMs).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime());
    expect(juneWindow.endMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime() - 1);
  });

  it('handles leap-year February', () => {
    const leapFebruaryWindow = buildCoveredMonthWindow('2024-02');
    expect(leapFebruaryWindow.lastDayDate).toBe('2024-02-29');
  });

  it('handles December → January rollover at the window end', () => {
    const decemberWindow = buildCoveredMonthWindow('2025-12');
    expect(decemberWindow.lastDayDate).toBe('2025-12-31');
    expect(decemberWindow.endMs).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime() - 1);
  });
});

describe('hasAlreadyFiredThisMonth', () => {
  it('treats any fired date within the current calendar month as already fired', () => {
    expect(hasAlreadyFiredThisMonth('2026-07-14', '2026-07-16')).toBe(true);
    expect(hasAlreadyFiredThisMonth('2026-07-16', '2026-07-16')).toBe(true);
  });

  it('does not count a fired date from an earlier month (or no fired date at all)', () => {
    expect(hasAlreadyFiredThisMonth('2026-06-10', '2026-07-16')).toBe(false);
    expect(hasAlreadyFiredThisMonth(undefined, '2026-07-16')).toBe(false);
    expect(hasAlreadyFiredThisMonth('', '2026-07-16')).toBe(false);
  });
});
