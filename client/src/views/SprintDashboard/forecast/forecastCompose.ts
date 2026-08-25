// forecastCompose.ts — The one entry point. Every surface reads a slice of what this returns.
//
// That is the whole design, and it is structural rather than a rule anybody has to remember: there
// is exactly one exported function, so a surface that wanted a different number would have nowhere
// to get one. Two screens showing the same figure cannot disagree, because there is only one figure.
//
// Pure: no fetch, no storage, no clock. Everything it needs — the issues, the column order, the
// versions, the people, today's date — arrives as data. That is also what keeps it clear of the
// field-mapping boundary rule: it never resolves a Jira field, because it never sees one.

import { buildPiClock, buildReleaseClock } from './forecastWindows.ts';
import { assessCapacity } from './capacityLoad.ts';
import { assessFeatureSizing } from './featureSizing.ts';
import { classifyChainRole, scheduleDevSlChain } from './devSlChain.ts';
import { computeIssueForecasts } from './issueForecast.ts';
import { isInternalTestReady, rollUpFeatureIntReadiness } from './intReadiness.ts';
import { computeRemainingEffort } from './effortModel.ts';
import { resolveReleaseDates } from './releaseDateResolve.ts';
import type {
  CapacityAssessment,
  CapacityItem,
  CapacityPerson,
  ChainItem,
  FeatureDodAssessment,
  FixVersionLike,
  ForecastCompleteness,
  ForecastConfig,
  ForecastIssue,
  ForecastResult,
  IntReadinessInput,
  IssueForecastInput,
  PiClock,
  ReleaseClock,
  RemainingEffort,
} from './forecastTypes.ts';

/** The status name that takes an issue out of both the capacity sum and the Definition of Done. */
const CANCELLED_STATUS_NAME = 'cancelled';

/** Everything one forecast run needs, gathered by whichever surface is asking. */
export interface ForecastInput {
  /** The work in scope, already adapted into the shape the engine reads. */
  items: readonly ForecastIssue[];
  /** The team's own column order — the basis for how much credit in-flight work has earned. */
  orderedColumnIds: readonly string[];
  fixVersions: readonly FixVersionLike[];
  people: readonly CapacityPerson[];
  /** The ART's PI end date. Blank falls back to the date in the PI's own name. */
  piEndDate: string;
  /**
   * The selected PI's name, e.g. `PI 26.4 (07/30/26 - 10/07/26)`.
   *
   * The org writes the window into the name, so the PI clock works without anybody having filled in
   * an ART setting as well. Optional: absent and unconfigured, the clock honestly reports itself so.
   */
  piName?: string;
  /** False when this instance has no sub-status field, so INT readiness cannot be evaluated. */
  hasSubStatusField: boolean;
  /**
   * Each Feature's OWN estimate, which its children are measured against.
   *
   * The Feature is not among the items — those are the work delivering it — so its size has to
   * arrive separately. A surface that cannot supply it gets every Feature reported as NOT SIZED,
   * which is the honest answer rather than a comparison against nothing.
   */
  featurePointsByKey?: Record<string, number | null>;
  teamProfileId: string | null;
}

/** True when the issue has been cancelled — counted and named, never silently dropped. */
export function isItemCancelled(item: ForecastIssue): boolean {
  return item.statusName.trim().toLowerCase() === CANCELLED_STATUS_NAME;
}

/** True when nobody holds this issue, under either identity Jira might have given. */
export function isItemUnassigned(item: ForecastIssue): boolean {
  return item.assigneeAccountId === null && item.assigneeDisplayName === null;
}

/** Works out the remaining effort for every item, keyed by issue key so later stages can look it up. */
export function buildEffortByIssueKey(
  items: readonly ForecastIssue[],
  orderedColumnIds: readonly string[],
  config: ForecastConfig,
): Map<string, RemainingEffort> {
  const effortByIssueKey = new Map<string, RemainingEffort>();
  items.forEach((item) => {
    effortByIssueKey.set(item.key, computeRemainingEffort(
      item.storyPoints,
      item.columnId,
      orderedColumnIds,
      item.isComplete,
      config.pointsPerWorkingDay,
    ));
  });
  return effortByIssueKey;
}

/**
 * Builds one release clock per version that can actually be dated.
 *
 * A version nothing can date gets NO clock rather than a guessed one: its issues then have no
 * release deadline and are reported as unforecastable, which is the honest answer. Inventing a date
 * would have them reported as on track against a deadline nobody set.
 */
