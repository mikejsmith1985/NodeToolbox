// businessDays.test.ts — Unit tests for the business-day window helpers.

import { describe, expect, it } from 'vitest';

import { businessDaysAgo, toJqlDateString } from './businessDays.ts';

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
