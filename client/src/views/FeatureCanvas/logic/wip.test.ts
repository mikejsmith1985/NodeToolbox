// wip.test.ts — Verifies Stage 2 work-in-progress counting and overflow.

import { describe, expect, it } from 'vitest';

import type { CanvasNode } from './canvasTypes.ts';
import { computeWipSnapshot } from './wip.ts';

function buildNode(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    issueKey: 'DENP-1',
    position: { x: 0, y: 0 },
    size: null,
    priority: null,
    containerId: null,
    isExpanded: false,
    isParked: false,
    summary: '',
    status: 'In Progress',
    statusCategoryKey: 'indeterminate',
    assignee: null,
    storyPoints: null,
    health: 'green',
    completionPercent: 0,
    hygieneFlags: [],
    childStories: [],
    dependencies: [],
    businessValue: null,
    description: null,
    acceptanceCriteria: null,
    attachments: [],
    effectivePoints: 0,
    ...overrides,
  };
}

describe('computeWipSnapshot', () => {
  it('counts in-progress nodes and reports overflow above the limit', () => {
    const nodes = Array.from({ length: 12 }, (_unused, index) =>
      buildNode({ issueKey: `DENP-${index}`, statusCategoryKey: 'indeterminate' }));
    const snapshot = computeWipSnapshot(nodes, 5);
    expect(snapshot.inProgressCount).toBe(12);
    expect(snapshot.overflow).toBe(7);
  });

  it('excludes parked nodes from the in-progress count', () => {
    const nodes = [
      buildNode({ statusCategoryKey: 'indeterminate', isParked: true }),
      buildNode({ statusCategoryKey: 'indeterminate', isParked: false }),
    ];
    const snapshot = computeWipSnapshot(nodes, null);
    expect(snapshot.inProgressCount).toBe(1);
    expect(snapshot.parkedCount).toBe(1);
    expect(snapshot.overflow).toBe(0);
  });

  it('does not count To Do or Done nodes as in progress', () => {
    const nodes = [
      buildNode({ statusCategoryKey: 'new' }),
      buildNode({ statusCategoryKey: 'done' }),
    ];
    expect(computeWipSnapshot(nodes, 3).inProgressCount).toBe(0);
  });

  it('reports the story-level active load across non-parked features', () => {
    const activeStory = { key: 's1', summary: '', status: 'In Progress', statusCategoryKey: 'indeterminate', storyPoints: null };
    const doneStory = { key: 's2', summary: '', status: 'Done', statusCategoryKey: 'done', storyPoints: null };
    const nodes = [
      buildNode({ issueKey: 'A', statusCategoryKey: 'indeterminate', childStories: [activeStory, activeStory, doneStory] }),
      buildNode({ issueKey: 'B', statusCategoryKey: 'new', childStories: [activeStory] }),
      // Parked features are excluded entirely, including their active stories.
      buildNode({ issueKey: 'C', statusCategoryKey: 'indeterminate', isParked: true, childStories: [activeStory, activeStory] }),
    ];
    const snapshot = computeWipSnapshot(nodes, 5);
    // Feature count only sees the one non-parked in-progress feature (A); B is 'new', C is parked.
    expect(snapshot.inProgressCount).toBe(1);
    // Story count sees 2 active in A + 1 active in B; C's are excluded because it is parked.
    expect(snapshot.activeStoryCount).toBe(3);
  });
});
