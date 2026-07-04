// commitDiff.test.ts — Verifies the Review & Commit diff, including FR-6.1a expansion and ordering.

import { describe, expect, it } from 'vitest';

import type { CanvasContainer } from '../overlay/overlayModel.ts';
import type { CanvasNode } from './canvasTypes.ts';
import { buildCommitDiff } from './commitDiff.ts';

function buildNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
    isExpanded: false, isParked: false, summary: '', status: '', statusCategoryKey: 'new',
    assignee: null, storyPoints: null, health: 'green', completionPercent: 0, hygieneFlags: [],
    childStories: [], dependencies: [], businessValue: null, description: null, attachments: [], effectivePoints: 0, ...overrides,
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

describe('buildCommitDiff', () => {
  it('expands a feature→sprint into one sprintAssign per child story (FR-6.1a)', () => {
    const sprint = buildContainer({ id: 'ctr-s', kind: 'sprint' });
    const feature = buildNode({
      issueKey: 'DENP-1', containerId: 'ctr-s',
      childStories: [
        { key: 'DENP-2', summary: '', status: '', statusCategoryKey: null, storyPoints: null },
        { key: 'DENP-3', summary: '', status: '', statusCategoryKey: null, storyPoints: null },
      ],
    });
    const diff = buildCommitDiff([feature], [sprint]);
    expect(diff.filter((item) => item.kind === 'sprintAssign').map((item) => item.issueKey)).toEqual(['DENP-2', 'DENP-3']);
  });

  it('assigns a childless feature to the sprint directly', () => {
    const sprint = buildContainer({ id: 'ctr-s', kind: 'sprint' });
    const feature = buildNode({ issueKey: 'DENP-9', containerId: 'ctr-s', childStories: [] });
    const diff = buildCommitDiff([feature], [sprint]);
    expect(diff.filter((item) => item.kind === 'sprintAssign').map((item) => item.issueKey)).toEqual(['DENP-9']);
  });

  it('emits one versionAssign for a feature→release box', () => {
    const release = buildContainer({ id: 'ctr-r', kind: 'release', title: '6/25' });
    const feature = buildNode({ issueKey: 'DENP-1', containerId: 'ctr-r' });
    const diff = buildCommitDiff([feature], [release]);
    const versionAssigns = diff.filter((item) => item.kind === 'versionAssign');
    expect(versionAssigns).toHaveLength(1);
    expect(versionAssigns[0].to).toBe('6/25');
  });

  it('orders container-create items before dependent assignments and links dependsOn', () => {
    const provisionalSprint = buildContainer({
      id: 'ctr-p', kind: 'sprint', title: 'Sprint 25',
      provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
    });
    const feature = buildNode({ issueKey: 'DENP-1', containerId: 'ctr-p', childStories: [] });
    const diff = buildCommitDiff([feature], [provisionalSprint]);
    expect(diff[0].kind).toBe('createSprint');
    expect(diff.find((item) => item.kind === 'sprintAssign')?.dependsOn).toBe('create:ctr-p');
  });

  it('emits a pointsSet only when a size maps to a value differing from live points', () => {
    const sized = buildNode({ issueKey: 'DENP-1', size: 'L', storyPoints: 2 });
    const alreadyCorrect = buildNode({ issueKey: 'DENP-2', size: 'M', storyPoints: 3 });
    const pointsItems = buildCommitDiff([sized, alreadyCorrect], []).filter((item) => item.kind === 'pointsSet');
    expect(pointsItems).toHaveLength(1);
    expect(pointsItems[0]).toMatchObject({ issueKey: 'DENP-1', to: 5 });
  });

  it('does not commit parking-lot membership', () => {
    const parkingLot = buildContainer({ id: 'ctr-park', kind: 'parkingLot', capacityBudget: null });
    const parked = buildNode({ issueKey: 'DENP-1', containerId: 'ctr-park', isParked: true });
    expect(buildCommitDiff([parked], [parkingLot])).toHaveLength(0);
  });

  it('emits a prioritySet only when a MoSCoW→Jira mapping is provided', () => {
    const node = buildNode({ issueKey: 'DENP-1', priority: 'Must' });
    expect(buildCommitDiff([node], [])).toHaveLength(0);
    const mapped = buildCommitDiff([node], [], { priorityToJira: { Must: 'Highest' } });
    expect(mapped.filter((item) => item.kind === 'prioritySet')[0].to).toBe('Highest');
  });
});
