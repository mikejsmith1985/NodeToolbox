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
});
