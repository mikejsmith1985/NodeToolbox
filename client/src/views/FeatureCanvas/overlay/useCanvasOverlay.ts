// useCanvasOverlay.ts — React hook that owns the planning overlay for one team + PI scope.
//
// The overlay is scoped per team+PI, so it is held as scoped React state (loaded once per
// scope) rather than a global store, and every mutation persists immediately to localStorage.
// All mutators are stable callbacks so the canvas can pass them to memoized child nodes.

import { useCallback, useMemo, useState } from 'react';

import {
  createInitialStageState,
  type CanvasContainer,
  type CanvasNodeState,
  type CanvasOverlay,
  type MoscowBucket,
  type StageId,
  type TshirtSize,
} from './overlayModel.ts';
import { loadOverlay, saveOverlay } from './overlayStorage.ts';
import { createCompleteContainer, createParkingLotContainer, createProvisionalContainer, positionInContainer } from './containerFactory.ts';

/** One feature's full cross-phase plan, applied in a single overlay mutation (one undo step). */
export interface MasterPlanChange {
  issueKey: string;
  size: TshirtSize | null;
  bucket: MoscowBucket | null;
  triage: 'keep' | 'park' | 'complete' | 'breakout';
  sprint: string | null;
  reason: string;
}

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
  removeContainer: (containerId: string) => void;
  removeNode: (issueKey: string) => void;
  clearNodes: () => void;
  /** Moves a feature into an existing box, repositioning its card inside the box's bounds. */
  assignToContainer: (issueKey: string, containerId: string) => void;
  /** Parks a feature: auto-creates the Parking Lot box if needed, moves the card in, records the reason. */
  parkNode: (issueKey: string, reason?: string) => void;
  /** Un-parks a feature: clears parked state + reason and removes it from its box. */
  unparkNode: (issueKey: string) => void;
  /** Marks a feature done: auto-creates the Complete box if needed and moves the card in. */
  completeNode: (issueKey: string) => void;
  /** Moves a box to a new position, shifting every card inside it by the same delta so they follow. */
  moveContainer: (containerId: string, x: number, y: number) => void;
  /** Applies a whole master plan (size + priority + triage + sprint per feature) in one undo step. */
  applyMasterPlan: (changes: readonly MasterPlanChange[]) => void;
  goToStage: (stageId: StageId) => void;
  completeStage: (stageId: StageId) => void;
  /** Reverts the most recent change; no-op when there is nothing to undo. */
  undo: () => void;
  /** Re-applies the most recently undone change; no-op when there is nothing to redo. */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// The most recent overlay snapshots kept for undo. Bounded so a long editing session never grows
// memory without limit; older states beyond this depth are dropped from the undo stack.
const MAX_HISTORY_DEPTH = 50;

/**
 * The overlay plus its undo/redo history. `present` is what the canvas renders; `past` holds prior
 * snapshots (oldest first) and `future` holds undone snapshots (next-to-redo first). Every
 * change-recording action already persisted its `present` to storage, so a reload restores it.
 */
interface OverlayHistory {
  present: CanvasOverlay;
  past: CanvasOverlay[];
  future: CanvasOverlay[];
}

/** Persists an overlay after stamping it as the caller's latest save. */
function persist(overlay: CanvasOverlay, updatedAtIso: string): CanvasOverlay {
  const stamped = { ...overlay, updatedAtIso };
  saveOverlay(stamped);
  return stamped;
}

