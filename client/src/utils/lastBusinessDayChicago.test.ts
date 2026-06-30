// lastBusinessDayChicago.test.ts — Verifies the shared "last business day 5 PM (Chicago)" cutoff.
//
// The cutoff drives both the DSU "New" section and the Today dashboard's untriaged card, so its
// weekend/Monday rollback must be exact. We freeze the system clock to known instants (noon
// Chicago, so the UTC date and the Chicago date agree) and assert the formatted cutoff.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatLastBusinessDayEndChicago } from './lastBusinessDayChicago.ts';

// 18:00 UTC in January is 12:00 CST (UTC-6), so the Chicago calendar day equals the UTC day.
const TUESDAY_NOON_UTC = new Date('2025-01-07T18:00:00Z'); // Tue Jan 7 2025
const MONDAY_NOON_UTC = new Date('2025-01-06T18:00:00Z'); // Mon Jan 6 2025
const SATURDAY_NOON_UTC = new Date('2025-01-11T18:00:00Z'); // Sat Jan 11 2025
const SUNDAY_NOON_UTC = new Date('2025-01-12T18:00:00Z'); // Sun Jan 12 2025

describe('formatLastBusinessDayEndChicago', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the previous calendar day at 17:00 on a normal weekday', () => {
    vi.setSystemTime(TUESDAY_NOON_UTC);
    expect(formatLastBusinessDayEndChicago()).toBe('2025/01/06 17:00');
  });

  it('rolls back to the prior Friday on a Monday', () => {
    vi.setSystemTime(MONDAY_NOON_UTC);
    expect(formatLastBusinessDayEndChicago()).toBe('2025/01/03 17:00');
  });

  it('rolls back to the prior Friday on a Saturday', () => {
    vi.setSystemTime(SATURDAY_NOON_UTC);
    expect(formatLastBusinessDayEndChicago()).toBe('2025/01/10 17:00');
  });

  it('rolls back to the prior Friday on a Sunday', () => {
    vi.setSystemTime(SUNDAY_NOON_UTC);
    expect(formatLastBusinessDayEndChicago()).toBe('2025/01/10 17:00');
  });
});
