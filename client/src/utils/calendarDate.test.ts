// calendarDate.test.ts — Pins the one answer to "is this Jira date today or already past?".
//
// The point of the module under test is that two surfaces cannot answer differently, so the tests
// are written as properties rather than as a list of examples: the boundary is asserted relative to
// the viewer's OWN calendar day, which makes them true in any timezone the suite happens to run in.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isOnOrBeforeToday, readCalendarDay, toCalendarDay } from './calendarDate.ts';

/** The calendar day `now` falls on for the viewer — derived the same way a person reading a clock would. */
function localDayOf(instant: Date): string {
  return [
    String(instant.getFullYear()),
    String(instant.getMonth() + 1).padStart(2, '0'),
    String(instant.getDate()).padStart(2, '0'),
  ].join('-');
}

function dayOffsetFromToday(dayCount: number): string {
  return localDayOf(new Date(Date.now() + dayCount * 86_400_000));
}

describe('readCalendarDay', () => {
  it('takes a Jira date-only string at face value — it names a day, not an instant', () => {
    // Parsing "2026-07-16" as a moment makes it UTC midnight, which is the previous day for anyone
    // west of Greenwich. Jira means the sixteenth; so does this.
    expect(readCalendarDay('2026-07-16')).toBe('2026-07-16');
    expect(readCalendarDay('  2026-07-16  ')).toBe('2026-07-16');
  });

  it('reduces a datetime to the calendar day it falls on for the viewer', () => {
    const instant = new Date('2026-07-16T15:30:00.000Z');
    expect(readCalendarDay(instant.toISOString())).toBe(localDayOf(instant));
  });

  it('returns null for anything that does not name a day', () => {
    [null, undefined, '', '   ', 'not a date', 42, {}].forEach((value) => {
      expect(readCalendarDay(value)).toBeNull();
    });
  });
});

describe('isOnOrBeforeToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Late evening local time, which in any timezone west of Greenwich is ALREADY TOMORROW in UTC.
    // This is the instant at which the old comparators disagreed with each other.
    vi.setSystemTime(new Date('2026-07-16T03:30:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts today as due', () => {
    expect(isOnOrBeforeToday(dayOffsetFromToday(0))).toBe(true);
  });

  it('counts yesterday as past', () => {
    expect(isOnOrBeforeToday(dayOffsetFromToday(-1))).toBe(true);
  });

  it('does NOT count tomorrow, even when UTC has already rolled over to it', () => {
    expect(isOnOrBeforeToday(dayOffsetFromToday(1))).toBe(false);
  });

  it('treats an unreadable or absent date as not-past rather than guessing', () => {
    expect(isOnOrBeforeToday(null)).toBe(false);
    expect(isOnOrBeforeToday('whenever')).toBe(false);
  });

  it('accepts an injected clock so a caller can evaluate against its own instant', () => {
    const fixedNow = new Date('2026-03-05T12:00:00.000Z').getTime();
    expect(isOnOrBeforeToday(toCalendarDay(new Date(fixedNow)), fixedNow)).toBe(true);
    expect(isOnOrBeforeToday(toCalendarDay(new Date(fixedNow + 86_400_000)), fixedNow)).toBe(false);
  });
});
