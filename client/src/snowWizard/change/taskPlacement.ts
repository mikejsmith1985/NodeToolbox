// taskPlacement.ts — Where a task sits in its change's window (pure): one after another (the default), on stand-by for
// the whole window (an awareness task nobody waits on), alongside another task, and never before a stated time.
//
// Owner, GH #475: a task saying it "must be completed after 5:00 CST" was ignored, every task was run in series when some
// can run in parallel, and a Prod Support task kept only for awareness held up the implementation tasks behind it.

import type { CtaskTemplate, TaskRunMode, TaskTimelinePlacement } from '../../views/SnowHub/hooks/useCrgState.ts';

/** The placement every task has until something says otherwise. */
export const IN_ORDER_PLACEMENT: TaskTimelinePlacement = Object.freeze({ runMode: 'inOrder' });

const RUN_MODES: readonly TaskRunMode[] = ['inOrder', 'wholeWindow', 'alongside'];
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
// "not before 17:00", "after 5:00 pm CST", "no earlier than 5 PM CT".
const NOT_BEFORE_PATTERN = /\b(?:not before|no earlier than|after|from)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*([A-Za-z]{2,4})?\b/i;
const WHOLE_WINDOW_PATTERN = /\b(?:whole|entire|full)\s+window\b|\bstand-?\s?by\b|\bon[- ]call\b|\bawareness\b/i;
const ALONGSIDE_PATTERN = /\b(?:with|alongside|parallel(?:\s+(?:with|to))?|same time as|concurrent(?:ly)?\s+with)\s+(T\d+|CTASK\d+)\b/i;
const IN_ORDER_PATTERN = /\bin order\b|\bin series\b|\bsequential\b|\bafter the (?:one|task) before\b/i;
const HOURS_PER_HALF_DAY = 12;
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
// The form's date-time length: "YYYY-MM-DDTHH:mm".
const FORM_DATE_TIME_LENGTH = 16;

// The zone names people write in a task, mapped to the zone whose clock (daylight saving included) they mean: "CST" in
// October is said loosely for Central time, so every Central name means America/Chicago.
const ZONE_BY_NAME: Readonly<Record<string, string>> = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  UTC: 'UTC', GMT: 'UTC',
};

/** The time zone this browser shows the change windows in. */
export function readLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** A card's placement, cleaned: an unknown run mode, a missing partner or a malformed time falls back to the default. */
export function readTaskPlacement(card: CtaskTemplate): TaskTimelinePlacement {
  const stored = card.timelinePlacement;
  if (!stored || !RUN_MODES.includes(stored.runMode)) return IN_ORDER_PLACEMENT;
  const notBeforeTime = stored.notBeforeTime && CLOCK_PATTERN.test(stored.notBeforeTime) ? stored.notBeforeTime : undefined;
  const alongsideTaskTitle = stored.alongsideTaskTitle?.trim();
  if (stored.runMode === 'alongside' && !alongsideTaskTitle) return notBeforeTime ? { runMode: 'inOrder', notBeforeTime } : IN_ORDER_PLACEMENT;
  return {
    runMode: stored.runMode,
    ...(stored.runMode === 'alongside' ? { alongsideTaskTitle } : {}),
    ...(notBeforeTime ? { notBeforeTime } : {}),
  };
}

/** Minutes east of UTC that a zone's clock reads at one instant ("GMT-05:00" → -300). */
function readZoneOffsetMinutes(timeZone: string, instant: Date): number {
  const zoneText = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const offsetMatch = /GMT([+-])(\d{2}):(\d{2})/.exec(zoneText);
  if (!offsetMatch) return 0;
  const offsetMinutes = Number(offsetMatch[2]) * MINUTES_PER_HOUR + Number(offsetMatch[3]);
  return offsetMatch[1] === '-' ? -offsetMinutes : offsetMinutes;
}

/** "HH:mm" from minutes after midnight, wrapping past midnight either way. */
function formatClockMinutes(totalMinutes: number): string {
  const minutesInDay = ((totalMinutes % (24 * MINUTES_PER_HOUR)) + 24 * MINUTES_PER_HOUR) % (24 * MINUTES_PER_HOUR);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutesInDay / MINUTES_PER_HOUR))}:${pad(minutesInDay % MINUTES_PER_HOUR)}`;
}

/**
 * A clock time stated in one zone, read on another zone's clock on a given day: "17:00" Central is "18:00" Eastern.
 * The day matters because daylight saving moves the gap between zones.
 */
export function convertClockBetweenZones(clockTime: string, fromZone: string, toZone: string, onDate: string): string {
  const clockMatch = CLOCK_PATTERN.exec(clockTime);
  if (!clockMatch || fromZone === toZone) return clockTime;
  const noonOfDay = new Date(`${onDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(noonOfDay.getTime())) return clockTime;
  const shiftMinutes = readZoneOffsetMinutes(toZone, noonOfDay) - readZoneOffsetMinutes(fromZone, noonOfDay);
  return formatClockMinutes(Number(clockMatch[1]) * MINUTES_PER_HOUR + Number(clockMatch[2]) + shiftMinutes);
}

