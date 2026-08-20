// workingDays.test.ts — Pins the calendar arithmetic every delivery date in this app is built on.
//
// The relocated four are already covered by piPlanDates.test.ts, which must keep passing unmodified;
// what is tested HERE is that they still behave the same from their new home, plus the one genuinely
// new primitive: stepping BACKWARDS. Nothing needed that direction until a deadline had to be turned
// into a latest start date.

import { describe, expect, it } from 'vitest';

import {
  addWorkingDays,
  isWorkingDay,
  rollToWorkingDay,
  subtractWorkingDays,
  workingDaysBetween,
  type WorkingCalendar,
} from './workingDays.ts';

/** Weekends off, no holidays — the calendar every existing caller passes today. */
const PLAIN_CALENDAR: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] };

/** The same week with Thursday 2026-08-20 taken out, to prove holidays are honoured both ways. */
const HOLIDAY_CALENDAR: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: ['2026-08-20'] };

describe('isWorkingDay', () => {
  it('accepts a weekday', () => {
    // 2026-08-20 is a Thursday.
    expect(isWorkingDay('2026-08-20', PLAIN_CALENDAR)).toBe(true);
  });

  it('rejects a Saturday and a Sunday', () => {
    expect(isWorkingDay('2026-08-22', PLAIN_CALENDAR)).toBe(false);
    expect(isWorkingDay('2026-08-23', PLAIN_CALENDAR)).toBe(false);
  });

  it('rejects a listed holiday even though it is a weekday', () => {
    expect(isWorkingDay('2026-08-20', HOLIDAY_CALENDAR)).toBe(false);
  });

  it('reads only the leading day, so a Jira datetime does not shift the answer', () => {
    // A date field returned as a UTC-midnight datetime names the day on its face, not an instant.
    expect(isWorkingDay('2026-08-20T00:00:00.000+0000', PLAIN_CALENDAR)).toBe(true);
  });
});

describe('rollToWorkingDay', () => {
  it('leaves a working day alone', () => {
    expect(rollToWorkingDay('2026-08-20', PLAIN_CALENDAR)).toBe('2026-08-20');
  });

  it('advances a Saturday to the following Monday', () => {
    expect(rollToWorkingDay('2026-08-22', PLAIN_CALENDAR)).toBe('2026-08-24');
  });

  it('advances past a holiday', () => {
    expect(rollToWorkingDay('2026-08-20', HOLIDAY_CALENDAR)).toBe('2026-08-21');
  });
});

describe('addWorkingDays', () => {
  it('returns the same day for a count of zero', () => {
    expect(addWorkingDays('2026-08-20', 0, PLAIN_CALENDAR)).toBe('2026-08-20');
  });

  it('steps over a weekend', () => {
    // Friday + 1 working day is Monday.
    expect(addWorkingDays('2026-08-21', 1, PLAIN_CALENDAR)).toBe('2026-08-24');
  });

  it('skips a holiday', () => {
    // Wednesday + 1 lands on Friday when Thursday is a holiday.
    expect(addWorkingDays('2026-08-19', 1, HOLIDAY_CALENDAR)).toBe('2026-08-21');
  });
});

describe('workingDaysBetween', () => {
  it('counts the half-open interval, so the start day itself is never counted', () => {
    expect(workingDaysBetween('2026-08-20', '2026-08-21', PLAIN_CALENDAR)).toBe(1);
  });

  it('excludes the weekend inside a span', () => {
    // Thursday to the following Thursday is 7 calendar days but 5 working ones.
    expect(workingDaysBetween('2026-08-20', '2026-08-27', PLAIN_CALENDAR)).toBe(5);
  });

  it('returns zero when the end is not after the start', () => {
    expect(workingDaysBetween('2026-08-20', '2026-08-20', PLAIN_CALENDAR)).toBe(0);
    expect(workingDaysBetween('2026-08-21', '2026-08-20', PLAIN_CALENDAR)).toBe(0);
  });
});

describe('subtractWorkingDays', () => {
  it('steps back one weekday', () => {
    expect(subtractWorkingDays('2026-08-21', 1, PLAIN_CALENDAR)).toBe('2026-08-20');
  });

  it('steps back over a weekend', () => {
    // Monday - 1 working day is the previous Friday.
    expect(subtractWorkingDays('2026-08-24', 1, PLAIN_CALENDAR)).toBe('2026-08-21');
  });

  it('steps back a full working week', () => {
    expect(subtractWorkingDays('2026-08-24', 5, PLAIN_CALENDAR)).toBe('2026-08-17');
  });

  it('returns the same day for a count of zero', () => {
    expect(subtractWorkingDays('2026-08-20', 0, PLAIN_CALENDAR)).toBe('2026-08-20');
  });

  it('returns the same day for a negative count, mirroring addWorkingDays', () => {
    expect(subtractWorkingDays('2026-08-20', -3, PLAIN_CALENDAR)).toBe('2026-08-20');
  });

  it('steps back past a holiday', () => {
    // Friday - 1 lands on Wednesday when Thursday is a holiday.
    expect(subtractWorkingDays('2026-08-21', 1, HOLIDAY_CALENDAR)).toBe('2026-08-19');
  });

  it('round-trips with addWorkingDays from any working day', () => {
    // The two must be exact inverses, or a latest-start date and a completion date computed from
    // the same effort would land on different days and neither would be wrong-looking.
    const startIso = '2026-08-20';
    for (let dayCount = 1; dayCount <= 10; dayCount += 1) {
      const forward = addWorkingDays(startIso, dayCount, PLAIN_CALENDAR);
      expect(subtractWorkingDays(forward, dayCount, PLAIN_CALENDAR)).toBe(startIso);
    }
  });

  it('reads only the leading day of a longer ISO value', () => {
    expect(subtractWorkingDays('2026-08-21T12:00:00.000Z', 1, PLAIN_CALENDAR)).toBe('2026-08-20');
  });
});
