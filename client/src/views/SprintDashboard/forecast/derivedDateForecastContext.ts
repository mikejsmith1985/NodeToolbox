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

import { readArtSettings, readRawForecastSettings } from '../../../services/artSettingsStore.ts';
import { toCalendarDay } from '../../../utils/calendarDate.ts';
import { adaptHygieneIssues, type JiraIssueLike, type TodayAdapterFieldIds } from './forecastAdapters.ts';
import { buildForecastConfig } from './forecastSettings.ts';
import { computeRemainingEffort } from './effortModel.ts';
import { buildChainTargetStarts } from './chainTargetStart.ts';
import { classifyChainRole } from './devSlChain.ts';
import { isInternalTestReady } from './intReadiness.ts';
import { readCodeFreezeDeadline, type IssueFixVersion } from '../../Hygiene/checks/issueDateRules.ts';
import type { ChainItem, ForecastIssue } from './forecastTypes.ts';

/** What the bulk date fix needs beyond the issues themselves. */
export interface DerivedDateForecastContext {
  remainingEffortWorkingDaysByKey: Record<string, number | null>;
  /**
   * The day each issue has to start for its Feature's whole chain to make code freeze.
   *
   * Empty for any Feature holding unsized work, and for every caller that does not resolve Feature
   * links — a chain nobody can see is not a chain this can schedule.
   */
  chainTargetStartByKey: Record<string, string>;
  piDodDeadlineIso: string | null;
  workingCalendar: { weekendDays: number[]; holidayIsoDates: string[] };
}

/**
 * The day a Feature's work has to be FINISHED by: code freeze, three weeks before its release.
 *
 * Read from the earliest deadline any of its issues carries. Where two issues in one Feature name
 * different releases, the earlier one binds -- a Feature is not delivered until all of it is.
 */
function readFeatureDeadlineIso(issues: readonly JiraIssueLike[]): string | null {
  const deadlines = issues
    .map((issue) => readCodeFreezeDeadline(
      ((issue.fields as { fixVersions?: unknown }).fixVersions ?? []) as IssueFixVersion[],
    ))
    .filter((deadline): deadline is string => deadline !== null)
    .sort();
  return deadlines[0] ?? null;
}

/** Turns one adapted issue into the chain's own vocabulary: which side it is on, and what is left. */
function toChainItem(
  issue: ForecastIssue,
  remainingWorkingDays: number | null,
  hasSubStatusField: boolean,
): ChainItem {
  return {
    issueKey: issue.key,
    summary: issue.summary,
    // No roster here, so the summary prefix is the only signal. Anything without one is reported as
    // unclassified and scheduled as dev, which is the side that has to finish first.
    role: classifyChainRole({ summary: issue.summary, assigneeCanInternalTest: null }),
    remainingWorkingDays,
    isInternalTestReady: hasSubStatusField && isInternalTestReady({
      statusName: issue.statusName,
      subStatusValue: issue.subStatusValue,
      hasSubStatusField,
    }),
    isComplete: issue.isComplete,
  };
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
  const { config } = buildForecastConfig(readRawForecastSettings(), toCalendarDay(nowInstant));

  const adaptedIssues = adaptHygieneIssues(issues, fieldIds);
  const remainingEffortWorkingDaysByKey: Record<string, number | null> = {};
  adaptedIssues.forEach((issue) => {
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

  /*
   * The chain, one Feature at a time.
   *
   * An issue's own effort is not what decides when it has to start: a dev story with a week of SL
   * testing behind it, and two days of handover between them, has to begin far earlier than its own
   * size suggests. That is only visible across a Feature's whole set of issues, which is why it is
   * worked out here rather than in the per-issue date policy.
   */
  const hasSubStatusField = (fieldIds.subStatusFieldIds ?? []).length > 0;
  const issuesByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const adaptedByFeatureKey = new Map<string, ForecastIssue[]>();
  adaptedIssues.forEach((issue) => {
    if (issue.featureKey === null) {
      return;
    }
    const existing = adaptedByFeatureKey.get(issue.featureKey);
    if (existing) {
      existing.push(issue);
    } else {
      adaptedByFeatureKey.set(issue.featureKey, [issue]);
    }
  });

  const chainTargetStartByKey: Record<string, string> = {};
  adaptedByFeatureKey.forEach((featureIssues) => {
    const rawIssues = featureIssues
      .map((issue) => issuesByKey.get(issue.key))
      .filter((issue): issue is JiraIssueLike => issue !== undefined);
    const chainItems = featureIssues.map((issue) => toChainItem(
      issue,
      remainingEffortWorkingDaysByKey[issue.key] ?? null,
      hasSubStatusField,
    ));
    const chain = buildChainTargetStarts(chainItems, readFeatureDeadlineIso(rawIssues), config.calendar);
    Object.assign(chainTargetStartByKey, chain.targetStartByIssueKey);
  });

  return {
    remainingEffortWorkingDaysByKey,
    chainTargetStartByKey,
    // Blank means the ART has not configured a PI end. The policy then measures against code freeze
    // alone rather than inventing a second deadline.
    piDodDeadlineIso: artSettings.piEndDate.trim() === '' ? null : artSettings.piEndDate.slice(0, 10),
    workingCalendar: config.calendar,
  };
}

/** Wording for each rule, so a run can say what it did rather than only how much. */
const BASIS_LABELS: Record<string, string> = {
  'actual-working': 'from the day work began',
  'chain-back-calculated': 'worked back through the DEV → SL chain',
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
