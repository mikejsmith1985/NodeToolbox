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
 * Derives the PI's deadline, or reports that the ART has not set one.
 *
 * An unconfigured PI end yields `isConfigured: false` rather than a fallback. A guessed commitment
 * date is indistinguishable from a real one the moment somebody plans against it.
 */
export function buildPiClock(piEndDate: string, config: ForecastConfig): PiClock {
  const piEndIso = piEndDate.slice(0, 10);
  if (!isRealCalendarDay(piEndIso)) {
    return { piEndIso: null, toPiEnd: null, isConfigured: false };
  }

  return {
    piEndIso,
    toPiEnd: buildWindow('to-pi-end', config.todayIso, piEndIso, config),
    isConfigured: true,
  };
}
