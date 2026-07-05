// useCanvasOverlay.test.ts — Verifies the overlay controller mutators and persistence.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createNodeState, type CanvasContainer } from './overlayModel.ts';
import { loadOverlay } from './overlayStorage.ts';
import { useCanvasOverlay } from './useCanvasOverlay.ts';

const CONTAINER: CanvasContainer = {
  id: 'ctr-1', kind: 'sprint', title: 'Sprint 25', bounds: { x: 0, y: 0, width: 400, height: 300 },
  capacityBudget: 20,
  provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
};

describe('useCanvasOverlay', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('adds node states and mutates their overlay attributes', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));

    act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0)]));
    expect(result.current.overlay.nodes['DENP-1']).toBeDefined();

    act(() => result.current.setPriority('DENP-1', 'Must'));
    act(() => result.current.setSize('DENP-1', 'L'));
    act(() => result.current.setParked('DENP-1', true));
    expect(result.current.overlay.nodes['DENP-1']).toMatchObject({ priority: 'Must', size: 'L', isParked: true });
  });

  it('sets the WIP limit, adds containers, and advances the stage', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));

    act(() => result.current.setWipLimit(5));
    act(() => result.current.addContainer(CONTAINER));
    act(() => result.current.goToStage('size'));

    expect(result.current.overlay.wipLimit).toBe(5);
    expect(result.current.overlay.containers).toHaveLength(1);
    expect(result.current.overlay.stageState.currentStageId).toBe('size');
  });

  it('removes a container and unassigns its member nodes without losing them', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));

    act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0)]));
    act(() => result.current.addContainer(CONTAINER));
    act(() => result.current.setContainer('DENP-1', CONTAINER.id));
    expect(result.current.overlay.nodes['DENP-1'].containerId).toBe(CONTAINER.id);

    act(() => result.current.removeContainer(CONTAINER.id));

    expect(result.current.overlay.containers).toHaveLength(0);
    // The node survives — it is simply no longer boxed.
    expect(result.current.overlay.nodes['DENP-1']).toBeDefined();
    expect(result.current.overlay.nodes['DENP-1'].containerId).toBeNull();
  });

  it('persists mutations so a reload restores the plan', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
    act(() => result.current.setWipLimit(7));

    const reloaded = loadOverlay('team-a', 'denp:pi-1');
    expect(reloaded.wipLimit).toBe(7);
  });

  it('restores the full arrangement after a remount — resume fidelity (SC-10)', () => {
    const first = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
    act(() => first.result.current.ensureNodeStates([createNodeState('DENP-1', 10, 20)]));
    act(() => {
      first.result.current.setSize('DENP-1', 'L');
      first.result.current.setPriority('DENP-1', 'Must');
      first.result.current.addContainer(CONTAINER);
      first.result.current.setWipLimit(4);
      first.result.current.goToStage('size');
    });
    first.unmount();

    // A fresh mount of the same team+scope is exactly what reopening the canvas does.
    const second = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
    const restored = second.result.current.overlay;
    expect(restored.nodes['DENP-1']).toMatchObject({ position: { x: 10, y: 20 }, size: 'L', priority: 'Must' });
    expect(restored.wipLimit).toBe(4);
    expect(restored.containers).toHaveLength(1);
    expect(restored.stageState.currentStageId).toBe('size');
  });

  it('removeNode drops exactly one node and leaves others and containers untouched', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
    act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0), createNodeState('DENP-2', 0, 0)]));
    act(() => result.current.addContainer(CONTAINER));

    act(() => result.current.removeNode('DENP-1'));

    expect(result.current.overlay.nodes['DENP-1']).toBeUndefined();
    expect(result.current.overlay.nodes['DENP-2']).toBeDefined();
    expect(result.current.overlay.containers).toHaveLength(1);
  });

  it('clearNodes resets the whole canvas — nodes, boxes, WIP limit, and the coaching stages', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
    act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0), createNodeState('DENP-2', 0, 0)]));
    act(() => result.current.addContainer(CONTAINER));
    act(() => result.current.setWipLimit(5));
    act(() => result.current.goToStage('size'));
    act(() => result.current.completeStage('surface'));

    act(() => result.current.clearNodes());

    expect(Object.keys(result.current.overlay.nodes)).toHaveLength(0);
    expect(result.current.overlay.containers).toHaveLength(0);
    expect(result.current.overlay.wipLimit).toBeNull();
    expect(result.current.overlay.stageState.currentStageId).toBe('surface');
    expect(result.current.overlay.stageState.completed.surface).toBe(false);
  });

  describe('box routing (park / complete / assign)', () => {
    it('parkNode auto-creates the Parking Lot, moves the card in, marks parked, and records the reason', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0)]));

      act(() => result.current.parkNode('DENP-1', 'stale — no activity in 3 sprints'));

      const lot = result.current.overlay.containers.find((container) => container.kind === 'parkingLot');
      expect(lot).toBeDefined();
      const node = result.current.overlay.nodes['DENP-1'];
      expect(node.isParked).toBe(true);
      expect(node.parkReason).toBe('stale — no activity in 3 sprints');
      expect(node.containerId).toBe(lot!.id);
      // The card was repositioned inside the box, not left at the origin.
      expect(node.position).not.toEqual({ x: 0, y: 0 });
    });

    it('reuses a single Parking Lot for multiple parks', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0), createNodeState('DENP-2', 0, 0)]));
      act(() => result.current.parkNode('DENP-1'));
      act(() => result.current.parkNode('DENP-2'));
      expect(result.current.overlay.containers.filter((container) => container.kind === 'parkingLot')).toHaveLength(1);
    });

    it('completeNode auto-creates the Complete box and moves the card in (not parked)', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0)]));
      act(() => result.current.completeNode('DENP-1'));

      const doneBox = result.current.overlay.containers.find((container) => container.kind === 'complete');
      expect(doneBox).toBeDefined();
      expect(result.current.overlay.nodes['DENP-1'].containerId).toBe(doneBox!.id);
      expect(result.current.overlay.nodes['DENP-1'].isParked).toBe(false);
    });

    it('assignToContainer moves the card into an existing box and repositions it', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 5, 5)]));
      act(() => result.current.addContainer(CONTAINER));
      act(() => result.current.assignToContainer('DENP-1', CONTAINER.id));

      expect(result.current.overlay.nodes['DENP-1'].containerId).toBe(CONTAINER.id);
      expect(result.current.overlay.nodes['DENP-1'].position).not.toEqual({ x: 5, y: 5 });
    });

    it('moveContainer shifts the box and every card inside it by the same delta', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0), createNodeState('OUT-1', 999, 999)]));
      act(() => result.current.addContainer(CONTAINER)); // bounds x:0 y:0
      act(() => result.current.assignToContainer('DENP-1', CONTAINER.id));
      const memberBefore = result.current.overlay.nodes['DENP-1'].position;

      act(() => result.current.moveContainer(CONTAINER.id, 100, 60));

      const box = result.current.overlay.containers.find((container) => container.id === CONTAINER.id)!;
      expect(box.bounds).toMatchObject({ x: 100, y: 60 });
      // The member moved by the same delta (+100, +60); a non-member did not move.
      expect(result.current.overlay.nodes['DENP-1'].position).toEqual({ x: memberBefore.x + 100, y: memberBefore.y + 60 });
      expect(result.current.overlay.nodes['OUT-1'].position).toEqual({ x: 999, y: 999 });
    });

    it('applyMasterPlan sizes, prioritizes, routes every feature to a box (Later for unsequenced), in one undo step', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('KEEP-1', 0, 0), createNodeState('PARK-1', 0, 0), createNodeState('DONE-1', 0, 0), createNodeState('LATER-1', 0, 0)]));

      act(() => result.current.applyMasterPlan([
        { issueKey: 'KEEP-1', size: 'L', bucket: 'Must', triage: 'keep', sprint: 'Sprint 25', reason: '' },
        { issueKey: 'PARK-1', size: 'S', bucket: 'Wont', triage: 'park', sprint: null, reason: 'stale' },
        { issueKey: 'DONE-1', size: null, bucket: null, triage: 'complete', sprint: null, reason: '' },
        { issueKey: 'LATER-1', size: 'M', bucket: 'Could', triage: 'keep', sprint: null, reason: '' }, // kept but no sprint → Later
      ]));

      const overlay = result.current.overlay;
      const sprint = overlay.containers.find((container) => container.kind === 'sprint' && container.title === 'Sprint 25');
      const lot = overlay.containers.find((container) => container.kind === 'parkingLot');
      const done = overlay.containers.find((container) => container.kind === 'complete');
      const later = overlay.containers.find((container) => container.kind === 'later');
      expect(sprint && lot && done && later).toBeTruthy();

      expect(overlay.nodes['KEEP-1']).toMatchObject({ size: 'L', priority: 'Must', containerId: sprint!.id, isParked: false });
      expect(overlay.nodes['PARK-1']).toMatchObject({ size: 'S', priority: 'Wont', containerId: lot!.id, isParked: true, parkReason: 'stale' });
      expect(overlay.nodes['DONE-1']).toMatchObject({ containerId: done!.id, isParked: false });
      expect(overlay.nodes['LATER-1']).toMatchObject({ containerId: later!.id, isParked: false });
      // Nothing left loose.
      expect(Object.values(overlay.nodes).every((node) => node.containerId !== null)).toBe(true);

      // The whole plan is one undo step.
      act(() => result.current.undo());
      expect(result.current.overlay.containers).toHaveLength(0);
      expect(result.current.overlay.nodes['KEEP-1'].containerId).toBeNull();
    });

    it('relayoutBoxes tidies boxes into two columns sized to their cards', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      // Explicit ids so the two boxes never collide (createProvisionalContainer keys off Date.now()).
      const box = (id: string, title: string): CanvasContainer => ({
        id, kind: 'sprint', title, bounds: { x: 0, y: 0, width: 400, height: 260 }, capacityBudget: 20,
        provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
      });
      act(() => result.current.ensureNodeStates([createNodeState('A', 0, 0), createNodeState('B', 0, 0)]));
      act(() => result.current.addContainer(box('c-a', 'S1')));
      act(() => result.current.addContainer(box('c-b', 'S2')));
      act(() => result.current.assignToContainer('A', 'c-a'));
      act(() => result.current.assignToContainer('B', 'c-a'));

      act(() => result.current.relayoutBoxes());

      const first = result.current.overlay.containers.find((container) => container.id === 'c-a')!;
      const second = result.current.overlay.containers.find((container) => container.id === 'c-b')!;
      // Two boxes → two columns; the two-card box is taller than the empty one.
      expect(first.bounds.x).not.toBe(second.bounds.x);
      expect(first.bounds.height).toBeGreaterThan(second.bounds.height);
    });

    it('unparkNode clears parked state, reason, and box membership', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0)]));
      act(() => result.current.parkNode('DENP-1', 'stale'));
      act(() => result.current.unparkNode('DENP-1'));

      const node = result.current.overlay.nodes['DENP-1'];
      expect(node.isParked).toBe(false);
      expect(node.parkReason).toBeNull();
      expect(node.containerId).toBeNull();
    });
  });

  describe('undo / redo', () => {
    it('reports nothing to undo or redo on a fresh overlay', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });

    it('undo reverts the last change and redo re-applies it', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.setWipLimit(5));
      expect(result.current.overlay.wipLimit).toBe(5);
      expect(result.current.canUndo).toBe(true);

      act(() => result.current.undo());
      expect(result.current.overlay.wipLimit).toBeNull();
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);

      act(() => result.current.redo());
      expect(result.current.overlay.wipLimit).toBe(5);
      expect(result.current.canRedo).toBe(false);
    });

    it('steps back through several changes in reverse order', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.ensureNodeStates([createNodeState('DENP-1', 0, 0)]));
      act(() => result.current.setPriority('DENP-1', 'Must'));
      act(() => result.current.setSize('DENP-1', 'L'));

      act(() => result.current.undo()); // undoes setSize
      expect(result.current.overlay.nodes['DENP-1'].size).toBeNull();
      expect(result.current.overlay.nodes['DENP-1'].priority).toBe('Must');

      act(() => result.current.undo()); // undoes setPriority
      expect(result.current.overlay.nodes['DENP-1'].priority).toBeNull();
      expect(result.current.overlay.nodes['DENP-1']).toBeDefined();
    });

    it('a new change after undo clears the redo stack', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.setWipLimit(5));
      act(() => result.current.undo());
      expect(result.current.canRedo).toBe(true);

      act(() => result.current.setWipLimit(9));
      expect(result.current.canRedo).toBe(false);
      expect(result.current.overlay.wipLimit).toBe(9);
    });

    it('persists the undone state so a reload restores it', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.setWipLimit(7));
      act(() => result.current.undo());

      expect(loadOverlay('team-a', 'denp:pi-1').wipLimit).toBeNull();
    });

    it('undo and redo are inert when their stacks are empty', () => {
      const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
      act(() => result.current.undo());
      act(() => result.current.redo());
      expect(result.current.overlay.wipLimit).toBeNull();
    });
  });
});
