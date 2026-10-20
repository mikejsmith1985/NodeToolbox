// dateTimeParts.ts — Splits a planned date-time ("2026-10-20T08:00") into day, hour and minute and joins it back (pure).
//
// The Wizard's own date-time field uses a day picker plus Hour and Minutes lists instead of the browser's combined
// date-time popup, which commits as you scroll and makes "00" minutes hard to reach (owner feedback). The stored value
// keeps the same "YYYY-MM-DDTHH:mm" shape the combined input produced, so nothing downstream changes.

/** A planned date-time in parts; any part may still be empty while the user is choosing. */
export interface DateTimeParts {
  day: string;
  hour: string;
  minute: string;
}

const HOURS_IN_DAY = 24;
/** Quarter-hour steps: change windows start and end on these. */
const QUARTER_HOUR_MINUTES = ['00', '15', '30', '45'] as const;
/** The minute picked when the user has chosen a day and hour but no minute yet. */
export const DEFAULT_MINUTE = '00';
const NOON_HOUR = 12;
const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** Splits a stored value; anything unreadable gives empty parts. */
export function splitDateTime(storedValue: string): DateTimeParts {
  const match = DATE_TIME_PATTERN.exec(storedValue);
  return match ? { day: match[1], hour: match[2], minute: match[3] } : { day: '', hour: '', minute: '' };
}

/** Joins parts into the stored value, or '' until a day and an hour are chosen (minutes default to 00). */
export function joinDateTime(parts: DateTimeParts): string {
  if (!parts.day || !parts.hour) return '';
  return `${parts.day}T${parts.hour}:${parts.minute || DEFAULT_MINUTE}`;
}

/** "00".."23", each with a plain 12-hour reading, e.g. "13 — 1 PM". */
export function listHourOptions(): Array<{ value: string; label: string }> {
  return Array.from({ length: HOURS_IN_DAY }, (_unused, hourNumber) => {
    const value = String(hourNumber).padStart(2, '0');
    const twelveHour = hourNumber % NOON_HOUR === 0 ? NOON_HOUR : hourNumber % NOON_HOUR;
    return { value, label: `${value} — ${twelveHour} ${hourNumber < NOON_HOUR ? 'AM' : 'PM'}` };
  });
}

/** The quarter hours, plus the current minute when it is something else (so a saved value is never lost). */
export function listMinuteOptions(currentMinute: string): string[] {
  const quarterHours: string[] = [...QUARTER_HOUR_MINUTES];
  return currentMinute && !quarterHours.includes(currentMinute) ? [...quarterHours, currentMinute].sort() : quarterHours;
}
