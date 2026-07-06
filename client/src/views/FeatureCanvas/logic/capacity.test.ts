// capacity.test.ts — Verifies Stage 5 container capacity math.

import { describe, expect, it } from 'vitest';

import type { CanvasContainer } from '../overlay/overlayModel.ts';
import type { CanvasNode } from './canvasTypes.ts';
import { classifyCapacity, computeContainerCapacity, sumContainerPoints } from './capacity.ts';

function buildNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
    isExpanded: false, isParked: false, summary: '', status: '', statusCategoryKey: 'new',
    assignee: null, storyPoints: null, health: 'green', completionPercent: 0, hygieneFlags: [],
    childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null, storyPlacements: {}, pendingComment: "", attachments: [], effectivePoints: 0, ...overrides,
  };
}

function buildContainer(overrides: Partial<CanvasContainer> = {}): CanvasContainer {
  return {
    id: 'ctr-1', kind: 'sprint', title: 'Sprint 24', bounds: { x: 0, y: 0, width: 400, height: 300 },
    capacityBudget: null,
    provenance: { state: 'real', jiraSprintId: 100, jiraVersionName: null, startDateIso: null, endDateIso: null },
    ...overrides,
  };
}

describe('capacity', () => {
  it('sums effective points of member nodes only', () => {
    const nodes = [
      buildNode({ issueKey: 'A', containerId: 'ctr-1', effectivePoints: 5 }),
      buildNode({ issueKey: 'B', containerId: 'ctr-1', effectivePoints: 3 }),
      buildNode({ issueKey: 'C', containerId: 'ctr-2', effectivePoints: 8 }),
    ];
    expect(sumContainerPoints('ctr-1', nodes)).toBe(8);
  });

  it('classifies under, at, and over a budget', () => {
    expect(classifyCapacity(4, 5)).toBe('under');
    expect(classifyCapacity(5, 5)).toBe('at');
    expect(classifyCapacity(6, 5)).toBe('over');
  });

  it('treats a budget-less container as always under', () => {
    expect(classifyCapacity(999, null)).toBe('under');
  });

  it('reports the amount over budget', () => {
    const container = buildContainer({ id: 'ctr-1', capacityBudget: 5 });
    const nodes = [buildNode({ containerId: 'ctr-1', effectivePoints: 8 })];
    const capacity = computeContainerCapacity(container, nodes);
    expect(capacity.status).toBe('over');
    expect(capacity.overBy).toBe(3);
  });
});
