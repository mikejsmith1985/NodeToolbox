// featureSizing.ts — Have a Feature's children outgrown the estimate somebody put on the Feature?
//
// Stories are built out THROUGH the PI rather than up front, so a Feature sized at 20 that grows
// into 34 points of work is only discoverable after the fact — and only if something is watching.
// Nobody goes looking for this, so it has to arrive unprompted.
//
// Deliberately separate from the PI planner's defect-bucket rule, which asks a different question
// (has a budget bucket overrun?), counts sub-tasks, and feeds a different surface. Generalising that
// one in place would have changed the planner's output to answer a question it was not asked.

import type { FeatureSizingFlag, SizingChild } from './forecastTypes.ts';

const PERCENT_MULTIPLIER = 100;

/**
 * Assesses whether one Feature's children have outgrown its estimate.
 *
 * Sub-task points are excluded: they belong to their parent, and counting both would flag every
 * Feature whose team happens to break work down one level further than another's.
 *
 * A Feature with NO estimate is `not-sized`, never `over`. There is no budget to overrun, so an
 * overage figure would have no basis at all — and a number with no basis is worse than none.
 */
export function assessFeatureSizing(
  featureKey: string,
  featurePoints: number | null,
  children: readonly SizingChild[],
  tolerancePercent: number,
): FeatureSizingFlag {
  const countedChildren = children.filter((child) => child.typeBucket !== 'subtask');
  const childrenPoints = countedChildren
    .reduce((runningTotal, child) => runningTotal + (child.storyPoints ?? 0), 0);
  // Their absence is why the sum above is a floor rather than a total, so it is reported beside it.
  const unsizedChildCount = countedChildren.filter((child) => child.storyPoints === null).length;

  if (featurePoints === null) {
    return {
      featureKey,
      featurePoints: null,
      childrenPoints,
      overagePoints: 0,
      overagePercent: 0,
      state: 'not-sized',
      unsizedChildCount,
    };
  }

  const overagePoints = Math.max(0, childrenPoints - featurePoints);
  // A Feature estimated at zero would divide to infinity. It is still over — its children carry work
  // its estimate does not admit to — but the percentage is meaningless, so it is reported as zero.
  const overagePercent = featurePoints > 0
    ? Math.round((overagePoints / featurePoints) * PERCENT_MULTIPLIER)
    : 0;

  return {
    featureKey,
    featurePoints,
    childrenPoints,
    overagePoints,
    overagePercent,
    state: readSizingState(overagePoints, overagePercent, featurePoints, tolerancePercent),
    unsizedChildCount,
  };
}

/** Decides whether an overage is worth flagging, given the configured tolerance. */
function readSizingState(
  overagePoints: number,
  overagePercent: number,
  featurePoints: number,
  tolerancePercent: number,
): FeatureSizingFlag['state'] {
  if (overagePoints === 0) {
    return 'within';
  }
  // With a zero estimate there is no percentage to compare, so any overage at all is the finding.
  if (featurePoints === 0) {
    return 'over';
  }
  return overagePercent > tolerancePercent ? 'over' : 'within';
}
