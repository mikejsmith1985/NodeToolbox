// issueDateRules.ts — The team's date policy, in one place, as pure arithmetic.
//
// Three dates on a delivery issue are not free-form: they follow from the release the work is
// committed to, and from when the work became workable.
//
//   Due Date    = the fix version's release date
//   Target End  = three weeks before it, the buffer the release has to clear (also called CODE FREEZE)
//   Target Start = the latest day work can begin and still finish by its deadline, where the effort
//                  is known; otherwise the day it actually started, or a few days after it became
//                  workable
//
// Stating them here rather than in a check, a fix, and a prompt separately is the point: those three
// would otherwise each carry their own copy and drift, and a board that disagrees with itself about
// what a date SHOULD be is worse than one that never had the date.
//
// Nothing here reads Jira or the clock. A date that cannot be derived comes back null with the
// reason it could not — never a guess, because a guessed commitment date is indistinguishable from
// a real one once it is written.

import { readCalendarDay, toCalendarDay } from '../../../utils/calendarDate.ts';
import { subtractWorkingDays, type WorkingCalendar } from '../../../utils/workingDays.ts';

/** The status whose entry starts the clock on a PREDICTED Target Start. */
export const READY_TO_WORK_STATUS_NAME = 'Ready to Work';

/** The status whose entry IS the start — the fact a prediction is only standing in for. */
export const WORKING_STATUS_NAME = 'Working';

/**
 * Calendar days between Target End and the release — the buffer, not a workload estimate.
 *
 * Exported because this date has a second name: the delivery forecast calls it CODE FREEZE, and it
 * is the same day. Importing the number is what stops there being two answers to "when does the
 * build stop for this release", which is the sort of disagreement nobody notices until a release.
 */
export const TARGET_END_LEAD_DAYS = 21;

/** Calendar days after reaching Ready to Work that work is expected to begin. */
const TARGET_START_LEAD_DAYS = 3;

const MILLISECONDS_PER_DAY = 86_400_000;

/** One fix version as the issue carries it; Jira returns the release date inline. */
export interface IssueFixVersion {
  /** Optional because the hygiene issue shape allows a nameless version; the policy never reads it. */
  name?: string;
  releaseDate?: string;
  released?: boolean;
}

/** Everything the policy needs about one issue. */
export interface IssueDateInput {
  fixVersions: readonly IssueFixVersion[];
  /** When the issue first reached Ready to Work, or null when it has not (or is unknown). */
  readyToWorkEnteredIso: string | null;
  /** When the issue first reached Working — the day work actually began, if it has. */
  workingEnteredIso?: string | null;
  currentDueDate: string | null;
  currentTargetStart: string | null;
  currentTargetEnd: string | null;
  /**
   * How many working days of work are LEFT in this issue.
   *
   * Supplying it turns Target Start from "roughly when this became workable" into "the latest day
   * it can begin and still land", which is the only form that can answer whether a team is behind.
   *
   * Optional, and absent by default: every caller that predates the forecast supplies nothing and
   * gets exactly the dates it got before.
   */
  remainingEffortWorkingDays?: number | null;
  /**
   * The day this issue has to start for its Feature's WHOLE chain to make the deadline.
   *
   * The issue's own effort is not the whole story: a dev story with a week of SL testing queued
   * behind it, and two days of handover between them, has to begin far earlier than its own size
   * suggests. Worked out by the caller, which can see the Feature's other issues; this module sees
   * one issue at a time and could never derive it.
   *
   * Optional and absent by default, so every caller that predates the chain gets what it always got.
   */
  chainTargetStartIso?: string | null;
  /** The PI Definition-of-Done deadline, when the ART has configured one. */
  piDodDeadlineIso?: string | null;
  /** Weekend and holiday calendar. Required for the back-calculation; ignored without it. */
  workingCalendar?: WorkingCalendar;
}

