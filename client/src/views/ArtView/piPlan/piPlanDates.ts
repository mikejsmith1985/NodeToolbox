// piPlanDates.ts — The one genuinely new pure module for spec 028: a working-day calendar plus the
// deploy cadence that turns a scheduled Story into its five dates (Target Start, Target End = code in
// INT, internal-test end, INT/REL/PROD, Due). All arithmetic is in working days; the clock and the
// calendar are injected so the result is deterministic and fully unit-testable (Framework-First: no
// existing module does calendar cadence — see plan.md drift ledger).

import type { DatedItem, ReleaseSchedule, ScheduledStory, WorkingCalendar } from './piPlanTypes.ts';
import {
  addWorkingDays,
  isWorkingDay,
  rollToWorkingDay,
  subtractWorkingDays,
  workingDaysBetween,
} from '../../../utils/workingDays.ts';

/** Deploy-to-INT must land within 24h of internal-test completion → the next calendar day, then rolled. */
const INT_AFTER_TEST_CALENDAR_DAYS = 1;
/** Deploy-to-REL happens five working days after deploy-to-INT (clarified: working, not calendar, days). */
const INT_TO_REL_WORKING_DAYS = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// The working-day primitives moved to utils/workingDays.ts so that Hygiene's date policy, My Issues
// and the Team Dashboard could use them without depending on the PI planner. They are re-exported
// here unchanged, so every existing import path still resolves and this module's own tests still
// describe the same behaviour.
export { isWorkingDay, rollToWorkingDay, addWorkingDays, subtractWorkingDays, workingDaysBetween };

/** The injected context the cadence needs: the calendar, the PI window, releases, and the velocity rate. */
export interface DateContext {
  calendar: WorkingCalendar;
  piStartIso: string;
  piEndIso: string;
  releaseSchedule: ReleaseSchedule;
  /** Points completed per working day (the velocity basis) — converts effort to calendar time. */
  pointsPerWorkingDay: number;
  todayIso: string;
}

/** Returns the ISO date `days` calendar days after `iso`. */
function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MILLISECONDS_PER_DAY);
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

// ── Deploy cadence ────────────────────────────────────────────────────────────

/** Converts a point effort into a whole number of working days at the given velocity (0 stays 0). */
function effortToWorkingDays(points: number, pointsPerWorkingDay: number): number {
  if (points <= 0) {
    return 0;
  }
  const rate = pointsPerWorkingDay > 0 ? pointsPerWorkingDay : 1;
  return Math.ceil(points / rate);
}

/** Returns the last working day of a `workDays`-long span that starts on (and includes) `startIso`. */
function spanEnd(startIso: string, workDays: number, calendar: WorkingCalendar): string {
  return workDays <= 0 ? startIso : addWorkingDays(startIso, workDays - 1, calendar);
}

/** Finds the first release on/after `iso`; releases are assumed date-sorted. Returns null when none. */
function firstReleaseOnOrAfter(iso: string, schedule: ReleaseSchedule): string | null {
  const match = schedule.entries.find((entry) => entry.releaseDateIso >= iso);
  return match ? match.releaseDateIso : null;
}

/**
 * Computes the five scheduled dates for one Story per the cadence rules, each with a derivation string.
 * Target End (= deploy-to-INT) is the PI Definition of Done; the Due date (= PROD) may fall after the PI.
 */
export function computeItemDates(story: ScheduledStory, context: DateContext): DatedItem {
  const { calendar, pointsPerWorkingDay, releaseSchedule } = context;
  const targetStartIso = rollToWorkingDay(story.sprintStartIso, calendar);

  const devWorkDays = effortToWorkingDays(story.devPoints, pointsPerWorkingDay);
  const testWorkDays = story.hasTestableOutput
    ? effortToWorkingDays(story.internalTestPoints, pointsPerWorkingDay)
    : 0;

  const devEndIso = spanEnd(targetStartIso, devWorkDays, calendar);
  const internalTestEndIso = story.hasTestableOutput
    ? spanEnd(addWorkingDays(devEndIso, testWorkDays > 0 ? 1 : 0, calendar), Math.max(testWorkDays, 1), calendar)
    : null;

  const completionForInt = internalTestEndIso ?? devEndIso;
  const deployIntIso = rollToWorkingDay(addCalendarDays(completionForInt, INT_AFTER_TEST_CALENDAR_DAYS), calendar);
  const deployRelIso = addWorkingDays(deployIntIso, INT_TO_REL_WORKING_DAYS, calendar);
  const deployProdIso = firstReleaseOnOrAfter(deployRelIso, releaseSchedule);

  return {
    targetStartIso,
    internalTestEndIso,
    targetEndIso: deployIntIso,
    deployIntIso,
    deployRelIso,
    deployProdIso,
    dueIso: deployProdIso,
    derivations: {
      targetStartIso: `Target Start = first working day of the assigned sprint (${story.sprintName})`,
      internalTestEndIso: internalTestEndIso
        ? `Internal-test end = ${devWorkDays} dev + ${testWorkDays} test working days from ${targetStartIso}; gates external test`
        : 'No internal-test sub-task (story has no testable output)',
      targetEndIso: `Target End = code in INT ≤ 1 day after internal-test complete (${completionForInt}), rolled to a working day`,
      deployRelIso: `REL = INT (${deployIntIso}) + 5 working days`,
      deployProdIso: deployProdIso
        ? `PROD/Due = first release on/after REL (${deployRelIso})`
        : `No production release on/after REL (${deployRelIso}); a monthly release will be suggested`,
    },
  };
}
