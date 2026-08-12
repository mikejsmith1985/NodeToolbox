// familyProgress.ts — Two figures for one Feature: what dev has done, and what everybody has done.
//
// A Feature delivered by dev, QE and BT is finished when all three are finished. The board's existing
// number counts dev's work alone, so a Feature reads 100% while QE still has test execution open.
//
// The fix is deliberately NOT to redefine that number. Every figure already on the board — and on the
// PI Review and Feature Review surfaces that must agree with it — means "dev's work". Quietly widening
// it would change what all of them claim without anyone being told. So both figures are shown, and
// neither replaces the other: they are both true and they answer different questions.
//
// Both come from the ONE existing computeFeatureProgress. Two implementations of "percent complete"
// would drift, and this repo has already learned that two surfaces showing one metric must consume one
// computation rather than two that happen to agree today.

import { computeFeatureProgress } from './featureProgress.ts';
import type { FamilyProgress, FeatureProgress, RollupBoardItem } from './rollupBoardTypes.ts';

/** The percentage at which work is finished. */
const COMPLETE_PERCENT = 100;

/**
 * The dev figure and the family figure.
 *
 * `family` is null when there are no sub-lanes, because a family figure identical to the dev figure
 * is noise rather than information — and most lanes on a real board have no clones at all.
 */
export function computeFamilyProgress(
  primaryItems: readonly RollupBoardItem[],
  subLaneItems: readonly (readonly RollupBoardItem[])[],
): FamilyProgress {
  const devProgress = computeFeatureProgress(primaryItems);

  if ((subLaneItems ?? []).length === 0) {
    return { dev: devProgress, family: null, hasDisagreement: false };
  }

  const everyItem = [...primaryItems, ...subLaneItems.flat()];
  const familyProgress = computeFeatureProgress(everyItem);

  // Only a dev figure that reads FINISHED can disagree in the way that matters. A Feature at 40% dev
  // and 30% family is not telling anybody anything they did not already know.
  const isDevComplete = devProgress.percentComplete === COMPLETE_PERCENT;
  const isFamilyComplete = familyProgress.percentComplete === COMPLETE_PERCENT;

  return { dev: devProgress, family: familyProgress, hasDisagreement: isDevComplete && !isFamilyComplete };
}

/**
 * True when the two figures cannot honestly be compared.
 *
 * Points weighting needs EVERY contributing item estimated, so one unpointed QE story demotes the
 * family figure to counting issues while dev stays on points. Showing "100% and 60%" side by side
 * then invites a subtraction that means nothing.
 */
export function haveDifferentBases(familyProgress: FamilyProgress): boolean {
  if (familyProgress.family === null) return false;
  return familyProgress.dev.basis !== familyProgress.family.basis;
}

/**
 * States the gap between dev and the family.
 *
 * The single most actionable thing this feature surfaces, so it is a sentence rather than a number:
 * the point is not that two figures differ, but that the Feature is not actually done.
 */
export function describeProgressDisagreement(familyProgress: FamilyProgress): string {
  if (!familyProgress.hasDisagreement || familyProgress.family === null) return '';

  const outstandingUnits = familyProgress.family.totalUnits - familyProgress.family.completedUnits;
  const unitWord = familyProgress.family.basis === 'story-points' ? 'story points' : 'issues';

  return `Dev is complete, but this Feature is not: ${outstandingUnits} ${unitWord} are still open`
    + ' across the other disciplines.';
}

/**
 * The two figures on one line, labelled so neither can be mistaken for the other.
 *
 * When the bases differ — one unpointed clone story is enough — the line says which weighting each
 * figure used, because "100% and 60%" side by side otherwise invites a subtraction that means nothing.
 */
export function describeTwoFigures(familyProgress: FamilyProgress): string {
  if (familyProgress.family === null) return '';

  const devPercent = familyProgress.dev.percentComplete ?? 0;
  const familyPercent = familyProgress.family.percentComplete ?? 0;

  if (!haveDifferentBases(familyProgress)) {
    return `Dev ${devPercent}% · whole Feature ${familyPercent}%`;
  }

  const readBasis = (basis: FeatureProgress['basis']): string =>
    basis === 'story-points' ? 'by points' : 'by issue count';
  return `Dev ${devPercent}% ${readBasis(familyProgress.dev.basis)}`
    + ` · whole Feature ${familyPercent}% ${readBasis(familyProgress.family.basis)}`;
}
