// issueForecast.ts — The last day this can start and still land, and whether that day has passed.
//
// This module produces the sentence the whole feature exists for: "if these issues don't start
// today we will be behind." Everything else supports it.
//
// The state precedence is the load-bearing part, and it is ordered by what a reader would be
// misled into doing:
//
//   • UNSIZED comes first because every other verdict is computed FROM a size. Reporting
//     unmeasured work as on track is false comfort that looks identical to the real thing.
//   • CANNOT-FIT and BEHIND must differ in KIND, not merely in degree. Comparing remaining effort
//     against days remaining would have produced exactly the same condition as a latest start in
//     the past, leaving one of the two unreachable. So behind means the runway is gone but the
//     deadline is still ahead — start it now and it lands late by the slack figure — while
//     cannot-fit means the deadline itself has passed, and "start it" is not even advice.
//   • A STARTED issue is never behind, however long it is running. Behind means not started and out
//     of runway; work that is under way and slipping shows as negative slack instead.

import { subtractWorkingDays, workingDaysBetween } from '../../../utils/workingDays.ts';
import type { ForecastConfig, IssueForecast, IssueForecastInput, IssueForecastState } from './forecastTypes.ts';

/** Which deadline binds, and which clock it came from. */
interface DrivingDeadline {
  deadlineIso: string | null;
  clock: IssueForecast['drivingClock'];
}

/**
 * Picks the deadline that actually binds: the EARLIER of the two clocks.
 *
 * A tie resolves to the release clock, because that is the one the team operates on day to day and
 * the one whose date they will recognise.
 */
function readDrivingDeadline(input: IssueForecastInput): DrivingDeadline {
  const { releaseDeadlineIso, piDeadlineIso } = input;
  if (releaseDeadlineIso === null && piDeadlineIso === null) {
    return { deadlineIso: null, clock: 'none' };
  }
  if (piDeadlineIso === null) {
    return { deadlineIso: releaseDeadlineIso, clock: 'release' };
  }
  if (releaseDeadlineIso === null) {
    return { deadlineIso: piDeadlineIso, clock: 'pi' };
  }
  return releaseDeadlineIso <= piDeadlineIso
    ? { deadlineIso: releaseDeadlineIso, clock: 'release' }
    : { deadlineIso: piDeadlineIso, clock: 'pi' };
}

/**
 * The last working day work can begin and still finish by the deadline.
 *
 * The `- 1` makes the span inclusive of its own start day: one day of work due today starts today,
 * not yesterday. That mirrors how the forward direction already computes a span end.
 */
function readLatestStart(
  deadlineIso: string,
  remainingWorkingDays: number,
  config: ForecastConfig,
): string {
  return subtractWorkingDays(deadlineIso, Math.max(0, remainingWorkingDays - 1), config.calendar);
}

/** Working days from today to a day, negative once that day has passed. */
function readSlack(todayIso: string, targetIso: string, config: ForecastConfig): number {
  return targetIso >= todayIso
    ? workingDaysBetween(todayIso, targetIso, config.calendar)
    : -workingDaysBetween(targetIso, todayIso, config.calendar);
}

/**
 * True when there is no runway left at all — the deadline itself has passed.
 *
 * This is the ONLY case that is genuinely different in kind from being behind. Comparing remaining
 * effort against the days left would have produced exactly the same condition as a latest start in
 * the past, which would make one of the two states unreachable and tell a reader nothing new.
 *
 * The two now say different things and ask for different responses: behind means start it now and
 * it lands late by the slack figure; no runway means "start it" is not even advice, because the day
 * it was due for has already gone.
 */
function hasNoRunwayLeft(todayIso: string, deadlineIso: string, remainingWorkingDays: number): boolean {
  return deadlineIso < todayIso && remainingWorkingDays > 0;
}

/** Applies the precedence, returning the one state that describes this issue. */
function readState(
  input: IssueForecastInput,
  driving: DrivingDeadline,
  latestStartIso: string | null,
  config: ForecastConfig,
): IssueForecastState {
  if (!input.effort.isEstimated) {
    return 'unsized';
  }
  if (driving.deadlineIso === null || latestStartIso === null) {
    return 'unforecastable';
  }

  const remainingWorkingDays = input.effort.remainingWorkingDays ?? 0;
  // Nothing left to do means nothing left to be late with. Without this, a finished issue whose
  // deadline has since passed reads as BEHIND — which would put completed work at the top of a list
  // headed "start these today".
  if (remainingWorkingDays === 0) {
    return 'on-track';
  }
  if (hasNoRunwayLeft(config.todayIso, driving.deadlineIso, remainingWorkingDays)) {
    return 'cannot-fit';
  }
  if (input.assigneeAccountId === null && input.assigneeDisplayName === null) {
    return 'unassignable';
  }
  // Only unstarted work can be BEHIND: the verdict means nobody has begun and the runway is gone.
  if (latestStartIso < config.todayIso && input.actualStartIso === null) {
    return 'behind';
  }
  if (latestStartIso === config.todayIso && input.actualStartIso === null) {
    return 'start-today';
  }
  if (input.actualStartIso !== null && input.actualStartIso < latestStartIso) {
    return 'ahead';
  }
  return 'on-track';
}

