// pickerModel.test.ts — Verifies the picker mapping, search, and selection helpers.

import { describe, expect, it } from 'vitest';

import type { BlueprintProgramEpicNode } from '../../ArtView/blueprintHierarchy.ts';
import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import {
  collectAddableKeys,
  collectSelectableKeys,
  CUSTOM_QUERY_GROUP_LABEL,
  filterGroupsBySearch,
  mapBlueprintToGroups,
  mapJqlItemsToGroups,
} from './pickerModel.ts';

function programEpic(): BlueprintProgramEpicNode {
  return {
    type: 'pe', key: 'PE-1', summary: 'Onboarding', status: 'In Progress', health: 'yellow', completionPercent: 30,
    features: [
      { type: 'feature', key: 'F-1', summary: 'Login', status: 'In Progress', health: 'yellow', completionPercent: 40, children: [{} as never, {} as never], offTrain: [{} as never], isExternal: false },
      { type: 'feature', key: 'F-2', summary: 'Payments', status: 'To Do', health: 'gray', completionPercent: 0, children: [], offTrain: [], isExternal: false },
    ],
  };
}

describe('pickerModel', () => {
  it('maps a blueprint hierarchy into PE groups with child counts and already-added flags', () => {
    const groups = mapBlueprintToGroups([programEpic()], new Set(['F-1']));
    expect(groups).toHaveLength(1);
    expect(groups[0].programEpicSummary).toBe('Onboarding');
    expect(groups[0].features.map((feature) => feature.key)).toEqual(['F-1', 'F-2']);
    // F-1: 2 children + 1 off-train = 3; already on canvas.
    expect(groups[0].features[0]).toMatchObject({ childCount: 3, isAlreadyOnCanvas: true, programEpicKey: 'PE-1' });
    expect(groups[0].features[1]).toMatchObject({ key: 'F-2', childCount: 0, isAlreadyOnCanvas: false });
  });

  it('drops external (other-team) sibling features and any now-empty Program Epic', () => {
    const withExternal = programEpic();
    withExternal.features.push({ type: 'feature', key: 'X-9', summary: 'Other team feature', status: 'To Do', health: 'gray', completionPercent: 0, children: [], offTrain: [], isExternal: true });
    const onlyExternalPe: BlueprintProgramEpicNode = {
      type: 'pe', key: 'PE-2', summary: 'Foreign', status: null, health: 'gray', completionPercent: 0,
      features: [{ type: 'feature', key: 'X-10', summary: 'Foreign feature', status: 'To Do', health: 'gray', completionPercent: 0, children: [], offTrain: [], isExternal: true }],
    };

    const groups = mapBlueprintToGroups([withExternal, onlyExternalPe], new Set());
    // The external sibling is gone, and the all-external PE is omitted entirely.
    expect(groups).toHaveLength(1);
    expect(groups[0].features.map((feature) => feature.key)).toEqual(['F-1', 'F-2']);
  });

  it('maps custom-JQL items into a single ungrouped group', () => {
    const items = [{ feature: { key: 'C-9', summary: 'Custom', status: 'Done', health: 'green' }, totalChildCount: 5 }] as unknown as FeatureReviewItem[];
    const groups = mapJqlItemsToGroups(items, new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0].programEpicSummary).toBe(CUSTOM_QUERY_GROUP_LABEL);
    expect(groups[0].features[0]).toMatchObject({ key: 'C-9', childCount: 5, programEpicKey: null });
  });

  it('returns no groups for an empty JQL result', () => {
    expect(mapJqlItemsToGroups([], new Set())).toEqual([]);
  });

  it('filters by key/summary and drops empty groups', () => {
    const groups = mapBlueprintToGroups([programEpic()], new Set());
    expect(filterGroupsBySearch(groups, 'payment')[0].features.map((feature) => feature.key)).toEqual(['F-2']);
    expect(filterGroupsBySearch(groups, 'nope')).toEqual([]);
    expect(filterGroupsBySearch(groups, '  ')).toHaveLength(1); // blank = no-op
  });

  it('collects only not-already-on-canvas keys for select-all', () => {
    const groups = mapBlueprintToGroups([programEpic()], new Set(['F-1']));
    expect(collectSelectableKeys(groups)).toEqual(['F-2']);
  });

  it('addable keys = selected minus already-on-canvas (dedup)', () => {
    expect(collectAddableKeys(new Set(['F-1', 'F-2', 'F-3']), new Set(['F-2']))).toEqual(['F-1', 'F-3']);
  });
});
