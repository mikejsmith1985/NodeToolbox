// releaseTitle.test.ts — Release document page titles: the release date as YYYYMMMDD (GH #395).

import { describe, expect, it } from 'vitest';

import { formatReleasePageTitle } from './releaseTitle.ts';

describe('formatReleasePageTitle', () => {
  it('uses the version\'s release date', () => {
    expect(formatReleasePageTitle({ releaseDate: '2026-10-14', name: 'Anything' })).toBe('2026Oct14');
  });

  it('falls back to a name written as MM/DD/YYYY', () => {
    expect(formatReleasePageTitle({ releaseDate: null, name: '10/14/2026' })).toBe('2026Oct14');
    expect(formatReleasePageTitle({ releaseDate: null, name: '9/3/2026' })).toBe('2026Sep03');
  });

  it('returns null when neither gives a date, so the release is reported instead of published', () => {
    expect(formatReleasePageTitle({ releaseDate: null, name: 'Q4 hardening' })).toBeNull();
    expect(formatReleasePageTitle({ releaseDate: '', name: '13/45/2026' })).toBeNull();
  });

  it('spells every month with its three-letter name', () => {
    const titles = Array.from({ length: 12 }, (_, monthIndex) =>
      formatReleasePageTitle({ releaseDate: `2026-${String(monthIndex + 1).padStart(2, '0')}-01`, name: '' }));

    expect(titles).toEqual([
      '2026Jan01', '2026Feb01', '2026Mar01', '2026Apr01', '2026May01', '2026Jun01',
      '2026Jul01', '2026Aug01', '2026Sep01', '2026Oct01', '2026Nov01', '2026Dec01',
    ]);
  });
});
