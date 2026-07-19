// businessDays.test.ts — Unit tests for the business-day window helpers.

import { describe, expect, it } from 'vitest';

import { businessDaysAgo, businessDaysElapsedSince, mostRecentBusinessDayKey, toJqlDateString } from './businessDays.ts';

describe('businessDaysAgo', () => {
  it('counts back business days, skipping the weekend (Wednesday minus 3)', () => {
    // Wed 2025-01-08 minus 3 business days → Fri 2025-01-03 (skips Sat 4th + Sun 5th).
    const wednesday = new Date('2025-01-08T10:30:00.000Z');
    const result = businessDaysAgo(3, wednesday);
    expect(toJqlDateString(result)).toBe('2025-01-03');
  });

  it('treats a Monday minus 1 business day as the previous Friday', () => {
    // Mon 2025-01-06 minus 1 business day → Fri 2025-01-03 (skips Sun + Sat).
    const monday = new Date('2025-01-06T09:00:00.000Z');
    const result = businessDaysAgo(1, monday);
    expect(toJqlDateString(result)).toBe('2025-01-03');
  });

  it('anchors the result to the start of the day so same-day comments are included', () => {
    const friday = new Date('2025-01-10T23:59:00.000Z');
    const result = businessDaysAgo(0, friday);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('counts back across multiple weekends (10 business days = two work weeks)', () => {
    // Fri 2025-01-17 minus 10 business days → Fri 2025-01-03.
    const friday = new Date('2025-01-17T12:00:00.000Z');
    const result = businessDaysAgo(10, friday);
    expect(toJqlDateString(result)).toBe('2025-01-03');
  });
});

describe('toJqlDateString', () => {
  it('formats a date as YYYY-MM-DD using local calendar parts', () => {
    const date = new Date(2025, 2, 9, 14, 0, 0); // 9 March 2025, local time
    expect(toJqlDateString(date)).toBe('2025-03-09');
  });
});

describe('businessDaysElapsedSince', () => {
  // All fixtures pin "now" explicitly and use UTC noon timestamps so the weekday classification is unambiguous.
  const MONDAY_13TH_NOON = Date.UTC(2026, 6, 13, 12); // Mon 2026-07-13

  it('counts a full Monday-to-Monday week as five business days', () => {
    expect(businessDaysElapsedSince('2026-07-06T12:00:00.000Z', MONDAY_13TH_NOON)).toBe(5);
  });

  it('does NOT count the weekend: Friday to Monday is one business day, not three', () => {
    expect(businessDaysElapsedSince('2026-07-10T12:00:00.000Z', MONDAY_13TH_NOON)).toBe(1);
  });

  it('counts Thursday to Monday as two business days (Fri + Mon, weekend skipped)', () => {
    expect(businessDaysElapsedSince('2026-07-09T12:00:00.000Z', MONDAY_13TH_NOON)).toBe(2);
  });

  it('returns 0 for a future timestamp and for a gap shorter than one whole day', () => {
    expect(businessDaysElapsedSince('2026-07-20T12:00:00.000Z', MONDAY_13TH_NOON)).toBe(0);
    expect(businessDaysElapsedSince('2026-07-13T01:00:00.000Z', Date.UTC(2026, 6, 13, 20))).toBe(0);
  });

  it('returns 0 for a missing or unparseable date rather than throwing', () => {
    expect(businessDaysElapsedSince('not-a-date', MONDAY_13TH_NOON)).toBe(0);
    expect(businessDaysElapsedSince('', MONDAY_13TH_NOON)).toBe(0);
  });
});

describe('mostRecentBusinessDayKey', () => {
  // Fixtures are built with local calendar parts (month index 5 = June) so the
  // weekday is unambiguous regardless of the test runner's timezone.
  it('returns the same date on a weekday (Tuesday)', () => {
    const tuesday = new Date(2026, 5, 30, 12, 0, 0); // Tue 2026-06-30
    expect(mostRecentBusinessDayKey(tuesday)).toBe('2026-06-30');
  });

  it('returns the preceding Friday on a Saturday', () => {
    const saturday = new Date(2026, 5, 27, 12, 0, 0); // Sat 2026-06-27
    expect(mostRecentBusinessDayKey(saturday)).toBe('2026-06-26');
  });

  it('returns the preceding Friday on a Sunday', () => {
    const sunday = new Date(2026, 5, 28, 12, 0, 0); // Sun 2026-06-28
    expect(mostRecentBusinessDayKey(sunday)).toBe('2026-06-26');
  });
});