/** What the policy says the dates should be, and where the issue departs from it. */
export interface DerivedIssueDates {
  dueDate: string | null;
  targetStart: string | null;
  targetEnd: string | null;
  /** Human-readable field names whose current value differs from the derived one. */
  mismatchedFieldNames: string[];
  /** Why a date could not be derived — shown instead of a fix, so the gap is explained. */
  undecidedReasons: string[];
  /**
   * Which rule produced `targetStart`, so a bulk fix can say what it did rather than just how many.
   *
   * Optional for the same reason the new inputs are: nothing that existed before this needs it.
   */
  targetStartBasis?: 'actual-working' | 'chain-back-calculated' | 'back-calculated' | 'ready-to-work-lead' | 'none';
}

/**
 * The fix version that dates the issue: the EARLIEST unreleased one that has a release date.
 *
 * Earliest because an issue tagged for two releases is committed to the first; dating it from the
 * later one hands the team weeks nobody granted. Released versions are skipped — their date is
 * history rather than a commitment — and one without a release date cannot date anything.
 */
export function readDrivingFixVersion(fixVersions: readonly IssueFixVersion[]): IssueFixVersion | null {
  const datedUnreleased = fixVersions
    .filter((fixVersion) => fixVersion.released !== true && readCalendarDay(fixVersion.releaseDate) !== null);
  if (datedUnreleased.length === 0) return null;

  return [...datedUnreleased].sort((leftVersion, rightVersion) =>
    (readCalendarDay(leftVersion.releaseDate) ?? '').localeCompare(readCalendarDay(rightVersion.releaseDate) ?? ''))[0];
}

/** Shifts a calendar day by a whole number of calendar days. */
function shiftCalendarDays(calendarDay: string, dayOffset: number): string {
  return toCalendarDay(new Date(new Date(`${calendarDay}T12:00:00`).getTime() + dayOffset * MILLISECONDS_PER_DAY));
}

/** Matches a value that OPENS with a calendar day, whatever time or zone may follow it. */
const LEADING_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Reads the day a DATE FIELD names.
 *
 * Not the same question as "which day did this instant fall on", and the difference bites: Jira
 * sometimes returns a date field as a datetime at UTC midnight, and converting that to a local day
 * yields the day BEFORE for everyone west of Greenwich. A date field names the day written on its
 * face, so the leading day is taken as-is and only genuinely timestamp-shaped values are converted.
 */
function readDateFieldDay(fieldValue: string | null): string | null {
  if (typeof fieldValue !== 'string') return null;
  const leadingDate = LEADING_DATE_PATTERN.exec(fieldValue.trim());
  return leadingDate ? leadingDate[1] : readCalendarDay(fieldValue);
}

/** True when a stored value already names the derived day (a Jira datetime still counts). */
function agreesWithDerived(currentValue: string | null, derivedDay: string | null): boolean {
  if (derivedDay === null) return true;
  return readDateFieldDay(currentValue) === derivedDay;
}

/**
 * Works out Target Start, and says which of the four rules produced it.
 *
 * The order is a hierarchy of evidence, strongest first:
 *
 *   1. The day work ACTUALLY began. A fact always beats a prediction, so this wins whenever it
 *      exists — including for work that jumped straight into Working and skipped Ready to Work.
 *   2. The latest day it could begin and still land, from the effort it has left. This is the only
 *      form that can answer "if this does not start today we are behind", and it is why the
 *      forecast supplies effort at all.
 *   3. A few days after it became workable. The original rule, kept for every caller that has no
 *      effort figure to offer.
 *   4. Nothing, with the reason already recorded by the caller.
 *
 * Rule 2 measures against whichever deadline is EARLIER — code freeze or the PI's own — because the
 * tighter commitment is the one that actually binds.
 */
