// dateTimeParts.test.ts — Proves a planned date-time splits into day/hour/minute and joins back in the stored shape.

import { describe, expect, it } from 'vitest';

import { joinDateTime, listHourOptions, listMinuteOptions, splitDateTime } from './dateTimeParts.ts';

describe('dateTimeParts', () => {
  it('splits a stored value and joins it back unchanged', () => {
    const parts = splitDateTime('2026-10-20T08:30');
    expect(parts).toEqual({ day: '2026-10-20', hour: '08', minute: '30' });
    expect(joinDateTime(parts)).toBe('2026-10-20T08:30');
  });

  it('gives empty parts for an empty or unreadable value', () => {
    expect(splitDateTime('')).toEqual({ day: '', hour: '', minute: '' });
  });

  it('stays empty until a day and an hour are chosen, and defaults minutes to 00', () => {
    expect(joinDateTime({ day: '2026-10-20', hour: '', minute: '' })).toBe('');
    expect(joinDateTime({ day: '2026-10-20', hour: '22', minute: '' })).toBe('2026-10-20T22:00');
  });

  it('offers 24 hours with a plain 12-hour reading', () => {
    const hourOptions = listHourOptions();
    expect(hourOptions).toHaveLength(24);
    expect(hourOptions[0]).toEqual({ value: '00', label: '00 — 12 AM' });
    expect(hourOptions[13]).toEqual({ value: '13', label: '13 — 1 PM' });
  });

  it('offers quarter hours, keeping an odd saved minute so it is never lost', () => {
    expect(listMinuteOptions('')).toEqual(['00', '15', '30', '45']);
    expect(listMinuteOptions('07')).toEqual(['00', '07', '15', '30', '45']);
  });
});
