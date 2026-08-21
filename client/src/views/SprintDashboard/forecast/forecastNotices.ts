// forecastNotices.ts — What the forecast could not measure, said out loud.
//
// Every figure this feature produces is only as complete as its inputs. A board showing a verdict
// for every Feature while silently omitting the unsized work behind them reads as more certain than
// it is — and that false certainty is indistinguishable from the real thing, which is exactly why it
// has to be stated rather than left to be inferred.
//
// A refused setting is the other half. A rate somebody typed as zero falls back to one so the app
// keeps working; if that fallback is silent, the numbers can never be reconciled with the settings
// screen and the operator ends up trusting whichever they looked at last.

import type { ForecastResult } from './forecastTypes.ts';

/** One thing worth saying about a forecast, and how loudly. */
export interface ForecastNotice {
  id: string;
  /** `warning` is something to act on; `info` is something to know. */
  tone: 'warning' | 'info';
  summary: string;
}

/** Lets a surface suppress a gap it already reports more fully in its own words. */
export interface ForecastNoticeOptions {
  /**
   * Skip the missing-sub-status line.
   *
   * Set by the Roll-Up Board, which already carries a fuller notice about the same fact — two
   * notices saying one thing is noise, and noise is what stops people reading the notices that
   * matter.
   */
  omitSubStatusGap?: boolean;
}

/** Names each gap in the inputs, in the order somebody would fix them. */
function describeGaps(forecast: ForecastResult, options: ForecastNoticeOptions): string[] {
  const { completeness } = forecast;
  return [
    completeness.unsizedIssueCount > 0 ? `${completeness.unsizedIssueCount} unsized` : null,
    completeness.unassignedIssueCount > 0 ? `${completeness.unassignedIssueCount} unassigned` : null,
    completeness.undatedVersionCount > 0 ? `${completeness.undatedVersionCount} undated fix versions` : null,
    completeness.cancelledIssueCount > 0 ? `${completeness.cancelledIssueCount} cancelled and excluded` : null,
    completeness.hasSubStatusField || options.omitSubStatusGap === true
      ? null
      : 'no sub-status field, so INT readiness is not checked',
    completeness.hasBoardVocabulary ? null : 'no column order, so every item is charged at full size',
  ].filter((gap): gap is string => gap !== null);
}

/**
 * Turns a forecast's honesty record into notices a surface can render.
 *
 * Returns nothing when there is nothing to admit — a permanent "everything is fine" banner is one
 * people learn to stop reading, which would take the real warnings down with it.
 */
export function buildForecastNotices(
  forecast: ForecastResult,
  options: ForecastNoticeOptions = {},
): ForecastNotice[] {
  const gaps = describeGaps(forecast, options);

  return [
    ...(gaps.length === 0 ? [] : [{
      id: 'forecast-completeness',
      // Information rather than a warning: these are caveats on a figure, not a broken thing.
      tone: 'info' as const,
      summary: `Forecast: ${gaps.join(' · ')}`,
    }]),
    // A warning, because unlike a gap in the data this is something the operator configured and can
    // correct in one place.
    ...forecast.rejectedSettings.map((rejected) => ({
      id: `forecast-setting-${rejected.name}`,
      tone: 'warning' as const,
      summary: `Forecast setting ignored: ${rejected.name} is ${rejected.storedValue} — it ${rejected.reason}`,
    })),
  ];
}
