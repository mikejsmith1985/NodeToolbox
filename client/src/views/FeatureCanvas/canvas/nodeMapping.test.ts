// nodeMapping.test.ts — Verifies the join of live feature data with the persisted overlay.

import { describe, expect, it } from 'vitest';

import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import { createEmptyOverlay } from '../overlay/overlayModel.ts';
import { collectMissingNodeStates, computeDefaultPosition, mapFeaturesToNodes } from './nodeMapping.ts';

function buildFeatureItem(overrides: Partial<FeatureReviewItem> = {}): FeatureReviewItem {
  return {
    feature: {
      type: 'feature',
      key: 'DENP-1',
      summary: 'Login redesign',
      status: 'In Progress',
      health: 'yellow',
      completionPercent: 40,
      isExternal: false,
      offTrain: [],
      children: [
        { type: 'story', key: 'DENP-2', summary: 'S1', status: 'Done', statusCategoryKey: 'done', issueType: 'Story', assignee: null, assigneeAvatar: null, storyPoints: 3, teamName: null, isOffTrain: false, offTrainReasons: [], subtasks: [] },
        { type: 'story', key: 'DENP-3', summary: 'S2', status: 'To Do', statusCategoryKey: 'new', issueType: 'Story', assignee: null, assigneeAvatar: null, storyPoints: 2, teamName: null, isOffTrain: false, offTrainReasons: [], subtasks: [] },
      ],
    },
    featureIssue: {
      key: 'DENP-1',
      fields: {
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Ada Lovelace' },
        issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { key: 'DENP-9' } }],
        description: 'A concise epic description.',
        customfield_10274: 8,
        attachment: [
          { id: '900', filename: 'spec.pdf', size: 2048, mimeType: 'application/pdf', content: 'https://jira/secure/attachment/900/spec.pdf', created: '2026-01-02T00:00:00.000+0000', author: { displayName: 'Grace Hopper' } },
        ],
      },
    } as unknown as FeatureReviewItem['featureIssue'],
    hygieneFlags: [{ checkId: 'no-ac', label: 'Missing acceptance criteria', severity: 'warn' }],
    blockedChildCount: 0,
    doneChildCount: 1,
    inFlightChildCount: 0,
    totalChildCount: 2,
    ...overrides,
  };
}

describe('nodeMapping', () => {
  it('joins live feature data with overlay defaults and rolls up child points', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    const [node] = mapFeaturesToNodes([buildFeatureItem()], overlay);
    expect(node.summary).toBe('Login redesign');
    expect(node.statusCategoryKey).toBe('indeterminate');
    expect(node.assignee).toBe('Ada Lovelace');
    expect(node.storyPoints).toBe(5);
    expect(node.effectivePoints).toBe(5);
    expect(node.hygieneFlags).toHaveLength(1);
    expect(node.childStories.map((story) => story.key)).toEqual(['DENP-2', 'DENP-3']);
    expect(node.dependencies).toEqual([{ targetKey: 'DENP-9', type: 'Blocks', direction: 'inward' }]);
    expect(node.businessValue).toBe(8);
    expect(node.description).toBe('A concise epic description.');
    expect(node.attachments).toEqual([
      {
        id: '900',
        filename: 'spec.pdf',
        sizeBytes: 2048,
        contentUrl: 'https://jira/secure/attachment/900/spec.pdf',
        mimeType: 'application/pdf',
        author: 'Grace Hopper',
        created: '2026-01-02T00:00:00.000+0000',
      },
    ]);
  });

  it('reads Business Value from a numeric string or a Select {value} object, else null', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    const asString = buildFeatureItem();
    (asString.featureIssue.fields as Record<string, unknown>).customfield_10274 = '13';
    expect(mapFeaturesToNodes([asString], overlay)[0].businessValue).toBe(13);

    const asSelect = buildFeatureItem();
    (asSelect.featureIssue.fields as Record<string, unknown>).customfield_10274 = { value: '21' };
    expect(mapFeaturesToNodes([asSelect], overlay)[0].businessValue).toBe(21);

    const unset = buildFeatureItem();
    (unset.featureIssue.fields as Record<string, unknown>).customfield_10274 = null;
    expect(mapFeaturesToNodes([unset], overlay)[0].businessValue).toBeNull();
  });

  it('prefers an overlay size over live points for the capacity unit', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    overlay.nodes['DENP-1'] = { issueKey: 'DENP-1', position: { x: 7, y: 8 }, size: 'XL', priority: null, containerId: null, isExpanded: false, isParked: false };
    const [node] = mapFeaturesToNodes([buildFeatureItem()], overlay);
    expect(node.position).toEqual({ x: 7, y: 8 });
    expect(node.effectivePoints).toBe(8);
  });

  it('lays out never-placed features on a default grid', () => {
    expect(computeDefaultPosition(0)).toEqual({ x: 0, y: 0 });
    expect(computeDefaultPosition(5)).toEqual({ x: 0, y: 220 });
  });

  it('collects node states only for features not yet placed', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    overlay.nodes['DENP-1'] = { issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: null, isExpanded: false, isParked: false };
    const missing = collectMissingNodeStates([buildFeatureItem(), buildFeatureItem({ feature: { ...buildFeatureItem().feature, key: 'DENP-50' } })], overlay);
    expect(missing.map((state) => state.issueKey)).toEqual(['DENP-50']);
  });
});
