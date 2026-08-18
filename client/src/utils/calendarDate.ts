// calendarDate.ts — One answer to "is this Jira date today or already past?".
//
// There were two, and they disagreed. Hygiene compared a date-only string against the LOCAL calendar
// day; the Readiness scan parsed the same string into a moment (which makes it UTC midnight) and
// compared it against `Date.now()`. West of Greenwich those two answers differ for several hours
// every evening: at 23:30 in New York it is already tomorrow in UTC, so Readiness would call a date
// "past" that Hygiene — and the person reading the screen — still called tomorrow.
//
// The fix is not a better comparison but a single one, built on the thing Jira actually stores. A
// Jira due date is a DAY, not an instant: "2026-07-16" means the sixteenth wherever you are reading
// it, and turning it into a moment is what introduces a timezone it never had. So every value is
// reduced to a calendar day first, and days are compared to days.

/** A calendar day in `YYYY-MM-DD` form — the shape Jira stores dates in, and the shape we compare. */
export type CalendarDay = string;

/** Formats an instant as the calendar day it falls on for the viewer. */
export function toCalendarDay(instant: Date): CalendarDay {
  return [
    String(instant.getFullYear()),
    String(instant.getMonth() + 1).padStart(2, '0'),
    String(instant.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Matches a bare Jira date, which names a day and carries no timezone of its own. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a Jira date or datetime as the calendar day it names, or null when it names none.
 *
 * A bare `YYYY-MM-DD` is returned untouched — deliberately never parsed, because parsing is what
 * would attach a timezone Jira did not put there. A full datetime IS an instant, so it is reduced
 * to the day that instant falls on for whoever is reading the screen.
 */
export function readCalendarDay(value: unknown): CalendarDay | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === '') {
    return null;
  }
  if (DATE_ONLY_PATTERN.test(trimmedValue)) {
    return trimmedValue;
  }

  const parsedInstant = new Date(trimmedValue);
  return Number.isFinite(parsedInstant.getTime()) ? toCalendarDay(parsedInstant) : null;
}

/**
 * True when the value names a calendar day that is today or earlier for the viewer.
 *
 * A value that names no day at all answers false: "we cannot tell" is not "it is overdue", and a
 * warning raised on an unreadable field would be a warning nobody could act on. Callers that treat
 * a MISSING date as its own problem say so at the call site, where the distinction is visible.
 *
 * `nowMs` is injectable so a caller evaluating a batch stamps every issue against one instant
 * rather than drifting across a midnight boundary mid-scan.
 */
export function isOnOrBeforeToday(value: unknown, nowMs: number = Date.now()): boolean {
  const calendarDay = readCalendarDay(value);
  // Lexicographic order on YYYY-MM-DD is chronological order, which is the whole reason for the shape.
  return calendarDay !== null && calendarDay <= toCalendarDay(new Date(nowMs));
}