/** "17:00" from the hour, minutes and am/pm of a "not before" phrase; null when it is not a real time. */
function readTwentyFourHourClock(hourText: string, minuteText: string | undefined, meridiemText: string | undefined): string | null {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (hour > 23 || minute > 59) return null;
  const meridiem = meridiemText?.toLowerCase().replace(/\./g, '');
  if (meridiem === 'pm' && hour < HOURS_PER_HALF_DAY) hour += HOURS_PER_HALF_DAY;
  if (meridiem === 'am' && hour === HOURS_PER_HALF_DAY) hour = 0;
  return formatClockMinutes(hour * MINUTES_PER_HOUR + minute);
}

/** The "not before" time a reply states, moved onto the window's clock when it names another zone. */
function readNotBeforeTime(cellText: string, windowZone: string, windowDate: string): string | undefined {
  const notBeforeMatch = NOT_BEFORE_PATTERN.exec(cellText);
  if (!notBeforeMatch) return undefined;
  const clockTime = readTwentyFourHourClock(notBeforeMatch[1], notBeforeMatch[2], notBeforeMatch[3]);
  if (!clockTime) return undefined;
  const statedZone = notBeforeMatch[4] ? ZONE_BY_NAME[notBeforeMatch[4].toUpperCase()] : undefined;
  return statedZone && windowDate ? convertClockBetweenZones(clockTime, statedZone, windowZone, windowDate) : clockTime;
}

/** What the reply cell is read against: who "T3" is, and the window's clock. */
export interface PlacementReadContext {
  /** The short description of the task a reply names ("T3", "CTASK0012345"), or undefined when it names none. */
  findTaskTitle: (namingText: string) => string | undefined;
  windowZone: string;
  /** The first window's start, for the day a stated zone is converted on. */
  windowDate: string;
}

/**
 * A reply's "runs" cell read into a placement: "in order", "whole window", "with T3", each optionally followed by
 * "; not before 17:00 CT". Null when the cell says none of these, so a reply in the older form leaves placements alone.
 */
export function readPlacementCell(cellText: string, context: PlacementReadContext): TaskTimelinePlacement | null {
  const notBeforeTime = readNotBeforeTime(cellText, context.windowZone, context.windowDate);
  const withTime = notBeforeTime ? { notBeforeTime } : {};
  if (WHOLE_WINDOW_PATTERN.test(cellText)) return { runMode: 'wholeWindow', ...withTime };
  const alongsideMatch = ALONGSIDE_PATTERN.exec(cellText);
  const alongsideTaskTitle = alongsideMatch ? context.findTaskTitle(alongsideMatch[1]) : undefined;
  if (alongsideTaskTitle) return { runMode: 'alongside', alongsideTaskTitle, ...withTime };
  if (IN_ORDER_PATTERN.test(cellText) || notBeforeTime) return { runMode: 'inOrder', ...withTime };
  return null;
}

/** A form date-time moved on by whole days, in the same form (wall-clock arithmetic). */
function addDays(formDateTime: string, dayCount: number): string {
  const instant = new Date(`${formDateTime.slice(0, FORM_DATE_TIME_LENGTH)}:00Z`);
  return new Date(instant.getTime() + dayCount * MILLISECONDS_PER_DAY).toISOString().slice(0, FORM_DATE_TIME_LENGTH);
}

/**
 * The earliest a task may start inside a window, from its "not before" time, or null when the window already starts
 * after it. The time is taken on the window's first day; a window that runs past midnight and starts after that time
 * uses the next day only when that still falls inside the window (an "after 00:30" task in a 22:00–02:00 window).
 */
export function resolveNotBeforeDate(notBeforeTime: string | undefined, windowStartDate: string, windowEndDate: string): string | null {
  if (!notBeforeTime || !CLOCK_PATTERN.test(notBeforeTime) || windowStartDate.trim() === '') return null;
  const windowStart = windowStartDate.slice(0, FORM_DATE_TIME_LENGTH);
  const sameDay = `${windowStart.slice(0, 10)}T${notBeforeTime}`;
  if (sameDay > windowStart) return sameDay;
  const nextDay = addDays(sameDay, 1);
  return windowEndDate.trim() !== '' && nextDay < windowEndDate.slice(0, FORM_DATE_TIME_LENGTH) ? nextDay : null;
}

/** The later of two form date-times. */
export function readLaterDate(firstDate: string, secondDate: string | null): string {
  return secondDate && secondDate > firstDate ? secondDate : firstDate;
}

/** Minutes between two form date-times (wall clock). */
export function readMinutesBetween(startDate: string, endDate: string): number {
  const toInstant = (formDateTime: string) => new Date(`${formDateTime.slice(0, FORM_DATE_TIME_LENGTH)}:00Z`).getTime();
  return Math.round((toInstant(endDate) - toInstant(startDate)) / MILLISECONDS_PER_MINUTE);
}

/** The placement in a few plain words for the timeline and the AI ("on stand-by for the whole window"), or '' for the default. */
export function describeTaskPlacement(placement: TaskTimelinePlacement): string {
  const runText = placement.runMode === 'wholeWindow'
    ? 'on stand-by for the whole window — not a step the other tasks wait for'
    : placement.runMode === 'alongside' ? `runs alongside “${placement.alongsideTaskTitle ?? ''}”` : '';
  const timeText = placement.notBeforeTime ? `not before ${placement.notBeforeTime}` : '';
  return [runText, timeText].filter((text) => text !== '').join(', ');
}