/** Loads and manages the planning overlay for the given team profile + scope. */
export function useCanvasOverlay(profileId: string, scopeKey: string): CanvasOverlayController {
  const [history, setHistory] = useState<OverlayHistory>(() => ({ present: loadOverlay(profileId, scopeKey), past: [], future: [] }));
  const [loadedScopeSignature, setLoadedScopeSignature] = useState(`${profileId}:${scopeKey}`);
  const overlay = history.present;

  // Reload the saved plan when the team/PI scope changes, using React's endorsed
  // set-state-during-render pattern (not an effect) so each scope shows its own overlay. Switching
  // scope starts a fresh history — undo never crosses from one team+PI plan into another's.
  const currentScopeSignature = `${profileId}:${scopeKey}`;
  if (currentScopeSignature !== loadedScopeSignature) {
    setLoadedScopeSignature(currentScopeSignature);
    setHistory({ present: loadOverlay(profileId, scopeKey), past: [], future: [] });
  }

  // Every mutator funnels through here, so this is the single place that records undo history: a
  // real change pushes the prior state onto `past` and clears the redo stack; a no-op (the mutator
  // returned the same reference) records nothing.
  const mutate = useCallback((mutator: (previous: CanvasOverlay) => CanvasOverlay) => {
    setHistory((current) => {
      const nextOverlay = mutator(current.present);
      if (nextOverlay === current.present) {
        return current;
      }
      const persisted = persist(nextOverlay, new Date().toISOString());
      const trimmedPast = [...current.past, current.present].slice(-MAX_HISTORY_DEPTH);
      return { present: persisted, past: trimmedPast, future: [] };
    });
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

  // Removing a box is non-destructive to the work: member nodes stay on the canvas and simply
  // become unassigned (and un-parked if they were in the Parking Lot), so nothing is lost.
  const removeContainer = useCallback((containerId: string) => {
    mutate((previous) => {
      const removedContainer = previous.containers.find((container) => container.id === containerId);
      const wasParkingLot = removedContainer?.kind === 'parkingLot';
      const nextNodes: typeof previous.nodes = {};
      for (const [issueKey, nodeState] of Object.entries(previous.nodes)) {
        nextNodes[issueKey] = nodeState.containerId === containerId
          ? { ...nodeState, containerId: null, isParked: wasParkingLot ? false : nodeState.isParked }
          : nodeState;
      }
      return {
        ...previous,
        containers: previous.containers.filter((container) => container.id !== containerId),
        nodes: nextNodes,
      };
    });
  }, [mutate]);

  // Removing a node prunes it from the curated working set (the canvas renders from overlay membership),
  // so it also drops from any commit. Overlay-only — it never touches Jira.
  const removeNode = useCallback((issueKey: string) => {
    mutate((previous) => {
      if (previous.nodes[issueKey] === undefined) {
        return previous;
      }
      const nextNodes = { ...previous.nodes };
      delete nextNodes[issueKey];
      return { ...previous, nodes: nextNodes };
    });
  }, [mutate]);

  // Resets the canvas to blank: removes all feature nodes AND boxes, clears the WIP limit, and resets
  // the coaching journey to stage 1 (nothing completed). Size mapping/config is kept. Overlay-only —
  // it never touches Jira. No-op when already fully blank so it doesn't add a spurious undo step.
  const clearNodes = useCallback(() => {
    mutate((previous) => {
      if (Object.keys(previous.nodes).length === 0 && previous.containers.length === 0) {
        return previous;
      }
      return { ...previous, nodes: {}, containers: [], wipLimit: null, stageState: createInitialStageState() };
    });
  }, [mutate]);

  // Counts a container's current members, excluding the node being (re)assigned so its own slot
  // isn't double-counted when it is already inside the box.
  const countMembers = (nodes: CanvasOverlay['nodes'], containerId: string, movingKey: string): number =>
    Object.values(nodes).filter((nodeState) => nodeState.containerId === containerId && nodeState.issueKey !== movingKey).length;

  // Moves a feature into an existing box and snaps its card to the next slot inside the box — the
  // fix for "assigned but the card never moved into the box". Parking-lot membership marks it parked.
  const assignToContainer = useCallback((issueKey: string, containerId: string) => {
    mutate((previous) => {
      const node = previous.nodes[issueKey];
      const container = previous.containers.find((candidate) => candidate.id === containerId);
      if (!node || !container) {
        return previous;
      }
      const position = positionInContainer(container, countMembers(previous.nodes, container.id, issueKey));
      const isParked = container.kind === 'parkingLot';
      return {
        ...previous,
        nodes: { ...previous.nodes, [issueKey]: { ...node, containerId, position, isParked, parkReason: isParked ? node.parkReason ?? null : null } },
      };
    });
  }, [mutate]);

  const parkNode = useCallback((issueKey: string, reason?: string) => {
    mutate((previous) => {
      const node = previous.nodes[issueKey];
      if (!node) {
        return previous;
      }
      const existingLot = previous.containers.find((candidate) => candidate.kind === 'parkingLot');
      const lot = existingLot ?? createParkingLotContainer(previous.containers.length);
      const containers = existingLot ? previous.containers : [...previous.containers, lot];
      const position = positionInContainer(lot, countMembers(previous.nodes, lot.id, issueKey));
      return {
        ...previous,
        containers,
        nodes: { ...previous.nodes, [issueKey]: { ...node, containerId: lot.id, isParked: true, parkReason: reason ?? null, position } },
      };
    });
  }, [mutate]);

  const unparkNode = useCallback((issueKey: string) => {
    mutate((previous) => {
      const node = previous.nodes[issueKey];
      if (!node || (!node.isParked && node.containerId === null)) {
        return previous;
      }
      return { ...previous, nodes: { ...previous.nodes, [issueKey]: { ...node, isParked: false, parkReason: null, containerId: null } } };
    });
  }, [mutate]);

  const completeNode = useCallback((issueKey: string) => {
    mutate((previous) => {
      const node = previous.nodes[issueKey];
      if (!node) {
        return previous;
      }
      const existingBox = previous.containers.find((candidate) => candidate.kind === 'complete');
      const doneBox = existingBox ?? createCompleteContainer(previous.containers.length);
      const containers = existingBox ? previous.containers : [...previous.containers, doneBox];
      const position = positionInContainer(doneBox, countMembers(previous.nodes, doneBox.id, issueKey));
      return {
        ...previous,
        containers,
        nodes: { ...previous.nodes, [issueKey]: { ...node, containerId: doneBox.id, isParked: false, parkReason: null, position } },
      };
    });
  }, [mutate]);

  // Moves a box and drags its members along: shift every card whose containerId matches by the same
  // delta as the box moved, so a box and its contents travel together (in one undo step).
  const moveContainer = useCallback((containerId: string, x: number, y: number) => {
    mutate((previous) => {
      const container = previous.containers.find((candidate) => candidate.id === containerId);
      if (!container || (container.bounds.x === x && container.bounds.y === y)) {
        return previous;
      }
      const deltaX = x - container.bounds.x;
      const deltaY = y - container.bounds.y;
      const nextNodes: typeof previous.nodes = {};
      for (const [issueKey, nodeState] of Object.entries(previous.nodes)) {
        nextNodes[issueKey] = nodeState.containerId === containerId
          ? { ...nodeState, position: { x: nodeState.position.x + deltaX, y: nodeState.position.y + deltaY } }
          : nodeState;
      }
      const containers = previous.containers.map((candidate) => (
        candidate.id === containerId ? { ...candidate, bounds: { ...candidate.bounds, x, y } } : candidate
      ));
      return { ...previous, containers, nodes: nextNodes };
    });
  }, [mutate]);

  // Applies an entire cross-phase plan in ONE mutation: sets size/priority, routes parked→Parking Lot
  // and done→Complete (auto-creating those boxes), and sequences the rest into their named sprint
  // (reusing an existing sprint of that title or creating a provisional one). One undo reverts it all.
  const applyMasterPlan = useCallback((changes: readonly MasterPlanChange[]) => {
    mutate((previous) => {
      let containers = [...previous.containers];
      const nodes = { ...previous.nodes };
      const ensureByKind = (kind: CanvasContainer['kind'], create: (count: number) => CanvasContainer): CanvasContainer => {
        const found = containers.find((container) => container.kind === kind);
        if (found) {
          return found;
        }
        const created = create(containers.length);
        containers = [...containers, created];
        return created;
      };
      const ensureSprintByTitle = (title: string): CanvasContainer => {
        const found = containers.find((container) => container.kind === 'sprint' && container.title.trim().toLowerCase() === title.trim().toLowerCase());
        if (found) {
          return found;
        }
        const created = createProvisionalContainer('sprint', containers.length, title);
        containers = [...containers, created];
        return created;
      };
      const memberCount = (containerId: string, movingKey: string): number =>
        Object.values(nodes).filter((nodeState) => nodeState.containerId === containerId && nodeState.issueKey !== movingKey).length;

      for (const change of changes) {
        const node = nodes[change.issueKey];
        if (!node) {
          continue;
        }
        let next = { ...node };
        if (change.size !== null) {
          next.size = change.size;
        }
        if (change.bucket !== null) {
          next.priority = change.bucket;
        }
        if (change.triage === 'park') {
          const lot = ensureByKind('parkingLot', createParkingLotContainer);
          next = { ...next, containerId: lot.id, isParked: true, parkReason: change.reason || null, position: positionInContainer(lot, memberCount(lot.id, change.issueKey)) };
        } else if (change.triage === 'complete') {
          const done = ensureByKind('complete', createCompleteContainer);
          next = { ...next, containerId: done.id, isParked: false, parkReason: null, position: positionInContainer(done, memberCount(done.id, change.issueKey)) };
        } else if (change.sprint !== null) {
          const sprint = ensureSprintByTitle(change.sprint);
          next = { ...next, containerId: sprint.id, isParked: false, position: positionInContainer(sprint, memberCount(sprint.id, change.issueKey)) };
        }
        nodes[change.issueKey] = next;
      }
      return { ...previous, containers, nodes };
    });
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

  // Undo: move the newest `past` snapshot into `present` and push the old present onto `future` so
  // it can be redone. Persist the restored state so a reload keeps the undone result.
  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.past.length === 0) {
        return current;
      }
      const restored = current.past[current.past.length - 1];
      const persisted = persist(restored, new Date().toISOString());
      return { present: persisted, past: current.past.slice(0, -1), future: [current.present, ...current.future] };
    });
  }, []);

  // Redo: the mirror of undo — take the next `future` snapshot back into `present`.
  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.future.length === 0) {
        return current;
      }
      const restored = current.future[0];
      const persisted = persist(restored, new Date().toISOString());
      return { present: persisted, past: [...current.past, current.present], future: current.future.slice(1) };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return useMemo(
    () => ({
      overlay, ensureNodeStates, updateNode, setWipLimit, setPriority, setSize,
      setContainer, setParked, addContainer, updateContainer, removeContainer, removeNode, clearNodes,
      assignToContainer, parkNode, unparkNode, completeNode, moveContainer, applyMasterPlan, goToStage, completeStage,
      undo, redo, canUndo, canRedo,
    }),
    [overlay, ensureNodeStates, updateNode, setWipLimit, setPriority, setSize, setContainer, setParked, addContainer, updateContainer, removeContainer, removeNode, clearNodes, assignToContainer, parkNode, unparkNode, completeNode, moveContainer, applyMasterPlan, goToStage, completeStage, undo, redo, canUndo, canRedo],
  );
}
