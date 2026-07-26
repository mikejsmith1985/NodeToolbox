// piPlanBreakdown.ts — Expands an accepted Feature→Story breakdown into the FeatureCanvas planner's
// PlanItem contract (spec 028, US1). Applies the 70/30 dev/internal-test split, the MoSCoW bucket
// mapping (research R2a), and the 13-point size cap warning. Pure and deterministic.

import type { PlanItem } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { FeatureInput, StorySuggestion } from './piPlanTypes.ts';

/** The MoSCoW bucket the planner orders by (mirrors PlanItem.bucket in capacityTypes). */
type Bucket = 'Must' | 'Should' | 'Could' | 'Wont';

/** Development share of a Story's effort; the remainder is internal testing (spec: 70/30). */
const DEV_EFFORT_FRACTION = 0.7;
/** A Story may not exceed this size; larger work must be split (FR-024, clarified to 13 by the team). */
export const MAX_STORY_POINTS = 13;

/** MoSCoW rank for the "committed ⇒ at least Should" bump. Higher = more urgent. */
const BUCKET_RANK: Record<Bucket, number> = { Must: 3, Should: 2, Could: 1, Wont: 0 };

/** Jira priority name → MoSCoW bucket (research R2a). Unknown priorities default to Should. */
const PRIORITY_TO_BUCKET: Record<string, Bucket> = {
  highest: 'Must', blocker: 'Must', high: 'Should', medium: 'Could', low: 'Wont', lowest: 'Wont',
};

/** Maps a Feature's Jira priority to a MoSCoW bucket, forcing a committed Feature to at least Should. */
export function mapPriorityToBucket(priorityName: string | null, isCommitted: boolean): Bucket {
  const base = PRIORITY_TO_BUCKET[(priorityName ?? '').toLowerCase()] ?? 'Should';
  if (isCommitted && BUCKET_RANK[base] < BUCKET_RANK.Should) {
    return 'Should';
  }
  return base;
}

/** Splits a Story's size 70% dev / 30% internal test; the two parts always sum to the size. */
export function splitEffort(sizePoints: number): { devPoints: number; internalTestPoints: number } {
  const devPoints = Math.round(sizePoints * DEV_EFFORT_FRACTION);
  return { devPoints, internalTestPoints: sizePoints - devPoints };
}

/** The result of expanding one Feature: the planner items plus any per-Story warnings (e.g. oversize). */
export interface BreakdownExpansion {
  items: PlanItem[];
  warnings: Record<string, string[]>;
}

/**
 * Expands a Feature's accepted Stories into planner PlanItems. Each item gets the Feature's MoSCoW
 * bucket and priority rank; a testable Story splits 70/30, a spike carries all effort as dev with no
 * test. Stories larger than the cap are still emitted but flagged so the operator can split them.
 */
export function expandBreakdown(feature: FeatureInput, stories: StorySuggestion[]): BreakdownExpansion {
  const bucket = mapPriorityToBucket(feature.priorityName, feature.isCommitted);
  const items: PlanItem[] = [];
  const warnings: Record<string, string[]> = {};

  stories.forEach((story, index) => {
    const tempId = `${feature.key}#${index + 1}`;
    const split = story.hasTestableOutput
      ? splitEffort(story.sizePoints)
      : { devPoints: story.sizePoints, internalTestPoints: 0 };
    if (story.sizePoints > MAX_STORY_POINTS) {
      warnings[tempId] = [`Story is ${story.sizePoints} pts, over the ${MAX_STORY_POINTS}-pt cap — split it further`];
    }
    items.push({
      key: tempId,
      summary: story.summary,
      bucket,
      rankInBucket: feature.priorityRank,
      devPoints: split.devPoints,
      internalTestPoints: split.internalTestPoints,
      externalTestPoints: 0,
      isTestEstimated: false,
      assignee: null,
    });
  });

  return { items, warnings };
}
