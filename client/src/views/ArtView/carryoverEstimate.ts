// carryoverEstimate.ts — How many points of a carried-over Feature are still left to do.
//
// A Feature is pointed to its Definition of Done — "Code in Integrated Test" — so its full point value
// covers development AND internal testing. Internal testing (the SL/QA work) is assumed to be 30% of
// that; development the other 70%. When a Feature carries into the next PI, the number that matters for
// planning is not its full points but the REMAINING effort.
//
// This is fully deterministic — no AI. It reuses the exact completion maths the Blueprint tab shows,
// so the "remaining" figure can never contradict the progress a user sees elsewhere:
//
//   remaining = (1 − devDone) × 0.70 × points  +  (1 − testDone) × 0.30 × points
//
// where devDone / testDone are the point-weighted completion of the Feature's development and
// internal-testing children respectively. A child with no dev/test children of a kind is treated as 0%
// done for that portion — the work still has to happen — so a carryover whose QA is untouched keeps its
// full 30%.

import { computeCompletionFraction, type CompletionStoryNode } from './featureCompletion.ts';

/** The development share of a Feature's Definition of Done. */
const DEV_WEIGHT = 0.7;

/** The internal-testing (SL/QA) share of a Feature's Definition of Done. */
const TEST_WEIGHT = 0.3;

/** Which side of the work a child issue belongs to. */
export type CarryoverChildKind = 'dev' | 'test';

/** A child issue as this estimate needs it: its completion inputs, plus what tells dev from test. */
export interface CarryoverChildIssue extends CompletionStoryNode {
  summary: string;
  /**
   * The roster capability of this child's assignee, used only as a fallback when the summary does not
   * say. `null` when the assignee is not on the roster or has no relevant capability.
   */
  assigneeRoleKind?: CarryoverChildKind | null;
}

/**
 * Classifies a child as development or internal-testing work.
 *
 * Primary signal is the summary: teams prefix these "Dev", "SL" or "QA" (e.g. "DEV: Glue Changes",
 * "QA: Component test"). When the summary says nothing, the assignee's roster role is the fallback.
 * Anything still unknown is treated as development — the larger share — so an unclassifiable child is
 * never quietly dropped from the estimate.
 */
export function classifyCarryoverChild(child: CarryoverChildIssue): CarryoverChildKind {
  const normalizedSummary = child.summary.toLowerCase();
  // Word-boundary-ish match so "sl" does not fire inside unrelated words like "slice".
  if (/\b(qa|sl)\b/.test(normalizedSummary) || normalizedSummary.includes('internal test')) {
    return 'test';
  }
  if (/\bdev\b/.test(normalizedSummary) || normalizedSummary.includes('develop')) {
    return 'dev';
  }
  if (child.assigneeRoleKind === 'test' || child.assigneeRoleKind === 'dev') {
    return child.assigneeRoleKind;
  }
  return 'dev';
}

/** The remaining-points estimate for one carried Feature, with the parts that produced it. */
export interface CarryoverEstimate {
  remainingPoints: number;
  devDoneFraction: number;
  testDoneFraction: number;
  devChildCount: number;
  testChildCount: number;
}

/**
 * Estimates the points still left on a carried Feature.
 *
 * Returns null when the Feature has no numeric point value — there is nothing to take a fraction of,
 * and inventing a number here would be worse than leaving the estimate to a person.
 */
export function estimateCarryoverRemainingPoints(
  featurePoints: number | null,
  children: readonly CarryoverChildIssue[],
): CarryoverEstimate | null {
  if (featurePoints === null || !Number.isFinite(featurePoints) || featurePoints <= 0) {
    return null;
  }

  const devChildren = children.filter((child) => classifyCarryoverChild(child) === 'dev');
  const testChildren = children.filter((child) => classifyCarryoverChild(child) === 'test');

  // No children of a kind ⇒ that portion is 0% done: the work still has to happen. This is what keeps
  // a carryover with no QA children carrying its full 30% internal-testing share.
  const devDoneFraction = computeCompletionFraction(devChildren);
  const testDoneFraction = computeCompletionFraction(testChildren);

  const remaining = (1 - devDoneFraction) * DEV_WEIGHT * featurePoints
    + (1 - testDoneFraction) * TEST_WEIGHT * featurePoints;

  return {
    remainingPoints: Math.round(remaining),
    devDoneFraction,
    testDoneFraction,
    devChildCount: devChildren.length,
    testChildCount: testChildren.length,
  };
}
