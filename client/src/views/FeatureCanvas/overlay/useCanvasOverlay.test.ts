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

  it('persists mutations so a reload restores the plan', () => {
    const { result } = renderHook(() => useCanvasOverlay('team-a', 'denp:pi-1'));
    act(() => result.current.setWipLimit(7));

    const reloaded = loadOverlay('team-a', 'denp:pi-1');
    expect(reloaded.wipLimit).toBe(7);
  });
});
