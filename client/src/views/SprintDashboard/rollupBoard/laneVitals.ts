// laneVitals.ts — Turning a Feature's vital signs into something you read rather than parse.
//
// The swimlane header used to be one long sentence: key, summary, status, percentage, dependency
// count, estimate, priority and item count all run together in the same small grey type. Every
// figure was there and none of them stood out, so scanning a board of twenty Features for the one in
// trouble meant reading twenty sentences word by word.
//
// This is the same information as a progress bar and a row of labelled tiles — the treatment the
// Team Capacity panel already uses for exactly this job, so the two surfaces now read as one product.
//
// The rules live here, away from the markup, because they are the part worth being sure about: a
// figure Jira does not hold must say "none" rather than show a zero that looks measured, and the
// bar's percentage must come from the same vitals the tiles do so the two cannot contradict.

import type { FamilyProgress, FeatureProgress, MasterCardVitals } from './rollupBoardTypes.ts';

/** Shown in place of the bar when a Feature has no work under it at all. */
const NOTHING_TO_MEASURE_LABEL = 'no work to measure yet';

/** Printed where Jira holds no value, so an absence never reads as a measured zero. */
const ABSENT_VALUE_LABEL = 'None';

/** How much colour a tile carries. Text always says the same thing, so colour is never the only cue. */
export type LaneVitalTone = 'normal' | 'missing' | 'alert';

/** The Feature's progress, ready to draw as a bar with its workings beside it. */
export interface LaneProgressBar {
  /** 0–100 for the dev work, or null when there is nothing to measure. */
  devPercent: number | null;
  /** The dev figure's workings, e.g. "10 of 28 by issue count". Null when there is nothing to show. */
  devDetail: string | null;
  /** The whole family's figure, present only when another discipline has cloned this Feature. */
  familyPercent: number | null;
  familyDetail: string | null;
  /** True when dev reads finished and the family does not — the case worth acting on. */
  hasDisagreement: boolean;
  /** What to say instead of a bar when nothing can be measured. */
  emptyLabel: string;
}

/** One labelled figure in the swimlane header. */
export interface LaneVitalTile {
  id: string;
  /** The small caption above the value. */
  label: string;
  value: string;
  tone: LaneVitalTone;
}

/** What the lane knows about how many of its cards the current filters let through. */
export interface LaneItemCounts {
  matchedItemCount: number;
  totalItemCount: number;
  hasActiveFilters: boolean;
}

/** Names the basis in words, because a percentage without its basis cannot be checked. */
function describeBasis(basis: FeatureProgress['basis']): string {
  return basis === 'story-points' ? 'story points' : 'issue count';
}

/** Spells out the workings behind a percentage. Null when the percentage itself is absent. */
function describeWorkings(progress: FeatureProgress | null): string | null {
  if (progress === null || progress.percentComplete === null) return null;
  return `${progress.completedUnits} of ${progress.totalUnits} by ${describeBasis(progress.basis)}`;
}

/**
 * Builds the swimlane's progress bar.
 *
 * The dev percentage is read from the VITALS rather than from the family figure, because vitals are
 * computed before any filter runs. Taking it from anywhere else would let a filtered lane draw a bar
 * that contradicts the tiles printed next to it.
 */
export function buildLaneProgressBar(
  vitals: MasterCardVitals,
  familyProgress: FamilyProgress | null,
): LaneProgressBar {
  return {
    devPercent: vitals.progress.percentComplete,
    devDetail: describeWorkings(vitals.progress),
    familyPercent: familyProgress?.family?.percentComplete ?? null,
    familyDetail: describeWorkings(familyProgress?.family ?? null),
    hasDisagreement: familyProgress?.hasDisagreement ?? false,
    emptyLabel: NOTHING_TO_MEASURE_LABEL,
  };
}

/** The item-count tile, which counts two sets rather than one whenever a filter is narrowing the lane. */
function buildItemsTile(counts: LaneItemCounts): LaneVitalTile {
  return counts.hasActiveFilters
    ? { id: 'items', label: 'MATCHING', value: `${counts.matchedItemCount} of ${counts.totalItemCount}`, tone: 'normal' }
    : { id: 'items', label: 'ITEMS', value: String(counts.totalItemCount), tone: 'normal' };
}

/**
 * Builds the row of labelled figures shown in a swimlane header.
 *
 * Order is deliberate: where the Feature is, how much is in it, how big it is, how urgent it is, and
 * what is holding it up — the order the questions are actually asked in.
 */
export function buildLaneVitalTiles(vitals: MasterCardVitals, counts: LaneItemCounts): LaneVitalTile[] {
  return [
    {
      id: 'status',
      label: 'STATUS',
      value: vitals.statusName ?? ABSENT_VALUE_LABEL,
      tone: vitals.statusName === null ? 'missing' : 'normal',
    },
    buildItemsTile(counts),
    {
      id: 'points',
      label: 'POINTS',
      value: vitals.storyPoints === null ? ABSENT_VALUE_LABEL : String(vitals.storyPoints),
      tone: vitals.storyPoints === null ? 'missing' : 'normal',
    },
    {
      id: 'priority',
      label: 'PRIORITY',
      value: vitals.priorityName ?? ABSENT_VALUE_LABEL,
      tone: vitals.priorityName === null ? 'missing' : 'normal',
    },
    {
      id: 'dependencies',
      label: 'DEPENDENCIES',
      value: String(vitals.dependencyCount),
      // A dependency is something else's schedule deciding yours, so any at all is worth the eye.
      tone: vitals.dependencyCount > 0 ? 'alert' : 'normal',
    },
  ];
}
