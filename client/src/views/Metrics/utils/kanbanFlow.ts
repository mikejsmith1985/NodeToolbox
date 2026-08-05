// kanbanFlow.ts — Pure Kanban flow metrics for the Metrics view: weekly throughput bucketing and
// a cycle-time-consistency reading that stands in for sprint predictability on boards without
// sprints. Clock is injected (nowIso) so every computation is deterministic and unit-testable.

import type { CycleTimeStats } from './cycleTime.ts';

const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// A zero median (same-day completions) would divide to Infinity; flooring the denominator to half
// a day keeps the ratio finite while still rewarding genuinely fast, consistent flow.
const MINIMUM_MEDIAN_DAYS = 0.5;
// p90 within 2× the median means most work lands close to typical — predictable flow.
const STEADY_RATIO_CEILING = 2;
// p90 within 4× the median is noticeable spread; beyond that, completion dates are guesses.
const VARIABLE_RATIO_CEILING = 4;

export interface KanbanThroughputPoint {
  /** ISO date (YYYY-MM-DD) of the first day covered by this rolling 7-day bucket. */
  weekStartIso: string;
  /** Issues whose resolution date falls inside this bucket. */
  completedIssues: number;
}

export interface FlowPredictabilityReading {
  /** How far the slowest-decile cycle time sits above the typical one. */
  p90OverMedianRatio: number;
  ratingLabel: 'Steady' | 'Variable' | 'Erratic';
  /** One-sentence plain-language interpretation for the card. */
  description: string;
}

/**
 * Buckets resolution timestamps into `weekCount` rolling 7-day windows ending now,
 * returned oldest → newest so charts read left to right. Dates outside the window
 * (or unparseable) are ignored.
 */
export function computeWeeklyThroughput(
  resolutionDatesIso: string[],
  weekCount: number,
  nowIso: string,
): KanbanThroughputPoint[] {
  const nowTimestamp = new Date(nowIso).getTime();
  const bucketCounts = new Array<number>(weekCount).fill(0);

  for (const resolutionDateIso of resolutionDatesIso) {
    const resolvedTimestamp = new Date(resolutionDateIso).getTime();
    if (!Number.isFinite(resolvedTimestamp)) continue;
    const daysAgo = Math.floor((nowTimestamp - resolvedTimestamp) / MILLISECONDS_PER_DAY);
    if (daysAgo < 0) continue;
    const bucketIndexFromNewest = Math.floor(daysAgo / DAYS_PER_WEEK);
    if (bucketIndexFromNewest >= weekCount) continue;
    bucketCounts[bucketIndexFromNewest] += 1;
  }

  return bucketCounts
    .map((completedIssues, bucketIndexFromNewest) => ({
      weekStartIso: buildWeekStartIso(nowTimestamp, bucketIndexFromNewest),
      completedIssues,
    }))
    .reverse();
}

/**
 * Interprets cycle-time spread as flow predictability: the closer the 90th-percentile cycle time
 * sits to the median, the more reliably the team can forecast a single item's completion.
 */
export function describeFlowPredictability(cycleTimeStats: CycleTimeStats): FlowPredictabilityReading {
  const flooredMedianDays = Math.max(cycleTimeStats.medianDays, MINIMUM_MEDIAN_DAYS);
  const p90OverMedianRatio = cycleTimeStats.p90Days / flooredMedianDays;

  if (p90OverMedianRatio <= STEADY_RATIO_CEILING) {
    return {
      p90OverMedianRatio,
      ratingLabel: 'Steady',
      description: 'Most items finish close to the typical cycle time — forecasts are reliable.',
    };
  }
  if (p90OverMedianRatio <= VARIABLE_RATIO_CEILING) {
    return {
      p90OverMedianRatio,
      ratingLabel: 'Variable',
      description: 'Slow items take a few times longer than typical — forecast with ranges, not dates.',
    };
  }
  return {
    p90OverMedianRatio,
    ratingLabel: 'Erratic',
    description: 'The slowest items take many times longer than typical — look for blocked or aging work.',
  };
}

/** Returns the ISO date (YYYY-MM-DD) of the oldest day inside the given rolling 7-day bucket. */
function buildWeekStartIso(nowTimestamp: number, bucketIndexFromNewest: number): string {
  const daysBackToWeekStart = bucketIndexFromNewest * DAYS_PER_WEEK + (DAYS_PER_WEEK - 1);
  const weekStartDate = new Date(nowTimestamp - daysBackToWeekStart * MILLISECONDS_PER_DAY);
  return weekStartDate.toISOString().slice(0, 'YYYY-MM-DD'.length);
}
