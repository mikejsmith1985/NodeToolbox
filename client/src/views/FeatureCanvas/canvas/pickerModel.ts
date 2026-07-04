// pickerModel.ts — Pure mapping + selection helpers for the canvas's Custom-JQL "add more" picker.
//
// The blueprint selection lives in the reused BlueprintTab (step 1); this covers only the secondary
// Custom-JQL source: it turns feature-review items into a selectable list, filters it, and computes
// exactly which keys an "Add" should place — never touching Jira or the overlay. Pure and deterministic.

import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';

/** Heading used for the ungrouped custom-query result. */
export const CUSTOM_QUERY_GROUP_LABEL = 'Custom query';

/** A selectable candidate row in the picker. */
export interface PickerFeature {
  key: string;
  summary: string;
  status: string;
  health: string;
  childCount: number;
  programEpicKey: string | null;
  programEpicSummary: string | null;
  /** True when this feature is already on the canvas (shown as "already added", not selectable). */
  isAlreadyOnCanvas: boolean;
}

/** A Program Epic grouping of candidate features (or the single "Custom query" group). */
export interface PickerGroup {
  programEpicKey: string | null;
  programEpicSummary: string;
  features: PickerFeature[];
}

/** Maps custom-JQL feature-review items into a single ungrouped "Custom query" group. */
export function mapJqlItemsToGroups(
  items: readonly FeatureReviewItem[],
  onCanvasKeys: ReadonlySet<string>,
): PickerGroup[] {
  if (items.length === 0) {
    return [];
  }
  return [{
    programEpicKey: null,
    programEpicSummary: CUSTOM_QUERY_GROUP_LABEL,
    features: items.map((item) => ({
      key: item.feature.key,
      summary: item.feature.summary,
      status: item.feature.status,
      health: item.feature.health,
      childCount: item.totalChildCount,
      programEpicKey: null,
      programEpicSummary: null,
      isAlreadyOnCanvas: onCanvasKeys.has(item.feature.key),
    })),
  }];
}

/** Narrows groups to features whose key or summary contains the search text; drops now-empty groups. */
export function filterGroupsBySearch(groups: readonly PickerGroup[], search: string): PickerGroup[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (normalizedSearch === '') {
    return groups.slice();
  }
  return groups
    .map((group) => ({
      ...group,
      features: group.features.filter((feature) => `${feature.key} ${feature.summary}`.toLowerCase().includes(normalizedSearch)),
    }))
    .filter((group) => group.features.length > 0);
}

/** All feature keys across the given groups (for select-all when nothing is filtered out). */
export function collectAllKeys(groups: readonly PickerGroup[]): string[] {
  return groups.flatMap((group) => group.features.map((feature) => feature.key));
}

/** Keys the user could still add (not already on the canvas) across the given groups. */
export function collectSelectableKeys(groups: readonly PickerGroup[]): string[] {
  return groups.flatMap((group) => group.features.filter((feature) => !feature.isAlreadyOnCanvas).map((feature) => feature.key));
}

/** The keys an "Add" should actually place: selected minus any already on the canvas (dedup). */
export function collectAddableKeys(selectedKeys: ReadonlySet<string>, onCanvasKeys: ReadonlySet<string>): string[] {
  return [...selectedKeys].filter((key) => !onCanvasKeys.has(key));
}
