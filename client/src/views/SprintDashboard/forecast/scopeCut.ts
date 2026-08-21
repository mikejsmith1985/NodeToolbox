// scopeCut.ts — If this release does not fit, what comes out of it?
//
// A shortfall on its own is not actionable. "Short by 22 working days" tells a Scrum Master they
// have a problem and leaves them to work out the answer in a spreadsheet, which is the part that
// actually takes the morning.
//
// So this names the specific work to drop, and it does it by the team's OWN priority order — the
// rank they already set by dragging lanes on the Roll-Up Board. Nothing here invents a priority:
// the lowest-ranked Feature's work is the first suggested out, because that is what the team already
// said mattered least. Anything else would be this tool second-guessing a decision it did not make.

import type { ForecastResult, IssueForecast } from './forecastTypes.ts';

/** One issue proposed for removal, with everything needed to defend the suggestion. */
export interface ScopeCutCandidate {
  issueKey: string;
  summary: string;
  featureKey: string | null;
  /** The Feature's position on the board, counting from 1. Higher means lower priority. */
  featureRank: number | null;
  assigneeDisplayName: string | null;
  remainingWorkingDays: number;
  state: IssueForecast['state'];
  /** Days still to find AFTER this item comes out — reaches zero on the last one needed. */
  remainingShortfallWorkingDays: number;
}

/** What removing the proposed work would achieve, and what it would not. */
export interface ScopeCutPlan {
  shortfallWorkingDays: number;
  candidates: ScopeCutCandidate[];
  /** Days the proposal recovers. Less than the shortfall when there is not enough droppable work. */
  recoveredWorkingDays: number;
  /** True when dropping every candidate still leaves the release short. */
  isStillShortAfterCut: boolean;
  /** Work that cannot be weighed because nobody sized it — named, never silently skipped. */
  unsizedIssueKeys: string[];
}

/** Where a Feature sits in the team's own ordering, and which Features have no place in it. */
export interface FeatureRankLookup {
  /** Feature key → rank, counting from 1, in the order the board draws its lanes. */
  rankByFeatureKey: Record<string, number>;
}

/** The states worth proposing for removal — work that is late or cannot be owned. */
const CUTTABLE_STATES: ReadonlySet<IssueForecast['state']> = new Set([
  'behind',
  'start-today',
  'cannot-fit',
  'unassignable',
  'on-track',
  'ahead',
]);

/**
 * Sorts the droppable work worst-priority-first.
 *
 * Lowest board rank first, because that is the team's own statement about what matters least. Within
 * one Feature the largest item goes first: recovering a shortfall in the fewest cuts disrupts the
 * fewest people.
 *
 * A Feature with no rank sorts LAST rather than first. An unranked Feature is one the board has not
 * been told about, and proposing it for removal on the strength of a gap in configuration would be
 * the tool inventing a priority it was never given.
 */
function compareCutOrder(
  left: ScopeCutCandidate,
  right: ScopeCutCandidate,
): number {
  const leftRank = left.featureRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.featureRank ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) {
    // Descending: the LOWEST-priority lane (highest rank number) is proposed first.
    return rightRank - leftRank;
  }
  if (right.remainingWorkingDays !== left.remainingWorkingDays) {
    return right.remainingWorkingDays - left.remainingWorkingDays;
  }
  return left.issueKey.localeCompare(right.issueKey);
}

/**
 * Proposes the smallest set of work that closes a release's shortfall, in the team's own priority
 * order.
 *
 * Takes only as much as the shortfall needs. Proposing everything droppable would be easier and
 * would also be advice nobody could act on — the point is the shortest list that makes the release
 * fit.
 */
export function buildScopeCutPlan(
  forecast: ForecastResult,
  shortfallWorkingDays: number,
  inScopeIssueKeys: readonly string[],
  featureRanks: FeatureRankLookup,
): ScopeCutPlan {
  const inScope = new Set(inScopeIssueKeys);
  const scopedForecasts = forecast.issueForecasts.filter((issueForecast) => inScope.has(issueForecast.issueKey));

  const unsizedIssueKeys = scopedForecasts
    .filter((issueForecast) => !issueForecast.effort.isEstimated)
    .map((issueForecast) => issueForecast.issueKey);

  const droppable: ScopeCutCandidate[] = scopedForecasts
    .filter((issueForecast) => CUTTABLE_STATES.has(issueForecast.state))
    .filter((issueForecast) => (issueForecast.effort.remainingWorkingDays ?? 0) > 0)
    .map((issueForecast) => ({
      issueKey: issueForecast.issueKey,
      summary: issueForecast.summary,
      featureKey: null as string | null,
      featureRank: null as number | null,
      assigneeDisplayName: issueForecast.assigneeDisplayName,
      remainingWorkingDays: issueForecast.effort.remainingWorkingDays ?? 0,
      state: issueForecast.state,
      remainingShortfallWorkingDays: 0,
    }));

  // Attach the board's own ordering. Done here rather than in the map above so the lookup shape
  // stays the caller's business and this module keeps no opinion about where rank comes from.
  droppable.forEach((candidate) => {
    const featureKey = forecast.featureAssessments
      .find((assessment) => assessment.blockingIssueKeys.includes(candidate.issueKey))?.featureKey ?? null;
    candidate.featureKey = featureKey;
    candidate.featureRank = featureKey === null ? null : featureRanks.rankByFeatureKey[featureKey] ?? null;
  });

  const ordered = [...droppable].sort(compareCutOrder);

  const candidates: ScopeCutCandidate[] = [];
  let recoveredWorkingDays = 0;
  for (const candidate of ordered) {
    if (recoveredWorkingDays >= shortfallWorkingDays) {
      break;
    }
    recoveredWorkingDays += candidate.remainingWorkingDays;
    candidates.push({
      ...candidate,
      remainingShortfallWorkingDays: Math.max(0, shortfallWorkingDays - recoveredWorkingDays),
    });
  }

  return {
    shortfallWorkingDays,
    candidates,
    recoveredWorkingDays,
    // Said plainly. A plan that closes only part of the gap is still worth having, but presenting it
    // as a solution would be the same false comfort the whole feature exists to avoid.
    isStillShortAfterCut: recoveredWorkingDays < shortfallWorkingDays,
    unsizedIssueKeys,
  };
}
