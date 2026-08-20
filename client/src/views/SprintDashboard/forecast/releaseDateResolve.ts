// releaseDateResolve.ts — When does this fix version actually release?
//
// Jira holds a release-date field, and the team's naming convention ALSO puts the date in the
// version's name. Nothing in this app has ever read the second one, so a version whose date lives
// only in its name drops out of every date calculation — and does so silently, which reads as
// "nothing to forecast" rather than "somebody left the field blank".
//
// Where both exist and disagree, the field wins and the disagreement is REPORTED. Quietly
// preferring one would leave a version name that lies about its own date in place indefinitely.

import type { FixVersionLike, ReleaseDateResolution } from './forecastTypes.ts';

/**
 * A month/day/year run inside a version name.
 *
 * Slash-delimited only. Accepting '-' would read `Release 2026-08-20` as month 2026; refusing it
 * sends an ISO-named version to its release-date field instead, which such a version almost
 * certainly has. The digit guards on either side stop `1234/5/6789` matching in the middle.
 */
const NAME_DATE_PATTERN = /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?!\d)/g;

/** Two-digit years at or above this read as last century; below it, as this one. */
const TWO_DIGIT_YEAR_CENTURY_SPLIT = 80;

/** Matches a value that OPENS with a calendar day, whatever time or zone may follow it. */
const LEADING_DAY_PATTERN = /^(\d{4}-\d{2}-\d{2})/;

/** Expands a two-digit year; four-digit years pass through untouched. */
function expandYear(rawYear: string): number {
  const yearNumber = Number(rawYear);
  if (rawYear.length === 4) {
    return yearNumber;
  }
  return yearNumber >= TWO_DIGIT_YEAR_CENTURY_SPLIT ? 1900 + yearNumber : 2000 + yearNumber;
}

/**
 * Formats a candidate month/day/year as a calendar day, or null when no such day exists.
 *
 * The existence check is the point: `2/30/2026` is correctly shaped and is not a day, and
 * JavaScript would roll it forward to March rather than refusing it — quietly moving a release.
 */
function toCalendarDay(month: number, day: number, year: number): string | null {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDay = parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
  if (!isRealDay) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Reads the release date out of a version's name.
 *
 * Accepts one- or two-digit months and days and two- or four-digit years, in the org's own
 * month/day/year order. Where a name holds more than one date the first is taken and the ambiguity
 * is reported, because guessing which of two dates somebody meant is not something a forecast
 * should do quietly.
 */
export function parseReleaseDateFromName(versionName: string): { dateIso: string | null; isAmbiguous: boolean } {
  const matches = [...versionName.matchAll(NAME_DATE_PATTERN)];
  const calendarDays = matches
    .map(([, rawMonth, rawDay, rawYear]) => toCalendarDay(Number(rawMonth), Number(rawDay), expandYear(rawYear)))
    .filter((candidate): candidate is string => candidate !== null);

  return {
    dateIso: calendarDays[0] ?? null,
    isAmbiguous: calendarDays.length > 1,
  };
}

/**
 * Reads the day a release-date FIELD names.
 *
 * The leading day is taken as-is rather than converted: Jira sometimes returns a date field as a
 * datetime at UTC midnight, and turning that into a local day yields the day BEFORE for everyone
 * west of Greenwich. A date field names the day written on its face.
 */
function readFieldDay(releaseDate: string | null | undefined): string | null {
  if (typeof releaseDate !== 'string' || releaseDate.trim() === '') {
    return null;
  }
  const leadingDay = LEADING_DAY_PATTERN.exec(releaseDate.trim());
  return leadingDay ? leadingDay[1] : null;
}

/** Works out one version's release date, which source produced it, and whether the two disagreed. */
export function resolveReleaseDate(fixVersion: FixVersionLike): ReleaseDateResolution {
  const fieldDateIso = readFieldDay(fixVersion.releaseDate);
  const { dateIso: nameDateIso, isAmbiguous } = parseReleaseDateFromName(fixVersion.name ?? '');

  const resolvedDateIso = fieldDateIso ?? nameDateIso;
  const source: ReleaseDateResolution['source'] = fieldDateIso !== null
    ? 'field'
    : nameDateIso !== null ? 'name' : 'none';

  return {
    versionName: fixVersion.name ?? '',
    fieldDateIso,
    nameDateIso,
    resolvedDateIso,
    source,
    hasDisagreement: fieldDateIso !== null && nameDateIso !== null && fieldDateIso !== nameDateIso,
    hasAmbiguousName: isAmbiguous,
    isReleased: fixVersion.released === true,
  };
}

/** Resolves a whole list, preserving order so a caller can line results up with its own input. */
export function resolveReleaseDates(fixVersions: readonly FixVersionLike[]): ReleaseDateResolution[] {
  return fixVersions.map((fixVersion) => resolveReleaseDate(fixVersion));
}
