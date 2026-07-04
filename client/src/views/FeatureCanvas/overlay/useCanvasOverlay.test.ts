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
});
