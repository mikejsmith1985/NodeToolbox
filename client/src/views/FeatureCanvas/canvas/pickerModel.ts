// pickerModel.ts — Pure mapping + selection helpers for the Surface picker.
//
// The picker lists in-scope features (from the blueprint, grouped by Program Epic, or from a custom
// JQL query) and lets the user choose which to add to the canvas. These helpers turn the two source
// shapes into a uniform selectable list, filter it, and compute exactly which keys an "Add" should
// place — never touching Jira or the overlay. Pure and deterministic.

import type { BlueprintFeatureNode, BlueprintProgramEpicNode } from '../../ArtView/blueprintHierarchy.ts';
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

/**
 * Maps a blueprint program-epic hierarchy into picker groups (PE → Feature), scoped to the selected
 * team. Because the blueprint spans the whole ART, a single team's hierarchy also drags in sibling
 * features hanging off the same Program Epics that belong to *other* teams — these are flagged
 * `isExternal`. We drop them so the picker shows only the scoped team's own features (matching ART's
 * per-team Blueprint count), and any Program Epic left with no features is omitted.
 */
export function mapBlueprintToGroups(
  programEpics: readonly BlueprintProgramEpicNode[],
  onCanvasKeys: ReadonlySet<string>,
): PickerGroup[] {
  return programEpics
    .map((programEpic) => ({
      programEpicKey: programEpic.key,
      programEpicSummary: programEpic.summary || programEpic.key,
      features: programEpic.features
        .filter((featureNode) => !featureNode.isExternal)
        .map((featureNode) => blueprintFeatureToPickerFeature(featureNode, programEpic, onCanvasKeys)),
    }))
    .filter((group) => group.features.length > 0);
}

/** Maps a blueprint feature node into a picker row (child count includes off-train children). */
function blueprintFeatureToPickerFeature(
  featureNode: BlueprintFeatureNode,
  programEpic: BlueprintProgramEpicNode | null,
  onCanvasKeys: ReadonlySet<string>,
): PickerFeature {
  return {
    key: featureNode.key,
    summary: featureNode.summary,
    status: featureNode.status,
    health: featureNode.health,
    childCount: featureNode.children.length + featureNode.offTrain.length,
    programEpicKey: programEpic?.key ?? null,
    programEpicSummary: programEpic?.summary ?? null,
    isAlreadyOnCanvas: onCanvasKeys.has(featureNode.key),
  };
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
