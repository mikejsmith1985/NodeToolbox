// businessDays.ts — Calendar helpers for "last N business days" report windows and staleness measurement.
//
// "Business days" excludes Saturday and Sunday. The Mentions report uses these helpers to turn a user-selected
// window (e.g. "last 3 business days") into both a JQL date filter and an epoch cutoff for filtering individual
// comments. The staleness surfaces (Hygiene + Sprint Dashboard) use `businessDaysElapsedSince` so an issue left
// untouched over a weekend is not counted as "stale" for those idle weekend days.

const SATURDAY_DAY_INDEX = 6;
const SUNDAY_DAY_INDEX = 0;
const ISO_DATE_PAD_LENGTH = 2;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Returns the date that is `businessDayCount` business days before `fromDate`,
 * anchored to the start of that day (00:00:00 local). Weekend days are skipped
 * and never counted. A count of 0 simply returns the start of `fromDate`.
 *
 * @param businessDayCount How many business days to step back (>= 0).
 * @param fromDate The reference date to count back from (defaults to now).
 */
export function businessDaysAgo(businessDayCount: number, fromDate: Date = new Date()): Date {
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);

  let remainingBusinessDays = Math.max(0, Math.floor(businessDayCount));
  while (remainingBusinessDays > 0) {
    cursor.setDate(cursor.getDate() - 1);
    if (!isWeekend(cursor)) {
      remainingBusinessDays -= 1;
    }
  }

  return cursor;
}

/**
 * Returns the YYYY-MM-DD key of the most recent business day relative to `fromDate`.
 * On a weekday this is the date itself; on a Saturday or Sunday it steps back to the
 * preceding Friday. The Scrum Master "Today" dashboard uses this key to anchor its
 * daily view to the last working day so weekend visits still show Friday's work.
 *
 * @param fromDate The reference date to resolve (defaults to now).
 */
export function mostRecentBusinessDayKey(fromDate: Date = new Date()): string {
  const cursor = new Date(fromDate);
  // Walk backwards one calendar day at a time until we land on a weekday.
  while (isWeekend(cursor)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  return toJqlDateString(cursor);
}

/** Formats a date as YYYY-MM-DD using local calendar parts (the form Jira JQL expects). */
export function toJqlDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(ISO_DATE_PAD_LENGTH, '0');
  const dayOfMonth = String(date.getDate()).padStart(ISO_DATE_PAD_LENGTH, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

/**
 * Counts how many whole BUSINESS days (Monday–Friday) have elapsed between an issue's last-activity timestamp
 * and now. This is the staleness measure: an issue last touched on Friday is "1 business day" idle by Monday,
 * not "3", so a team is never told to chase work that only sat idle over a weekend.
 *
 * The count is done in UTC so the result is identical regardless of the machine's timezone (important for the
 * server-side hygiene monitor and for deterministic tests). Each whole 24-hour day that has elapsed is examined;
 * only the days that land on a weekday are counted. Returns 0 for a missing/unparseable date or a future date.
 *
 * @param fromDateString The ISO timestamp the issue was last updated (a missing value simply counts as 0).
 * @param nowMs The current epoch milliseconds (injectable so callers/tests can pin "now").
 */
export function businessDaysElapsedSince(fromDateString: string | null | undefined, nowMs: number = Date.now()): number {
  if (!fromDateString) return 0;
  const fromMs = new Date(fromDateString).getTime();
  if (!Number.isFinite(fromMs) || fromMs >= nowMs) return 0;

  const wholeDaysElapsed = Math.floor((nowMs - fromMs) / MILLISECONDS_PER_DAY);
  let businessDayCount = 0;
  const cursor = new Date(fromMs);
  // Walk one calendar day at a time across the elapsed span, tallying only the weekdays we land on.
  for (let dayIndex = 0; dayIndex < wholeDaysElapsed; dayIndex += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isUtcWeekend(cursor)) {
      businessDayCount += 1;
    }
  }
  return businessDayCount;
}

/** Returns true when the given date falls on a Saturday or Sunday. */
function isWeekend(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return dayOfWeek === SATURDAY_DAY_INDEX || dayOfWeek === SUNDAY_DAY_INDEX;
}

/** UTC-based weekend check — used by staleness math so the result never shifts with the local timezone. */
function isUtcWeekend(date: Date): boolean {
  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === SATURDAY_DAY_INDEX || dayOfWeek === SUNDAY_DAY_INDEX;
}
