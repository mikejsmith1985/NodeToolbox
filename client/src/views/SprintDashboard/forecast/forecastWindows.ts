// forecastWindows.ts — The two clocks a piece of work is measured against, and the spans between.
//
// They do not coincide, and conflating them is the confusion this whole feature exists to end:
//
//   RELEASE CLOCK — can this be built, code-frozen, externally tested and shipped?
//   PI CLOCK      — can this Feature reach Integrated Test before the increment ends?
//
// A team is measured on the second and operates on the first. Either can be the tighter one.
//
// Code freeze is NOT a new date. It is the Target End the date policy already derives and already
// writes to Jira — three weeks before the release. The lead is imported from there rather than
// restated here, so there can only ever be one answer to "when does the build stop for this
// release".

import { TARGET_END_LEAD_DAYS } from '../../Hygiene/checks/issueDateRules.ts';
import { workingDaysBetween } from '../../../utils/workingDays.ts';
import type { ForecastConfig, ForecastWindow, ForecastWindowKind, PiClock, ReleaseClock } from './forecastTypes.ts';

/** Calendar days of external testing, beginning the day after code freeze. */
const EXTERNAL_TEST_CALENDAR_DAYS = 14;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A bare calendar day. A PI that has not been given one of these has not been configured. */
const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Shifts a calendar day by whole days, in UTC so no timezone can move the result by one. */
function shiftCalendarDays(dayIso: string, dayOffset: number): string {
  const [year, month, day] = dayIso.slice(0, 10).split('-').map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1, day) + dayOffset * MILLISECONDS_PER_DAY);
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

/** True when a stored value names a day the calendar has — shape alone would admit 2026-02-30. */
function isRealCalendarDay(candidate: string): boolean {
  if (!CALENDAR_DAY_PATTERN.test(candidate)) {
    return false;
  }
  const [year, month, day] = candidate.split('-').map((part) => Number(part));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

/**
 * Builds one span, counting only the days somebody could actually work in it.
 *
 * A span whose end has passed reports zero and says so. Returning a negative count would let a
 * caller subtract its way to a deadline in the past and present the result as runway.
 */
function buildWindow(
  kind: ForecastWindowKind,
  startIso: string,
  endIso: string,
  config: ForecastConfig,
): ForecastWindow {
  const hasPassed = endIso < startIso;
  return {
    kind,
    startIso,
    endIso,
    // The interval is counted from the day BEFORE the start, so the start day itself is included:
    // work beginning today has today available to it.
    workingDayCount: hasPassed ? 0 : workingDaysBetween(shiftCalendarDays(startIso, -1), endIso, config.calendar),
    hasPassed,
  };
}

/**
 * Derives one release's four boundaries and the three spans between them.
 *
 * The three spans tile the weeks before the release exactly: 21 = 1 + 14 + 6. A gap would swallow
 * work, and an overlap would count one day as both test capacity and deploy buffer — and each
 * window would still look correct on its own, which is why the tiling is asserted rather than
 * assumed.
 */
export function buildReleaseClock(releaseDateIso: string, config: ForecastConfig): ReleaseClock {
  const releaseDay = releaseDateIso.slice(0, 10);
  const codeFreezeIso = shiftCalendarDays(releaseDay, -TARGET_END_LEAD_DAYS);
  const externalTestStartIso = shiftCalendarDays(codeFreezeIso, 1);
  const externalTestEndIso = shiftCalendarDays(externalTestStartIso, EXTERNAL_TEST_CALENDAR_DAYS - 1);
  const deployBufferStartIso = shiftCalendarDays(externalTestEndIso, 1);

  return {
    releaseDateIso: releaseDay,
    codeFreezeIso,
    externalTestStartIso,
    externalTestEndIso,
    deployBufferStartIso,
    toCodeFreeze: buildWindow('to-code-freeze', config.todayIso, codeFreezeIso, config),
    externalTest: buildWindow('external-test', externalTestStartIso, externalTestEndIso, config),
    // Present so a surface can LABEL it, never so anything can be scheduled into it: the last week
    // before a release carries no test capacity by definition.
    deployBuffer: buildWindow('deploy-buffer', deployBufferStartIso, releaseDay, config),
  };
}

/**
 * A PI name's own date range, e.g. `PI 26.4 (07/30/26 - 10/07/26)`.
 *
 * The org writes the window into the name, so the PI clock does not have to depend on somebody
 * having filled in an ART setting as well. Without this, every board reported "No PI end set" while
 * the answer was sitting in the PI selector directly above it.
 */
const PI_NAME_DATE_PATTERN = /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?!\d)/g;

/** Two-digit years at or above this read as last century; below it, as this one. */
const TWO_DIGIT_YEAR_CENTURY_SPLIT = 80;

/**
 * Reads the PI's LAST date from its name — the end of the window, not the start.
 *
 * The last rather than the first, deliberately: a PI name carries a range, and taking the opening
 * date would put the deadline at the beginning of the increment and report every Feature as
 * hopelessly late on day one.
 */
export function parsePiEndFromName(piName: string): string | null {
  const matches = [...piName.matchAll(PI_NAME_DATE_PATTERN)];
  const calendarDays = matches
    .map(([, rawMonth, rawDay, rawYear]) => {
      const yearNumber = Number(rawYear);
      const year = rawYear.length === 4
        ? yearNumber
        : yearNumber >= TWO_DIGIT_YEAR_CENTURY_SPLIT ? 1900 + yearNumber : 2000 + yearNumber;
      const month = Number(rawMonth);
      const day = Number(rawDay);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      const isRealDay = parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
      return isRealDay
        ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        : null;
    })
    .filter((candidate): candidate is string => candidate !== null);

  return calendarDays.length === 0 ? null : calendarDays[calendarDays.length - 1];
}

/**
 * Derives the PI's deadline, or reports that the ART has not set one.
 *
 * An unconfigured PI end yields `isConfigured: false` rather than a fallback. A guessed commitment
 * date is indistinguishable from a real one the moment somebody plans against it.
 */
export function buildPiClock(piEndDate: string, config: ForecastConfig, piName = ''): PiClock {
  // The ART setting first, then the PI's own name. The setting is somebody's deliberate answer and
  // outranks a parse; the name is what makes the clock work when nobody filled the setting in.
  const configuredIso = piEndDate.slice(0, 10);
  const piEndIso = isRealCalendarDay(configuredIso) ? configuredIso : parsePiEndFromName(piName);
  if (piEndIso === null || !isRealCalendarDay(piEndIso)) {
    return { piEndIso: null, toPiEnd: null, isConfigured: false };
  }

  return {
    piEndIso,
    toPiEnd: buildWindow('to-pi-end', config.todayIso, piEndIso, config),
    isConfigured: true,
  };
}
