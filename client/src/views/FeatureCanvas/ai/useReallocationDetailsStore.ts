// useReallocationDetailsStore.ts — Persisted, canvas-scoped free-text constraints for the re-allocation planner.
//
// The operator's "additional details" belong to one canvas — a specific team profile AND its
// project + PI scope — exactly like the planning overlay. So this store keys its localStorage entry
// the same way the overlay does (team profile id + the overlay scope key) under its own prefix,
// keeping each per-team, per-PI canvas its own constraints with no cross-scope bleed.

import { create } from 'zustand';

import { deriveScopeKey } from '../overlay/overlayStorage.ts';
import { resolveTeamScopedStorageProfileId } from '../../SprintDashboard/hooks/teamScopedStorage.ts';

const REALLOCATION_DETAILS_BASE_KEY = 'tbxReallocationDetails';

interface ReallocationDetailsState {
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

/** Composes the canvas-scoped key `tbxReallocationDetails:<teamProfileId>:<scopeKey>`. */
function buildReallocationDetailsStorageKey(teamProfileId: string, projectKey: string, piName: string): string {
  const resolvedProfileId = resolveTeamScopedStorageProfileId(teamProfileId);
  return `${REALLOCATION_DETAILS_BASE_KEY}:${resolvedProfileId}:${deriveScopeKey(projectKey, piName)}`;
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

/** Zustand store for the Feature Canvas re-allocation planner's per-canvas additional-details text. */
export const useReallocationDetailsStore = create<ReallocationDetailsState>((setState, getState) => ({
  additionalDetails: '',
  storageKey: null,
  setScope: (teamProfileId, projectKey, piName) => {
    const storageKey = buildReallocationDetailsStorageKey(teamProfileId, projectKey, piName);
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