/** Writes the one sentence a person can act on, naming the arithmetic behind the verdict. */
function describeReason(
  input: IssueForecastInput,
  driving: DrivingDeadline,
  latestStartIso: string | null,
  state: IssueForecastState,
  slackWorkingDays: number | null,
): string {
  const remainingWorkingDays = input.effort.remainingWorkingDays ?? 0;
  const clockLabel = driving.clock === 'pi' ? 'PI end' : 'code freeze';
  const deadlineLabel = `${clockLabel} ${driving.deadlineIso ?? 'unknown'}`;

  switch (state) {
    case 'unsized':
      return 'No estimate — cannot forecast, and excluded from every total rather than guessed at';
    case 'unforecastable':
      return 'No release date and no PI end date — there is nothing to measure against';
    case 'cannot-fit':
      return `${remainingWorkingDays} working days of work left and ${deadlineLabel} has already passed`
        + ' — no start date can recover this';
    case 'unassignable':
      return `${remainingWorkingDays} working days of work left, but nobody holds it`;
    case 'behind':
      return `${remainingWorkingDays} working days of work left before ${deadlineLabel}`
        + ` — should have started ${latestStartIso}, which was ${Math.abs(slackWorkingDays ?? 0)} working days ago`;
    case 'start-today':
      return `${remainingWorkingDays} working days of work left before ${deadlineLabel} — last day to start`;
    case 'ahead':
      return `Started ${input.actualStartIso}, ahead of the ${latestStartIso} it had to begin`;
    default:
      return `${remainingWorkingDays} working days of work left before ${deadlineLabel}`
        + ` — can start as late as ${latestStartIso}`;
  }
}

/** Works out one issue's verdict: when it must start, whether that has passed, and why. */
export function computeIssueForecast(input: IssueForecastInput, config: ForecastConfig): IssueForecast {
  const driving = readDrivingDeadline(input);
  const remainingWorkingDays = input.effort.remainingWorkingDays;

  const latestStartIso = driving.deadlineIso !== null && remainingWorkingDays !== null
    ? readLatestStart(driving.deadlineIso, remainingWorkingDays, config)
    : null;

  const state = readState(input, driving, latestStartIso, config);
  const slackWorkingDays = latestStartIso === null
    ? null
    : readSlack(config.todayIso, latestStartIso, config);

  return {
    issueKey: input.issueKey,
    summary: input.summary,
    teamProfileId: input.teamProfileId,
    assigneeDisplayName: input.assigneeDisplayName,
    assigneeAccountId: input.assigneeAccountId,
    effort: input.effort,
    releaseDeadlineIso: input.releaseDeadlineIso,
    piDeadlineIso: input.piDeadlineIso,
    drivingDeadlineIso: driving.deadlineIso,
    drivingClock: driving.clock,
    // An unsized issue carries no start date: inventing one would let unmeasured work be planned.
    latestStartIso: state === 'unsized' ? null : latestStartIso,
    actualStartIso: input.actualStartIso,
    state,
    slackWorkingDays: state === 'unsized' ? null : slackWorkingDays,
    storedTargetStartIso: input.storedTargetStartIso,
    // Reported, never corrected. Correcting a date is the operator's explicit action.
    hasStoredDateDisagreement: input.storedTargetStartIso !== null
      && latestStartIso !== null
      && state !== 'unsized'
      && input.storedTargetStartIso.slice(0, 10) !== latestStartIso,
    reason: describeReason(input, driving, latestStartIso, state, slackWorkingDays),
  };
}

/** Works out every issue's verdict, preserving order and each issue's team attribution. */
export function computeIssueForecasts(
  inputs: readonly IssueForecastInput[],
  config: ForecastConfig,
): IssueForecast[] {
  return inputs.map((input) => computeIssueForecast(input, config));
}
