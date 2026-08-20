// releaseDateResolve.test.ts — Reading a release date out of a version NAME, and saying so.
//
// The convention is that a fix version's name carries its release date. Not every version has the
// date field filled in, and without the name as a fallback those releases drop silently out of the
// forecast — which reads as "nothing to forecast" rather than "the date is missing".
//
// The rejections matter as much as the matches: a name that yields a plausible-but-wrong date would
// forecast a whole release against a deadline nobody set.

import { describe, expect, it } from 'vitest';

import { parseReleaseDateFromName, resolveReleaseDate, resolveReleaseDates } from './releaseDateResolve.ts';

describe('parseReleaseDateFromName', () => {
  it('reads a four-digit-year date with padded parts', () => {
    expect(parseReleaseDateFromName('Release 08/20/2026').dateIso).toBe('2026-08-20');
  });

  it('reads single-digit month and day', () => {
    expect(parseReleaseDateFromName('Release 8/20/2026').dateIso).toBe('2026-08-20');
  });

  it('reads a two-digit year', () => {
    expect(parseReleaseDateFromName('Release 8/20/26').dateIso).toBe('2026-08-20');
    expect(parseReleaseDateFromName('Release 08/20/26').dateIso).toBe('2026-08-20');
  });

  it('finds the date anywhere in the name', () => {
    expect(parseReleaseDateFromName('R1 12/1/26 hotfix').dateIso).toBe('2026-12-01');
  });

  it('reads a two-digit year of 80 or above as last century', () => {
    expect(parseReleaseDateFromName('Legacy 3/15/95').dateIso).toBe('1995-03-15');
    expect(parseReleaseDateFromName('Edge 1/1/80').dateIso).toBe('1980-01-01');
  });

  it('reads a two-digit year below 80 as this century', () => {
    expect(parseReleaseDateFromName('Edge 1/1/79').dateIso).toBe('2079-01-01');
  });

  it('refuses an ISO-looking name, because its parts are not month/day/year', () => {
    // Accepting '-' would read 2026-08-20 as month 2026. Refusing it sends the version to its
    // release-date field instead, which an ISO-named version almost certainly has.
    expect(parseReleaseDateFromName('Release 2026-08-20').dateIso).toBeNull();
  });

  it('refuses a value that is not a day the calendar has', () => {
    expect(parseReleaseDateFromName('Release 13/45/2026').dateIso).toBeNull();
    expect(parseReleaseDateFromName('Release 2/30/2026').dateIso).toBeNull();
  });

  it('honours leap years in both directions', () => {
    expect(parseReleaseDateFromName('Release 2/29/2024').dateIso).toBe('2024-02-29');
    expect(parseReleaseDateFromName('Release 2/29/2026').dateIso).toBeNull();
  });

  it('finds nothing in a name that carries no date', () => {
    expect(parseReleaseDateFromName('Sprint 5').dateIso).toBeNull();
    expect(parseReleaseDateFromName('').dateIso).toBeNull();
  });

  it('takes the first of two dates and says the name was ambiguous', () => {
    const parsed = parseReleaseDateFromName('Merge 1/2/26 into 3/4/26');
    expect(parsed.dateIso).toBe('2026-01-02');
    expect(parsed.isAmbiguous).toBe(true);
  });

  it('does not report ambiguity when there is only one date', () => {
    expect(parseReleaseDateFromName('Release 8/20/26').isAmbiguous).toBe(false);
  });

  it('refuses a run of digits that merely contains slashes', () => {
    expect(parseReleaseDateFromName('Build 1234/5/6789').dateIso).toBeNull();
  });
});

describe('resolveReleaseDate', () => {
  it('uses the field when only the field has a date', () => {
    const resolution = resolveReleaseDate({ name: 'Sprint 5', releaseDate: '2026-08-20' });
    expect(resolution.resolvedDateIso).toBe('2026-08-20');
    expect(resolution.source).toBe('field');
    expect(resolution.hasDisagreement).toBe(false);
  });

  it('uses the name when the field is empty', () => {
    const resolution = resolveReleaseDate({ name: 'Release 08/20/2026' });
    expect(resolution.resolvedDateIso).toBe('2026-08-20');
    expect(resolution.source).toBe('name');
  });

  it('lets the field win and reports the disagreement', () => {
    // A version name that lies about its own date is a real data defect. Preferring the field
    // silently would leave it in place indefinitely.
    const resolution = resolveReleaseDate({ name: 'Release 08/20/2026', releaseDate: '2026-09-01' });
    expect(resolution.resolvedDateIso).toBe('2026-09-01');
    expect(resolution.source).toBe('field');
    expect(resolution.hasDisagreement).toBe(true);
    expect(resolution.nameDateIso).toBe('2026-08-20');
  });

  it('reports no disagreement when the two agree', () => {
    const resolution = resolveReleaseDate({ name: 'Release 08/20/2026', releaseDate: '2026-08-20' });
    expect(resolution.hasDisagreement).toBe(false);
  });

  it('reads the day on the face of a Jira datetime rather than converting an instant', () => {
    const resolution = resolveReleaseDate({ name: 'Sprint 5', releaseDate: '2026-08-20T00:00:00.000+0000' });
    expect(resolution.resolvedDateIso).toBe('2026-08-20');
  });

  it('says UNDATED when neither source yields a date', () => {
    const resolution = resolveReleaseDate({ name: 'Sprint 5', releaseDate: '' });
    expect(resolution.resolvedDateIso).toBeNull();
    expect(resolution.source).toBe('none');
  });

  it('survives a version with neither a field nor a usable name', () => {
    const resolution = resolveReleaseDate({ name: '' });
    expect(resolution.source).toBe('none');
  });

  it('passes the released flag straight through', () => {
    expect(resolveReleaseDate({ name: 'R', released: true }).isReleased).toBe(true);
    expect(resolveReleaseDate({ name: 'R' }).isReleased).toBe(false);
  });
});

describe('resolveReleaseDates', () => {
  it('returns one resolution per version, in the order given', () => {
    const resolutions = resolveReleaseDates([
      { name: 'Release 08/20/2026' },
      { name: 'Sprint 5' },
      { name: 'Release 09/01/2026', releaseDate: '2026-09-01' },
    ]);
    expect(resolutions.map((resolution) => resolution.source)).toEqual(['name', 'none', 'field']);
    expect(resolutions.map((resolution) => resolution.versionName)).toEqual([
      'Release 08/20/2026',
      'Sprint 5',
      'Release 09/01/2026',
    ]);
  });
});
