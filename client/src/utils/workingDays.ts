// workingDays.ts — Weekend and holiday arithmetic, for every surface that needs a delivery date.
//
// This arithmetic was written for the PI planner and lived under views/ArtView/piPlan/. It has to
// move, because the surfaces that now need it — Hygiene's date policy, My Issues, the Team
// Dashboard — must not depend on the PI planner to know what a working day is. Importing it from
// there would invert the layering; copying it would make a fourth declaration of the weekend rule
// in a codebase currently deleting exactly that class of duplication.
//
// The behaviour is UNCHANGED by the move. piPlanDates.ts re-exports every function from here, and
// its own test suite must keep passing untouched — that is the proof, not this comment.
//
// One primitive is genuinely new: stepping BACKWARDS. Nothing needed that direction until a
// deadline had to be turned into the latest day work could start and still land.
//
// Everything is string-in / string-out over 'YYYY-MM-DD' days and pure: the calendar is injected,
// so a result is reproducible and testable with no clock involved.

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Which days are not working days: the weekend by weekday index, plus any listed holiday. */
export interface WorkingCalendar {
  /** Sunday is 0 through Saturday is 6, matching JavaScript's own weekday numbering. */
  weekendDays: number[];
  holidayIsoDates: string[];
}

/**
 * Parses a 'YYYY-MM-DD' (or longer ISO) string into a UTC Date at midnight.
 *
 * UTC deliberately: constructing a local Date from a date-only string shifts the day for anyone
 * west of Greenwich, which would silently move every derived deadline by one.
 */
function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

/** Formats a UTC Date back to 'YYYY-MM-DD'. */
function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Returns the ISO day `days` calendar days after `iso` (negative steps backwards). */
function addCalendarDays(iso: string, days: number): string {
  return formatIsoDate(new Date(parseIsoDate(iso).getTime() + days * MILLISECONDS_PER_DAY));
}

/** True when the given day is neither a configured weekend day nor a listed holiday. */
export function isWorkingDay(iso: string, calendar: WorkingCalendar): boolean {
  const weekday = parseIsoDate(iso).getUTCDay();
  const isWeekend = calendar.weekendDays.includes(weekday);
  const isHoliday = calendar.holidayIsoDates.includes(iso.slice(0, 10));
  return !isWeekend && !isHoliday;
}

/** Advances to the next working day if `iso` is a weekend or holiday; otherwise returns it unchanged. */
export function rollToWorkingDay(iso: string, calendar: WorkingCalendar): string {
  let candidate = iso.slice(0, 10);
  while (!isWorkingDay(candidate, calendar)) {
    candidate = addCalendarDays(candidate, 1);
  }
  return candidate;
}

/** Returns the day `count` working days after `iso` (count = 0 returns `iso` unchanged). */
export function addWorkingDays(iso: string, count: number, calendar: WorkingCalendar): string {
  let result = iso.slice(0, 10);
  let remaining = count;
  while (remaining > 0) {
    result = addCalendarDays(result, 1);
    if (isWorkingDay(result, calendar)) {
      remaining -= 1;
    }
  }
  return result;
}

/**
 * Returns the day `count` working days BEFORE `iso` (count = 0 returns `iso` unchanged).
 *
 * The exact mirror of `addWorkingDays`, one calendar day at a time, decrementing only on working
 * days — so the two are inverses. That matters more than it sounds: a latest-start date computed by
 * this and a completion date computed by its opposite have to land on the same day for the same
 * effort, or the forecast contradicts itself and neither figure looks wrong.
 */
export function subtractWorkingDays(iso: string, count: number, calendar: WorkingCalendar): string {
  let result = iso.slice(0, 10);
  let remaining = count;
  while (remaining > 0) {
    result = addCalendarDays(result, -1);
    if (isWorkingDay(result, calendar)) {
      remaining -= 1;
    }
  }
  return result;
}

/** Counts working days in the half-open interval (startIso, endIso] — the start day is never counted. */
export function workingDaysBetween(startIso: string, endIso: string, calendar: WorkingCalendar): number {
  let cursor = startIso.slice(0, 10);
  let count = 0;
  const end = endIso.slice(0, 10);
  while (cursor < end) {
    cursor = addCalendarDays(cursor, 1);
    if (isWorkingDay(cursor, calendar)) {
      count += 1;
    }
  }
  return count;
}