function buildReleaseClocks(
  resolutions: ReturnType<typeof resolveReleaseDates>,
  config: ForecastConfig,
): Record<string, ReleaseClock> {
  const clocksByVersionName: Record<string, ReleaseClock> = {};
  resolutions.forEach((resolution) => {
    if (resolution.resolvedDateIso !== null) {
      clocksByVersionName[resolution.versionName] = buildReleaseClock(resolution.resolvedDateIso, config);
    }
  });
  return clocksByVersionName;
}

/**
 * Picks the fix version that dates an issue: the earliest UNRELEASED one with a clock.
 *
 * Earliest because an issue tagged for two releases is committed to the first; dating it from the
 * later one hands the team weeks nobody granted.
 *
 * Unreleased because a shipped version's date is history, not a commitment. Measuring open work
 * against a release that already went out reports it as hopelessly late against a deadline nobody is
 * still working to — which is most of what a long-lived project's version list contains. This is the
 * same rule the date policy uses to choose a driving version, for the same reason.
 */
function readCodeFreezeDeadline(
  fixVersionNames: readonly string[],
  releaseClocksByVersionName: Record<string, ReleaseClock>,
  releasedVersionNames: ReadonlySet<string>,
): string | null {
  const codeFreezeDays = fixVersionNames
    .filter((versionName) => !releasedVersionNames.has(versionName))
    .map((versionName) => releaseClocksByVersionName[versionName]?.codeFreezeIso)
    .filter((codeFreezeIso): codeFreezeIso is string => typeof codeFreezeIso === 'string')
    .sort();
  return codeFreezeDays[0] ?? null;
}

/** Turns board items into the shape the per-issue forecast reads. */
function buildIssueForecastInputs(
  items: readonly ForecastIssue[],
  effortByIssueKey: Map<string, RemainingEffort>,
  releaseClocksByVersionName: Record<string, ReleaseClock>,
  piClock: PiClock,
  teamProfileId: string | null,
  releasedVersionNames: ReadonlySet<string>,
): IssueForecastInput[] {
  return items.map((item) => ({
    issueKey: item.key,
    summary: item.summary,
    // The issue's OWN team wins where the caller supplied one, including when it supplied null —
    // `??` would treat "known to be unattributable" as "not supplied" and relabel it with the run's
    // team, which is the bug this exists to fix.
    teamProfileId: item.teamProfileId !== undefined ? item.teamProfileId : teamProfileId,
    assigneeAccountId: item.assigneeAccountId,
    assigneeDisplayName: item.assigneeDisplayName,
    effort: effortByIssueKey.get(item.key) ?? computeRemainingEffort(null, item.columnId, [], false, 1),
    releaseDeadlineIso: readCodeFreezeDeadline(item.fixVersionNames, releaseClocksByVersionName, releasedVersionNames),
    piDeadlineIso: piClock.piEndIso,
    // Usually null: neither the board nor the hygiene scan fetches changelogs, which is the only
    // place the day work actually began is recorded. The bulk date fix, which does read one, is
    // where an actual start date enters the picture.
    actualStartIso: item.actualStartIso,
    storedTargetStartIso: item.storedTargetStartIso,
    isComplete: item.isComplete,
  }));
}

/** Reads the status pair the INT check needs off one adapted issue. */
function toIntReadinessInput(item: ForecastIssue, hasSubStatusField: boolean): IntReadinessInput {
  return { statusName: item.statusName, subStatusValue: item.subStatusValue, hasSubStatusField };
}

/**
 * Works out which constraint actually binds a Feature that will miss the PI.
 *
 * Dev is checked FIRST: when the dev work alone already overruns the increment, the test window was
 * never the limiting factor, and telling a team to find more testers would be the wrong advice.
 */
function readRiskCause(
  devCompleteIso: string | null,
  dodDateIso: string | null,
  piEndIso: string,
): FeatureDodAssessment['riskCause'] {
  if (devCompleteIso !== null && devCompleteIso > piEndIso) {
    return 'dev-too-large';
  }
  if (dodDateIso !== null && dodDateIso > piEndIso) {
    return 'test-squeeze';
  }
  return null;
}

/**
 * Assesses one Feature: where its work has got to, when it can reach Integration Test, and whether
 * that lands inside the PI.
 */