function deriveTargetStart(
  input: IssueDateInput,
  workingDay: string | null,
  readyToWorkDay: string | null,
  targetEnd: string | null,
): { targetStart: string | null; targetStartBasis: DerivedIssueDates['targetStartBasis'] } {
  if (workingDay !== null) {
    return { targetStart: workingDay, targetStartBasis: 'actual-working' };
  }

  // Above the issue's own effort, below the day work actually began. The chain accounts for the work
  // that has to FOLLOW this issue, so it is the earlier and truer of the two derived dates -- but a
  // date work really started on is a fact, and a fact outranks any plan.
  if (input.chainTargetStartIso !== undefined && input.chainTargetStartIso !== null) {
    return { targetStart: input.chainTargetStartIso, targetStartBasis: 'chain-back-calculated' };
  }

  const remainingWorkingDays = input.remainingEffortWorkingDays ?? null;
  const piDodDeadlineIso = input.piDodDeadlineIso ?? null;
  const bindingDeadline = [targetEnd, piDodDeadlineIso]
    .filter((deadline): deadline is string => deadline !== null)
    .sort()[0] ?? null;

  if (
    input.workingCalendar !== undefined
    && remainingWorkingDays !== null
    && remainingWorkingDays > 0
    && bindingDeadline !== null
  ) {
    return {
      // Inclusive of its own start day: one day of work due today starts today, not yesterday.
      targetStart: subtractWorkingDays(bindingDeadline, remainingWorkingDays - 1, input.workingCalendar),
      targetStartBasis: 'back-calculated',
    };
  }

  if (readyToWorkDay !== null) {
    return {
      targetStart: shiftCalendarDays(readyToWorkDay, TARGET_START_LEAD_DAYS),
      targetStartBasis: 'ready-to-work-lead',
    };
  }

  return { targetStart: null, targetStartBasis: 'none' };
}

/**
 * The day work on an issue has to be finished by: code freeze, three weeks before its release.
 *
 * The same arithmetic this module's own Target End uses, exported so a caller reasoning about a
 * whole Feature computes the deadline identically rather than re-deriving it and slowly drifting.
 * Returns null when no unreleased fix version carries a release date.
 */
export function readCodeFreezeDeadline(fixVersions: readonly IssueFixVersion[]): string | null {
  const drivingFixVersion = readDrivingFixVersion(fixVersions);
  const releaseDay = drivingFixVersion ? readCalendarDay(drivingFixVersion.releaseDate) : null;
  return releaseDay === null ? null : shiftCalendarDays(releaseDay, -TARGET_END_LEAD_DAYS);
}

/**
 * Applies the policy to one issue.
 *
 * Every returned date is either derivable from what Jira holds or null with a stated reason; the
 * mismatch list names only the fields a fix would actually change.
 */
export function deriveIssueDates(input: IssueDateInput): DerivedIssueDates {
  const undecidedReasons: string[] = [];
  const drivingFixVersion = readDrivingFixVersion(input.fixVersions);
  const releaseDay = drivingFixVersion ? readCalendarDay(drivingFixVersion.releaseDate) : null;
  if (releaseDay === null) {
    undecidedReasons.push('no unreleased fix version with a release date');
  }

  // The Ready-to-Work stamp IS an instant (a changelog entry), so it converts to a local day.
  // Target Start has two sources and they are not equals. Entering Working is the day work ACTUALLY
  // began, so it is the answer whenever it exists. Ready to Work only supports a prediction — three
  // days on — which is worth having until the fact arrives and worthless afterwards. Work that
  // jumped straight into Working, skipping Ready to Work entirely, had no source at all before this
  // and stayed permanently undated.
  const readyToWorkDay = readCalendarDay(input.readyToWorkEnteredIso);
  const workingDay = readCalendarDay(input.workingEnteredIso ?? null);
  if (readyToWorkDay === null && workingDay === null) {
    undecidedReasons.push(`not yet in ${READY_TO_WORK_STATUS_NAME} or ${WORKING_STATUS_NAME}`);
  }

  const dueDate = releaseDay;
  const targetEnd = releaseDay === null ? null : shiftCalendarDays(releaseDay, -TARGET_END_LEAD_DAYS);
  const { targetStart, targetStartBasis } = deriveTargetStart(input, workingDay, readyToWorkDay, targetEnd);

  const mismatchedFieldNames = [
    agreesWithDerived(input.currentDueDate, dueDate) ? null : 'Due Date',
    agreesWithDerived(input.currentTargetEnd, targetEnd) ? null : 'Target End',
    agreesWithDerived(input.currentTargetStart, targetStart) ? null : 'Target Start',
  ].filter((fieldName): fieldName is string => fieldName !== null);

  return { dueDate, targetStart, targetEnd, mismatchedFieldNames, undecidedReasons, targetStartBasis };
}
