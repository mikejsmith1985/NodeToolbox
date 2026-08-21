// laneSchedule.ts — One Feature's schedule, as a shape you can read without counting anything.
//
// The Roll-Up Board already draws how much of a Feature is DONE. It has never drawn whether the rest
// of it is going to land, which is a different question and usually the more urgent one: a Feature
// at 80% with every remaining item behind is in more trouble than one at 40% that is on track.
//
// So this turns the per-issue verdicts for one Feature into a proportional band, ordered worst
// first. Everything it produces is already computed elsewhere — nothing here decides anything, it
// only arranges what the forecast said into something the eye reads in one pass.

import type { FeatureDodAssessment, IssueForecast, IssueForecastState } from './forecastTypes.ts';

/** One coloured run in a Feature's schedule band. */
export interface LaneScheduleSegment {
  state: IssueForecastState;
  /** What this run means, in words. Colour is never the only thing saying it. */
  label: string;
  issueCount: number;
  /** Share of the Feature's work, 0–100, so the band can be drawn without further arithmetic. */
  widthPercent: number;
  /** How loudly to draw it. */
  tone: 'late' | 'due' | 'good' | 'unknown';
}

/** A Feature's schedule at a glance: the band, the headline, and the date it can reach INT. */
export interface LaneSchedule {
  segments: LaneScheduleSegment[];
  /** The single sentence a lane header shows — the answer, before any of the working. */
  headline: string;
  tone: 'late' | 'due' | 'good' | 'unknown';
  /** When this Feature's work can reach Integration Test, or null when it cannot be dated. */
  dodDateIso: string | null;
  /** True when the PI clock is configured AND this Feature misses it. */
  isMissingPi: boolean;
  /** Items nobody sized, which is why the band may be narrower than the Feature's real work. */
  unsizedIssueCount: number;
  totalIssueCount: number;
}

/** The order a reader needs: problems first, then the good news, then what could not be judged. */
const SEGMENT_ORDER: Array<{ state: IssueForecastState; label: string; tone: LaneScheduleSegment['tone'] }> = [
  { state: 'cannot-fit', label: 'Deadline gone', tone: 'late' },
  { state: 'behind', label: 'Behind', tone: 'late' },
  { state: 'start-today', label: 'Start today', tone: 'due' },
  { state: 'on-track', label: 'On track', tone: 'good' },
  { state: 'ahead', label: 'Ahead', tone: 'good' },
  { state: 'unassignable', label: 'No owner', tone: 'unknown' },
  { state: 'unsized', label: 'Unsized', tone: 'unknown' },
  { state: 'unforecastable', label: 'No deadline', tone: 'unknown' },
];

/** Writes the one sentence the lane leads with — the answer, not the workings. */
function describeHeadline(
  countsByState: Record<string, number>,
  assessment: FeatureDodAssessment | null,
  totalIssueCount: number,
): { headline: string; tone: LaneSchedule['tone'] } {
  if (totalIssueCount === 0) {
    return { headline: 'No work yet', tone: 'unknown' };
  }

  const lateCount = (countsByState.behind ?? 0) + (countsByState['cannot-fit'] ?? 0);
  const dueCount = countsByState['start-today'] ?? 0;

  if (lateCount > 0) {
    return { headline: `${lateCount} behind`, tone: 'late' };
  }
  if (dueCount > 0) {
    return { headline: `${dueCount} must start today`, tone: 'due' };
  }
  // Naming WHICH half is at fault is the difference between "find a tester" and "split the work".
  if (assessment?.piVerdict === 'at-risk') {
    return {
      headline: assessment.riskCause === 'test-squeeze' ? 'At risk — test squeeze' : 'At risk — dev too large',
      tone: 'late',
    };
  }
  if (assessment?.intReadyState === 'int-ready') {
    return { headline: 'Ready for Integrated Test', tone: 'good' };
  }
  const unknownCount = (countsByState.unsized ?? 0) + (countsByState.unforecastable ?? 0);
  if (unknownCount === totalIssueCount) {
    return { headline: 'Cannot be forecast', tone: 'unknown' };
  }
  return { headline: 'On track', tone: 'good' };
}

/**
 * Arranges one Feature's per-issue verdicts into a band, a headline and a date.
 *
 * Proportional by ISSUE COUNT rather than by points, deliberately: a Feature with one unsized item
 * has no point total to be a proportion of, and a band that silently omitted it would draw the
 * Feature as narrower and healthier than it is.
 */
export function buildLaneSchedule(
  forecasts: readonly IssueForecast[],
  assessment: FeatureDodAssessment | null,
): LaneSchedule {
  const countsByState: Record<string, number> = {};
  forecasts.forEach((forecast) => {
    countsByState[forecast.state] = (countsByState[forecast.state] ?? 0) + 1;
  });

  const totalIssueCount = forecasts.length;
  const segments = SEGMENT_ORDER
    .map((entry) => ({
      state: entry.state,
      label: entry.label,
      tone: entry.tone,
      issueCount: countsByState[entry.state] ?? 0,
      widthPercent: totalIssueCount === 0
        ? 0
        : ((countsByState[entry.state] ?? 0) / totalIssueCount) * 100,
    }))
    .filter((segment) => segment.issueCount > 0);

  const { headline, tone } = describeHeadline(countsByState, assessment, totalIssueCount);

  return {
    segments,
    headline,
    tone,
    dodDateIso: assessment?.dodDateIso ?? null,
    isMissingPi: assessment?.piVerdict === 'at-risk',
    unsizedIssueCount: countsByState.unsized ?? 0,
    totalIssueCount,
  };
}
