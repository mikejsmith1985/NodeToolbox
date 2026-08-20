// derivedDateForecastContext.ts — Hands the bulk date fix the effort figures it cannot work out.
//
// The date policy knows what a Target Start SHOULD be given the effort left in an issue; it has no
// way to find that effort, because it is pure and sees only one issue at a time. This builds the
// context that closes the gap, from the same adapters and the same settings every other forecast
// surface uses — so a date written from Feature Review and a verdict shown on Today are computed
// from one arithmetic rather than two that currently agree.
//
// Neither the Hygiene page nor Feature Review has board columns, so every issue is charged at full
// size here. That is the conservative direction: it can only ever pull a Target Start earlier, never
// later, so no date it produces claims more runway than the team actually has.

import { readArtSettings } from '../../../services/artSettingsStore.ts';
import { toCalendarDay } from '../../../utils/calendarDate.ts';
import { adaptHygieneIssues, type JiraIssueLike, type TodayAdapterFieldIds } from './forecastAdapters.ts';
import { buildForecastConfig } from './forecastSettings.ts';
import { computeRemainingEffort } from './effortModel.ts';

/** What the bulk date fix needs beyond the issues themselves. */
export interface DerivedDateForecastContext {
  remainingEffortWorkingDaysByKey: Record<string, number | null>;
  piDodDeadlineIso: string | null;
  workingCalendar: { weekendDays: number[]; holidayIsoDates: string[] };
}

/**
 * Works out how many working days of work each issue has left, for the bulk date fix.
 *
 * Returns a map rather than a list so the fix can look an issue up by key and fall back to its old
 * rule for anything absent — which is what lets a caller pass a partial context without a special
 * case for the gaps.
 */
export function buildDerivedDateForecastContext(
  issues: readonly JiraIssueLike[],
  fieldIds: TodayAdapterFieldIds,
  nowInstant: Date = new Date(),
): DerivedDateForecastContext {
  const artSettings = readArtSettings();
  const { config } = buildForecastConfig(artSettings, toCalendarDay(nowInstant));

  const remainingEffortWorkingDaysByKey: Record<string, number | null> = {};
  adaptHygieneIssues(issues, fieldIds).forEach((issue) => {
    // No column order, so no credit: every issue is charged at full size. Conservative by design —
    // it can only pull a Target Start earlier, never later.
    const effort = computeRemainingEffort(
      issue.storyPoints,
      issue.columnId,
      [],
      issue.isComplete,
      config.pointsPerWorkingDay,
    );
    remainingEffortWorkingDaysByKey[issue.key] = effort.remainingWorkingDays;
  });

  return {
    remainingEffortWorkingDaysByKey,
    // Blank means the ART has not configured a PI end. The policy then measures against code freeze
    // alone rather than inventing a second deadline.
    piDodDeadlineIso: artSettings.piEndDate.trim() === '' ? null : artSettings.piEndDate.slice(0, 10),
    workingCalendar: config.calendar,
  };
}

/** Wording for each rule, so a run can say what it did rather than only how much. */
const BASIS_LABELS: Record<string, string> = {
  'actual-working': 'from the day work began',
  'back-calculated': 'worked back from the effort left',
  'ready-to-work-lead': 'from the day it became workable',
};

/**
 * Describes how the Target Starts in a run were arrived at.
 *
 * "Updated 16" tells an operator nothing about whether those dates are a plan or a placeholder. A
 * date worked back from real effort and one set three days after an issue became workable mean very
 * different things to somebody deciding whether to trust the schedule.
 */
export function describeTargetStartBases(basisCounts: Record<string, number>): string {
  const described = Object.entries(basisCounts)
    .filter(([, count]) => count > 0)
    .map(([basis, count]) => `${count} ${BASIS_LABELS[basis] ?? basis}`);
  return described.length === 0 ? '' : ` Target Start: ${described.join(', ')}.`;
}
