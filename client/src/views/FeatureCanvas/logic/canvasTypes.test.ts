// canvasTypes.test.ts — Type-shape guard for the derived canvas projections.
//
// canvasTypes.ts is a declaration-only module (interfaces, no runtime code). This test pins the
// field names the rest of the feature depends on: if a field is renamed or dropped, the typed
// literals below fail to compile, catching the breakage at build time.

import { describe, expect, it } from 'vitest';

import type { CanvasNode, CommitDiffItem, ContainerCapacity, WipSnapshot } from './canvasTypes.ts';

describe('canvasTypes', () => {
  it('pins the CanvasNode capacity and arrangement fields', () => {
    const node: Pick<CanvasNode, 'issueKey' | 'effectivePoints' | 'containerId' | 'isParked'> = {
      issueKey: 'DENP-1', effectivePoints: 5, containerId: null, isParked: false,
    };
    expect(node.effectivePoints).toBe(5);
  });

  it('pins the container-capacity status values', () => {
    const capacity: Pick<ContainerCapacity, 'status' | 'overBy'> = { status: 'over', overBy: 3 };
    expect(capacity.status).toBe('over');
  });

  it('pins the WIP snapshot and commit-diff shapes', () => {
    const wip: Pick<WipSnapshot, 'overflow' | 'parkedCount'> = { overflow: 2, parkedCount: 4 };
    const diffItem: Pick<CommitDiffItem, 'kind' | 'dependsOn' | 'selected'> = { kind: 'sprintAssign', dependsOn: null, selected: true };
    expect(wip.overflow).toBe(2);
    expect(diffItem.kind).toBe('sprintAssign');
  });
});
