// cycleTime.ts — Pure Metrics helpers for simplified Jira cycle-time statistics.
//
// The standalone Metrics view deliberately uses created-to-resolution timing as a
// small, transparent replacement for the legacy changelog parser.

const EMPTY_COUNT = 0;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const P90_PERCENTILE = 0.9;
const ONE_DECIMAL_PLACE = 10;

export interface CycleTimeStats {
  sampleCount: number;
  meanDays: number;
  medianDays: number;
  p90Days: number;
}

/** Calculates whole elapsed days between two Jira timestamps, clamping same-day or invalid ranges to zero. */
export function daysBetween(startIso: string, endIso: string): number {
  const startTimestamp = new Date(startIso).getTime();
  const endTimestamp = new Date(endIso).getTime();
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return EMPTY_COUNT;

  const elapsedMilliseconds = endTimestamp - startTimestamp;
  if (elapsedMilliseconds <= EMPTY_COUNT) return EMPTY_COUNT;
  return Math.floor(elapsedMilliseconds / MILLISECONDS_PER_DAY);
}

/** Computes mean, median, and p90 cycle time so teams can see typical and long-tail delivery age. */
export function computeStats(dayValues: number[]): CycleTimeStats {
  const sortedDayValues = dayValues.filter(Number.isFinite).sort((firstDayValue, secondDayValue) => firstDayValue - secondDayValue);
  if (sortedDayValues.length === EMPTY_COUNT) return createEmptyStats();

  return {
    sampleCount: sortedDayValues.length,
    meanDays: roundToOneDecimal(calculateMean(sortedDayValues)),
    medianDays: roundToOneDecimal(calculateMedian(sortedDayValues)),
    p90Days: sortedDayValues[calculateNearestRankIndex(sortedDayValues.length)],
  };
}

function createEmptyStats(): CycleTimeStats {
  return {
    sampleCount: EMPTY_COUNT,
    meanDays: EMPTY_COUNT,
    medianDays: EMPTY_COUNT,
    p90Days: EMPTY_COUNT,
  };
}

function calculateMean(sortedDayValues: number[]): number {
  const dayTotal = sortedDayValues.reduce((runningTotal, dayValue) => runningTotal + dayValue, EMPTY_COUNT);
  return dayTotal / sortedDayValues.length;
}

function calculateMedian(sortedDayValues: number[]): number {
  const midpointIndex = Math.floor(sortedDayValues.length / 2);
  const hasEvenSampleCount = sortedDayValues.length % 2 === EMPTY_COUNT;
  if (!hasEvenSampleCount) return sortedDayValues[midpointIndex];
  return (sortedDayValues[midpointIndex - 1] + sortedDayValues[midpointIndex]) / 2;
}

function calculateNearestRankIndex(sampleCount: number): number {
  return Math.max(EMPTY_COUNT, Math.ceil(sampleCount * P90_PERCENTILE) - 1);
}

function roundToOneDecimal(dayValue: number): number {
  return Math.round(dayValue * ONE_DECIMAL_PLACE) / ONE_DECIMAL_PLACE;
}
