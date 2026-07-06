// piSchedule.test.ts — Verifies parsing the PI date range from its name and days-remaining math.

import { describe, expect, it } from 'vitest';

import { daysRemainingInPi, parsePiDateRange, timeElapsedFraction } from './piSchedule.ts';

describe('timeElapsedFraction', () => {
  it('returns the clamped fraction of the window elapsed', () => {
    // 05/21 → 07/29 is 69 days; 07/06 is 46 days in → ~0.667.
    const fraction = timeElapsedFraction('2026-05-21', '2026-07-29', '2026-07-06');
    expect(fraction).toBeCloseTo(46 / 69, 2);
  });

  it('clamps before the start (0) and after the end (1)', () => {
    expect(timeElapsedFraction('2026-05-21', '2026-07-29', '2026-05-01')).toBe(0);
    expect(timeElapsedFraction('2026-05-21', '2026-07-29', '2026-08-15')).toBe(1);
  });

  it('is null for an unparseable or non-positive window', () => {
    expect(timeElapsedFraction('bad', '2026-07-29', '2026-07-06')).toBeNull();
    expect(timeElapsedFraction('2026-07-29', '2026-05-21', '2026-07-06')).toBeNull();
  });
});

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
