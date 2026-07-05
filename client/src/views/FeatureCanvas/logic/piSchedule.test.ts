// piSchedule.test.ts — Verifies parsing the PI date range from its name and days-remaining math.

import { describe, expect, it } from 'vitest';

import { daysRemainingInPi, parsePiDateRange } from './piSchedule.ts';

describe('parsePiDateRange', () => {
  it('parses a MM/DD/YY range embedded in the PI name', () => {
    expect(parsePiDateRange('PI 26.3 (05/21/26 - 07/29/26)')).toEqual({ startIso: '2026-05-21', endIso: '2026-07-29' });
  });

  it('tolerates an en-dash and single-digit months/days', () => {
    expect(parsePiDateRange('PI 27.1 (1/6/27–3/9/27)')).toEqual({ startIso: '2027-01-06', endIso: '2027-03-09' });
  });

  it('returns null when the name has no date range', () => {
    expect(parsePiDateRange('PI 26.3')).toBeNull();
  });
});

describe('daysRemainingInPi', () => {
  it('counts whole days to the PI end date', () => {
    expect(daysRemainingInPi('PI 26.3 (05/21/26 - 07/29/26)', '2026-07-05')).toBe(24);
  });

  it('is negative once the PI has ended', () => {
    expect(daysRemainingInPi('PI 26.3 (05/21/26 - 07/29/26)', '2026-08-01')).toBe(-3);
  });

  it('returns null when the PI name has no parseable range', () => {
    expect(daysRemainingInPi('PI 26.3', '2026-07-05')).toBeNull();
  });
});
