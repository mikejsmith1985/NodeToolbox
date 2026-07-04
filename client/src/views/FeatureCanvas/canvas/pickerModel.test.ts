// pickerModel.test.ts — Verifies the Custom-JQL picker mapping, search, and selection helpers.

import { describe, expect, it } from 'vitest';

import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import {
  collectAddableKeys,
  collectSelectableKeys,
  CUSTOM_QUERY_GROUP_LABEL,
  filterGroupsBySearch,
  mapJqlItemsToGroups,
} from './pickerModel.ts';

function items(): FeatureReviewItem[] {
  return [
    { feature: { key: 'C-1', summary: 'Login', status: 'To Do', health: 'yellow' }, totalChildCount: 2 },
    { feature: { key: 'C-2', summary: 'Payments', status: 'Done', health: 'green' }, totalChildCount: 5 },
  ] as unknown as FeatureReviewItem[];
}

describe('pickerModel', () => {
  it('maps custom-JQL items into a single ungrouped group with already-added flags', () => {
    const groups = mapJqlItemsToGroups(items(), new Set(['C-1']));
    expect(groups).toHaveLength(1);
    expect(groups[0].programEpicSummary).toBe(CUSTOM_QUERY_GROUP_LABEL);
    expect(groups[0].features[0]).toMatchObject({ key: 'C-1', childCount: 2, isAlreadyOnCanvas: true });
    expect(groups[0].features[1]).toMatchObject({ key: 'C-2', childCount: 5, isAlreadyOnCanvas: false });
  });

  it('returns no groups for an empty result', () => {
    expect(mapJqlItemsToGroups([], new Set())).toEqual([]);
  });

  it('filters by key/summary and drops empty groups', () => {
    const groups = mapJqlItemsToGroups(items(), new Set());
    expect(filterGroupsBySearch(groups, 'payment')[0].features.map((feature) => feature.key)).toEqual(['C-2']);
    expect(filterGroupsBySearch(groups, 'nope')).toEqual([]);
    expect(filterGroupsBySearch(groups, '  ')).toHaveLength(1); // blank = no-op
  });

  it('collects only not-already-on-canvas keys for select-all', () => {
    const groups = mapJqlItemsToGroups(items(), new Set(['C-1']));
    expect(collectSelectableKeys(groups)).toEqual(['C-2']);
  });

  it('addable keys = selected minus already-on-canvas (dedup)', () => {
    expect(collectAddableKeys(new Set(['C-1', 'C-2', 'C-3']), new Set(['C-2']))).toEqual(['C-1', 'C-3']);
  });
});
