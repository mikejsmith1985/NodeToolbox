// forecastCompose.ts — The one entry point. Every surface reads a slice of what this returns.
//
// That is the whole design, and it is structural rather than a rule anybody has to remember: there
// is exactly one exported function, so a surface that wanted a different number would have nowhere
// to get one. Two screens showing the same figure cannot disagree, because there is only one figure.
//
// Pure: no fetch, no storage, no clock. Everything it needs — the issues, the column order, the
// versions, the people, today's date — arrives as data. That is also what keeps it clear of the
// field-mapping boundary rule: it never resolves a Jira field, because it never sees one.

import type { MasterCard, RollupBoardItem } from '../rollupBoard/rollupBoardTypes.ts';
import { buildPiClock, buildReleaseClock } from './forecastWindows.ts';
import { computeIssueForecasts } from './issueForecast.ts';
import { computeRemainingEffort } from './effortModel.ts';
import { resolveReleaseDates } from './releaseDateResolve.ts';
import type {
  CapacityPerson,
  FixVersionLike,
  ForecastCompleteness,
  ForecastConfig,
  ForecastResult,
  IssueForecastInput,
  PiClock,
  ReleaseClock,
  RemainingEffort,
} from './forecastTypes.ts';

/** The status name that takes an issue out of both the capacity sum and the Definition of Done. */
const CANCELLED_STATUS_NAME = 'cancelled';

/** Jira status-category names that mean the work is finished. */
const DONE_STATUS_CATEGORY_NAMES = new Set(['done', 'complete', 'completed']);

/** Everything one forecast run needs, gathered by whichever surface is asking. */
export interface ForecastInput {
  items: readonly RollupBoardItem[];
  masterCards: readonly MasterCard[];
  /** The team's own column order — the basis for how much credit in-flight work has earned. */
  orderedColumnIds: readonly string[];
  fixVersions: readonly FixVersionLike[];
  people: readonly CapacityPerson[];
  /** The ART's PI end date. Blank means the PI clock reports itself unconfigured. */
  piEndDate: string;
  /** False when this instance has no sub-status field, so INT readiness cannot be evaluated. */
  hasSubStatusField: boolean;
  teamProfileId: string | null;
}

/** True when Jira's own status category says this issue is finished. */
export function isItemComplete(item: RollupBoardItem): boolean {
  const statusField = (item.issue.fields as { status?: { statusCategory?: { name?: string }; name?: string } }).status;
  const statusCategoryName = (statusField?.statusCategory?.name ?? statusField?.name ?? '').trim().toLowerCase();
  return DONE_STATUS_CATEGORY_NAMES.has(statusCategoryName);
}

/** True when the issue has been cancelled — counted and named, never silently dropped. */
export function isItemCancelled(item: RollupBoardItem): boolean {
  return item.statusName.trim().toLowerCase() === CANCELLED_STATUS_NAME;
}

/** True when nobody holds this issue, under either identity Jira might have given. */
export function isItemUnassigned(item: RollupBoardItem): boolean {
  return item.assigneeAccountId === null && item.assigneeDisplayName === null;
}

/** Works out the remaining effort for every item, keyed by issue key so later stages can look it up. */
export function buildEffortByIssueKey(
  items: readonly RollupBoardItem[],
  orderedColumnIds: readonly string[],
  config: ForecastConfig,
): Map<string, RemainingEffort> {
  const effortByIssueKey = new Map<string, RemainingEffort>();
  items.forEach((item) => {
    effortByIssueKey.set(item.key, computeRemainingEffort(
      item.storyPoints,
      item.columnId,
      orderedColumnIds,
      isItemComplete(item),
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
 * Picks the fix version that dates an issue: the EARLIEST one with a clock.
 *
 * Earliest because an issue tagged for two releases is committed to the first; dating it from the
 * later one hands the team weeks nobody granted. This mirrors the date policy's own rule, which
 * chooses the earliest unreleased dated version for exactly that reason.
 */
function readCodeFreezeDeadline(
  fixVersionNames: readonly string[],
  releaseClocksByVersionName: Record<string, ReleaseClock>,
): string | null {
  const codeFreezeDays = fixVersionNames
    .map((versionName) => releaseClocksByVersionName[versionName]?.codeFreezeIso)
    .filter((codeFreezeIso): codeFreezeIso is string => typeof codeFreezeIso === 'string')
    .sort();
  return codeFreezeDays[0] ?? null;
}

/** Turns board items into the shape the per-issue forecast reads. */
function buildIssueForecastInputs(
  items: readonly RollupBoardItem[],
  effortByIssueKey: Map<string, RemainingEffort>,
  releaseClocksByVersionName: Record<string, ReleaseClock>,
  piClock: PiClock,
  teamProfileId: string | null,
): IssueForecastInput[] {
  return items.map((item) => ({
    issueKey: item.key,
    summary: item.summary,
    teamProfileId,
    assigneeAccountId: item.assigneeAccountId,
    assigneeDisplayName: item.assigneeDisplayName,
    effort: effortByIssueKey.get(item.key) ?? computeRemainingEffort(null, item.columnId, [], false, 1),
    releaseDeadlineIso: readCodeFreezeDeadline(item.fixVersionNames, releaseClocksByVersionName),
    piDeadlineIso: piClock.piEndIso,
    // The board does not fetch changelogs, so the day work actually began is not available here.
    // The bulk date fix, which does read the changelog, supplies it on the write path instead.
    actualStartIso: null,
    storedTargetStartIso: null,
    isComplete: isItemComplete(item),
  }));
}

/** Tallies everything a total could otherwise have omitted without saying so. */
function buildCompleteness(
  items: readonly RollupBoardItem[],
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

  const piClock = buildPiClock(input.piEndDate, config);
  const releaseClocksByVersionName = buildReleaseClocks(releaseDateResolutions, config);

  // Cancelled work is excluded from every verdict, and counted in the completeness record instead:
  // dropping it silently would make a Feature look finished because its remaining work was killed.
  const forecastableItems = input.items.filter((item) => !isItemCancelled(item));

  return {
    config,
    rejectedSettings: [],
    piClock,
    releaseClocksByVersionName,
    releaseDateResolutions,
    issueForecasts: computeIssueForecasts(
      buildIssueForecastInputs(forecastableItems, effortByIssueKey, releaseClocksByVersionName, piClock, input.teamProfileId),
      config,
    ),
    featureAssessments: [],
    sizingFlags: [],
    codeFreezeCapacityByVersionName: {},
    externalTestCapacityByVersionName: {},
    completeness: buildCompleteness(input.items, effortByIssueKey, undatedVersionCount, input),
  };
}