function assessFeature(
  featureKey: string,
  children: readonly ForecastIssue[],
  effortByIssueKey: Map<string, RemainingEffort>,
  piClock: PiClock,
  input: ForecastInput,
  config: ForecastConfig,
): FeatureDodAssessment {
  const readiness = rollUpFeatureIntReadiness(
    featureKey,
    children.map((child) => ({ issueKey: child.key, ...toIntReadinessInput(child, input.hasSubStatusField) })),
  );

  const chainItems: ChainItem[] = children
    .filter((child) => !isItemCancelled(child))
    .map((child) => ({
      issueKey: child.key,
      summary: child.summary,
      role: classifyChainRole({
        summary: child.summary,
        // The roster capability is a secondary signal the board cannot supply per issue, so the
        // prefix carries this on its own here and unprefixed work is reported as unclassified.
        assigneeCanInternalTest: null,
      }),
      remainingWorkingDays: effortByIssueKey.get(child.key)?.remainingWorkingDays ?? null,
      isInternalTestReady: isInternalTestReady(toIntReadinessInput(child, input.hasSubStatusField)),
      isComplete: child.isComplete,
    }));

  const schedule = scheduleDevSlChain(chainItems, config.todayIso, config);

  const piVerdict: FeatureDodAssessment['piVerdict'] = !piClock.isConfigured || piClock.piEndIso === null
    ? 'not-configured'
    : schedule.dodDateIso !== null && schedule.dodDateIso <= piClock.piEndIso ? 'meets' : 'at-risk';

  return {
    featureKey,
    intReadyState: readiness.state,
    blockingIssueKeys: readiness.blockingIssueKeys,
    cancelledIssueKeys: readiness.cancelledIssueKeys,
    devCompleteIso: schedule.devCompleteIso,
    slStartIso: schedule.slStartIso,
    slWorkingDays: schedule.slWorkingDays,
    dodDateIso: schedule.dodDateIso,
    hasNoSlStory: schedule.hasNoSlStory,
    unclassifiedIssueKeys: schedule.unclassifiedIssueKeys,
    piVerdict,
    riskCause: piClock.piEndIso === null
      ? null
      : readRiskCause(schedule.devCompleteIso, schedule.dodDateIso, piClock.piEndIso),
    shortfallWorkingDays: null,
  };
}

/** Groups the work by the Feature it delivers, keeping first-seen Feature order. */
function groupByFeatureKey(items: readonly ForecastIssue[]): Map<string, ForecastIssue[]> {
  const byFeatureKey = new Map<string, ForecastIssue[]>();
  items.forEach((item) => {
    if (item.featureKey === null) {
      return;
    }
    const existing = byFeatureKey.get(item.featureKey) ?? [];
    existing.push(item);
    byFeatureKey.set(item.featureKey, existing);
  });
  return byFeatureKey;
}

/**
 * Turns board work into the shape a capacity sum reads, marking which of it is in this release.
 *
 * Every issue is included, not only the ones on the chosen version: a person's TOTAL load is part of
 * the answer, or somebody looks free while drowning in another release.
 */
function buildCapacityItems(
  items: readonly ForecastIssue[],
  effortByIssueKey: Map<string, RemainingEffort>,
  /**
   * The version whose work counts as in scope, or null for the WHOLE scope.
   *
   * Null is the PI lens: a PI spans several releases, and asking "can this team reach INT by the end
   * of the PI" is a question about all of that work at once, not about any one ship date.
   */
  inScopeVersionName: string | null,
): CapacityItem[] {
  return items.map((item) => {
    const effort = effortByIssueKey.get(item.key);
    return {
      issueKey: item.key,
      // The account id where Jira gave one, the display name otherwise — the same identity the
      // roster is matched on.
      assigneePersonKey: item.assigneeAccountId ?? item.assigneeDisplayName,
      remainingWorkingDays: effort?.remainingWorkingDays ?? null,
      isEstimated: effort?.isEstimated ?? false,
      isInScope: inScopeVersionName === null || item.fixVersionNames.includes(inScopeVersionName),
      chainRole: classifyChainRole({ summary: item.summary, assigneeCanInternalTest: null }),
    };
  });
}

/** Assesses one window per release, for one population. */
function buildCapacityByVersion(
  releaseClocksByVersionName: Record<string, ReleaseClock>,
  windowOf: (clock: ReleaseClock) => ReleaseClock['toCodeFreeze'],
  roleFilter: 'dev' | 'test',
  input: ForecastInput,
  effortByIssueKey: Map<string, RemainingEffort>,
  undatedIssueCount: number,
): Record<string, CapacityAssessment> {
  const assessmentsByVersionName: Record<string, CapacityAssessment> = {};
  Object.entries(releaseClocksByVersionName).forEach(([versionName, clock]) => {
    assessmentsByVersionName[versionName] = assessCapacity(
      buildCapacityItems(input.items, effortByIssueKey, versionName),
      input.people,
      windowOf(clock),
      { roleFilter, undatedIssueCount },
    );
  });
  return assessmentsByVersionName;
}

