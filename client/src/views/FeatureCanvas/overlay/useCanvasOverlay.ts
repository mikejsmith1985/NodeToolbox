// useCanvasOverlay.ts — React hook that owns the planning overlay for one team + PI scope.
//
// The overlay is scoped per team+PI, so it is held as scoped React state (loaded once per
// scope) rather than a global store, and every mutation persists immediately to localStorage.
// All mutators are stable callbacks so the canvas can pass them to memoized child nodes.

import { useCallback, useMemo, useState } from 'react';

import {
  type CanvasContainer,
  type CanvasNodeState,
  type CanvasOverlay,
  type MoscowBucket,
  type StageId,
  type TshirtSize,
} from './overlayModel.ts';
import { loadOverlay, saveOverlay } from './overlayStorage.ts';

/** The overlay state plus the stable mutators the canvas uses to change it. */
export interface CanvasOverlayController {
  overlay: CanvasOverlay;
  ensureNodeStates: (nodeStates: readonly CanvasNodeState[]) => void;
  updateNode: (issueKey: string, changes: Partial<CanvasNodeState>) => void;
  setWipLimit: (wipLimit: number | null) => void;
  setPriority: (issueKey: string, priority: MoscowBucket | null) => void;
  setSize: (issueKey: string, size: TshirtSize | null) => void;
  setContainer: (issueKey: string, containerId: string | null) => void;
  setParked: (issueKey: string, isParked: boolean) => void;
  addContainer: (container: CanvasContainer) => void;
  updateContainer: (containerId: string, changes: Partial<CanvasContainer>) => void;
  goToStage: (stageId: StageId) => void;
  completeStage: (stageId: StageId) => void;
}

/** Persists an overlay after stamping it as the caller's latest save. */
function persist(overlay: CanvasOverlay, updatedAtIso: string): CanvasOverlay {
  const stamped = { ...overlay, updatedAtIso };
  saveOverlay(stamped);
  return stamped;
}

/** Loads and manages the planning overlay for the given team profile + scope. */
export function useCanvasOverlay(profileId: string, scopeKey: string): CanvasOverlayController {
  const [overlay, setOverlay] = useState<CanvasOverlay>(() => loadOverlay(profileId, scopeKey));
  const [loadedScopeSignature, setLoadedScopeSignature] = useState(`${profileId}:${scopeKey}`);

  // Reload the saved plan when the team/PI scope changes, using React's endorsed
  // set-state-during-render pattern (not an effect) so each scope shows its own overlay.
  const currentScopeSignature = `${profileId}:${scopeKey}`;
  if (currentScopeSignature !== loadedScopeSignature) {
    setLoadedScopeSignature(currentScopeSignature);
    setOverlay(loadOverlay(profileId, scopeKey));
  }

  const mutate = useCallback((mutator: (previous: CanvasOverlay) => CanvasOverlay) => {
    setOverlay((previous) => persist(mutator(previous), new Date().toISOString()));
  }, []);

  const updateNode = useCallback((issueKey: string, changes: Partial<CanvasNodeState>) => {
    mutate((previous) => {
      const existing = previous.nodes[issueKey];
      if (!existing) {
        return previous;
      }
      return { ...previous, nodes: { ...previous.nodes, [issueKey]: { ...existing, ...changes } } };
    });
  }, [mutate]);

  const ensureNodeStates = useCallback((nodeStates: readonly CanvasNodeState[]) => {
    if (nodeStates.length === 0) {
      return;
    }
    mutate((previous) => {
      const nextNodes = { ...previous.nodes };
      let didAdd = false;
      for (const nodeState of nodeStates) {
        if (nextNodes[nodeState.issueKey] === undefined) {
          nextNodes[nodeState.issueKey] = nodeState;
          didAdd = true;
        }
      }
      return didAdd ? { ...previous, nodes: nextNodes } : previous;
    });
  }, [mutate]);

  const setWipLimit = useCallback((wipLimit: number | null) => mutate((previous) => ({ ...previous, wipLimit })), [mutate]);
  const setPriority = useCallback((issueKey: string, priority: MoscowBucket | null) => updateNode(issueKey, { priority }), [updateNode]);
  const setSize = useCallback((issueKey: string, size: TshirtSize | null) => updateNode(issueKey, { size }), [updateNode]);
  const setContainer = useCallback((issueKey: string, containerId: string | null) => updateNode(issueKey, { containerId }), [updateNode]);
  const setParked = useCallback((issueKey: string, isParked: boolean) => updateNode(issueKey, { isParked }), [updateNode]);

  const addContainer = useCallback((container: CanvasContainer) => {
    mutate((previous) => ({ ...previous, containers: [...previous.containers, container] }));
  }, [mutate]);

  const updateContainer = useCallback((containerId: string, changes: Partial<CanvasContainer>) => {
    mutate((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => (container.id === containerId ? { ...container, ...changes } : container)),
    }));
  }, [mutate]);

  const goToStage = useCallback((stageId: StageId) => {
    mutate((previous) => ({ ...previous, stageState: { ...previous.stageState, currentStageId: stageId } }));
  }, [mutate]);

  const completeStage = useCallback((stageId: StageId) => {
    mutate((previous) => ({
      ...previous,
      stageState: { ...previous.stageState, completed: { ...previous.stageState.completed, [stageId]: true } },
    }));
  }, [mutate]);

  return useMemo(
    () => ({
      overlay, ensureNodeStates, updateNode, setWipLimit, setPriority, setSize,
      setContainer, setParked, addContainer, updateContainer, goToStage, completeStage,
    }),
    [overlay, ensureNodeStates, updateNode, setWipLimit, setPriority, setSize, setContainer, setParked, addContainer, updateContainer, goToStage, completeStage],
  );
}
