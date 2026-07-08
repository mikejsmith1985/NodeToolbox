// useCapacityDetailsStore.ts — Persisted, canvas-scoped free-text constraints for the capacity planner.
//
// The operator's "additional details" (real-world constraints Jira can't express — e.g. "internal test must
// finish DENP-1353 exclusively first", or "DoD = internal test complete") belong to one canvas: a specific
// team profile AND its project + PI scope. So this store keys its localStorage entry the same way the
// planning overlay does (team profile id + the overlay scope key) under its own prefix, keeping each
// per-team, per-PI canvas its own constraints. The text is injected verbatim into the Copilot prompt.

import { create } from 'zustand';

import { deriveScopeKey } from '../overlay/overlayStorage.ts';
import { resolveTeamScopedStorageProfileId } from '../../SprintDashboard/hooks/teamScopedStorage.ts';

const CAPACITY_DETAILS_BASE_KEY = 'tbxCapacityPlanDetails';

interface CapacityDetailsState {
  /** Free-text operator constraints for the currently scoped canvas. */
  additionalDetails: string;
  /** The localStorage key the current scope persists under; null until a scope is set. */
  storageKey: string | null;
  /** Points the store at a canvas (team + project + PI) and loads that scope's saved constraints. */
  setScope: (teamProfileId: string, projectKey: string, piName: string) => void;
  /** Persists the constraints under the current scope; clearing to empty removes the entry. */
  setAdditionalDetails: (text: string) => void;
}

/** Guards localStorage access so private-browsing / disabled-storage degrades to in-memory use. */
function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Composes the canvas-scoped key `tbxCapacityPlanDetails:<teamProfileId>:<scopeKey>`. */
function buildCapacityDetailsStorageKey(teamProfileId: string, projectKey: string, piName: string): string {
  const resolvedProfileId = resolveTeamScopedStorageProfileId(teamProfileId);
  return `${CAPACITY_DETAILS_BASE_KEY}:${resolvedProfileId}:${deriveScopeKey(projectKey, piName)}`;
}

/** Reads the persisted constraints for a key, degrading to an empty string on any failure. */
function readStoredDetails(storageKey: string): string {
  if (!canUseLocalStorage()) {
    return '';
  }
  try {
    return window.localStorage.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

/** Persists (or, when empty, removes) the constraints for a key; storage failures are non-fatal. */
function writeStoredDetails(storageKey: string, text: string): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    if (text) {
      window.localStorage.setItem(storageKey, text);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // The in-memory value remains authoritative for the session when storage is unavailable.
  }
}

/** Zustand store for the capacity planner's per-canvas additional-details (operator constraints) text. */
export const useCapacityDetailsStore = create<CapacityDetailsState>((setState, getState) => ({
  additionalDetails: '',
  storageKey: null,
  setScope: (teamProfileId, projectKey, piName) => {
    const storageKey = buildCapacityDetailsStorageKey(teamProfileId, projectKey, piName);
    setState({ storageKey, additionalDetails: readStoredDetails(storageKey) });
  },
  setAdditionalDetails: (text) => {
    const { storageKey } = getState();
    if (storageKey !== null) {
      writeStoredDetails(storageKey, text);
    }
    setState({ additionalDetails: text });
  },
}));