/** Tallies everything a total could otherwise have omitted without saying so. */
function buildCompleteness(
  items: readonly ForecastIssue[],
  effortByIssueKey: Map<string, RemainingEffort>,
  undatedVersionCount: number,
  input: ForecastInput,
): ForecastCompleteness {
  return {
    totalIssueCount: items.length,
    unsizedIssueCount: items.filter((item) => effortByIssueKey.get(item.key)?.isEstimated === false).length,
    unassignedIssueCount: items.filter((item) => isItemUnassigned(item)).length,
    undatedVersionCount,
    cancelledIssueCount: items.filter((item) => isItemCancelled(item)).length,
    hasSubStatusField: input.hasSubStatusField,
    // A single column says nothing about progress, so it is treated the same as none: every item
    // carries full size, and the record says why rather than leaving a reader to wonder.
    hasBoardVocabulary: input.orderedColumnIds.length > 1,
  };
}

/**
 * Produces the whole forecast: the clocks, the release dates, and the honesty record.
 *
 * The per-issue verdicts, Feature assessments, sizing flags and capacity assessments are filled in
 * by the stages that own them; they start empty so that a surface which only needs the clocks does
 * not pay for the rest.
 */
export function computeForecast(input: ForecastInput, config: ForecastConfig): ForecastResult {
  const releaseDateResolutions = resolveReleaseDates(input.fixVersions);
  const effortByIssueKey = buildEffortByIssueKey(input.items, input.orderedColumnIds, config);
  const undatedVersionCount = releaseDateResolutions
    .filter((resolution) => resolution.resolvedDateIso === null).length;

  const piClock = buildPiClock(input.piEndDate, config, input.piName ?? '');
  const releaseClocksByVersionName = buildReleaseClocks(releaseDateResolutions, config);

  // Cancelled work is excluded from every verdict, and counted in the completeness record instead:
  // dropping it silently would make a Feature look finished because its remaining work was killed.
  const forecastableItems = input.items.filter((item) => !isItemCancelled(item));
  // A shipped version's date is history, not a commitment. Work still open against one is not late
  // for it — nobody is working to that date any more.
  const releasedVersionNames = new Set(
    releaseDateResolutions.filter((resolution) => resolution.isReleased).map((resolution) => resolution.versionName),
  );

  return {
    config,
    rejectedSettings: [],
    piClock,
    releaseClocksByVersionName,
    releaseDateResolutions,
    issueForecasts: computeIssueForecasts(
      buildIssueForecastInputs(
        forecastableItems, effortByIssueKey, releaseClocksByVersionName, piClock, input.teamProfileId, releasedVersionNames,
      ),
      config,
    ),
    featureAssessments: [...groupByFeatureKey(input.items).entries()].map(
      ([featureKey, children]) => assessFeature(featureKey, children, effortByIssueKey, piClock, input, config),
    ),
    sizingFlags: [...groupByFeatureKey(input.items).entries()].map(([featureKey, children]) => assessFeatureSizing(
      featureKey,
      input.featurePointsByKey?.[featureKey] ?? null,
      children.map((child) => ({
        issueKey: child.key,
        typeBucket: child.typeBucket,
        storyPoints: child.storyPoints,
      })),
      config.featureSizingTolerancePercent,
    )),
    codeFreezeCapacityByVersionName: buildCapacityByVersion(
      releaseClocksByVersionName,
      (clock) => clock.toCodeFreeze,
      'dev',
      { ...input, items: forecastableItems },
      effortByIssueKey,
      undatedVersionCount,
    ),
    // The DEPLOY BUFFER window is deliberately never assessed: the last week before a release
    // carries no test capacity by definition, so scheduling into it would invent runway.
    externalTestCapacityByVersionName: buildCapacityByVersion(
      releaseClocksByVersionName,
      (clock) => clock.externalTest,
      'test',
      { ...input, items: forecastableItems },
      effortByIssueKey,
      undatedVersionCount,
    ),
    // The PI lens: the whole scope, every version at once, against the days left in the PI. Built
    // from the SAME assessCapacity as the release clocks, so the two can never disagree about how
    // much work a person is holding — only about which window they are being measured against.
    piCapacity: piClock.toPiEnd === null ? null : assessCapacity(
      buildCapacityItems(forecastableItems, effortByIssueKey, null),
      input.people,
      piClock.toPiEnd,
      { roleFilter: 'all', undatedIssueCount: undatedVersionCount },
    ),
    completeness: buildCompleteness(input.items, effortByIssueKey, undatedVersionCount, input),
  };
}
