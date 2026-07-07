// useCapacityPlan.test.ts — Unit tests for the pure child→bucket/rank derivation the hook depends on.
//
// The hook itself performs a live Jira fetch, so its network path is exercised elsewhere; this pins the
// deterministic priority-derivation helper (buildChildBucketRankMap), which decides what work is planned
// and in what order.

import { describe, expect, it } from 'vitest';

import type { MoscowBucket } from '../overlay/overlayModel.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import { buildChildBucketRankMap } from './useCapacityPlan.ts';

/** Builds a minimal feature node with a MoSCoW priority and the given child-story keys. */
function buildFeature(issueKey: string, priority: MoscowBucket | null, childKeys: string[]): CanvasNode {
  return {
    issueKey, position: { x: 0, y: 0 }, size: null, priority, containerId: null,
    isExpanded: false, isParked: false, parkReason: null, storyPlacements: {}, pendingComment: '',
    summary: issueKey, status: 'To Do', statusCategoryKey: 'new', assignee: null, storyPoints: null,
    businessValue: null, description: null, acceptanceCriteria: null, health: 'green', completionPercent: 0,
    hygieneFlags: [], dependencies: [], attachments: [], effectivePoints: 0,
    childStories: childKeys.map((key) => ({ key, summary: key, status: 'To Do', statusCategoryKey: 'new', storyPoints: 3 })),
  };
}

describe('buildChildBucketRankMap', () => {
  it('assigns each child its parent feature bucket, ranking features within a bucket by issueKey', () => {
    const nodes = [
      buildFeature('DENP-20', 'Must', ['DENP-201']),
      buildFeature('DENP-10', 'Must', ['DENP-101']),
    ];
    const map = buildChildBucketRankMap(nodes, new Set<MoscowBucket>(['Must']));
    // DENP-10 sorts before DENP-20, so its children rank 0 and DENP-20's rank 1.
    expect(map.get('DENP-101')).toEqual({ bucket: 'Must', rankInBucket: 0 });
    expect(map.get('DENP-201')).toEqual({ bucket: 'Must', rankInBucket: 1 });
  });

  it('excludes features whose priority is not in the included buckets', () => {
    const nodes = [buildFeature('DENP-1', 'Should', ['DENP-11'])];
    const map = buildChildBucketRankMap(nodes, new Set<MoscowBucket>(['Must']));
    expect(map.has('DENP-11')).toBe(false);
  });

  it('excludes unprioritized features (null priority) from planning', () => {
    const nodes = [buildFeature('DENP-2', null, ['DENP-21'])];
    const map = buildChildBucketRankMap(nodes, new Set<MoscowBucket>(['Must', 'Should', 'Could', 'Wont']));
    expect(map.has('DENP-21')).toBe(false);
  });
});
