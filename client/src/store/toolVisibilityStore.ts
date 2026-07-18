// toolVisibilityStore.ts — Shared reactive store for per-tool home-page visibility.
//
// The Admin Hub's Tool Visibility toggles and the Home view read/write ONE store (spec 020: the
// old toggles persisted to localStorage but wired to nothing — controls that do nothing erode
// trust in every control). Backed by the SAME tbxToolVisibility key the previous implementation
// wrote, so existing persisted maps keep working with zero migration.

import { create } from 'zustand';

/** localStorage key holding the per-tool visibility map (unchanged from the pre-020 writer). */
export const TOOL_VISIBILITY_STORAGE_KEY = 'tbxToolVisibility';

// The one tool that must never be hideable: hiding the Admin Hub would lock the admin out of
// the very toggles that could bring it back (spec 020 FR-004).
const ALWAYS_VISIBLE_TOOL_IDS = new Set(['admin-hub']);

interface ToolVisibilityStoreState {
  /** Card id → visible flag; a card absent from the map is visible by default. */
  visibilityByCardId: Record<string, boolean>;
}

/** Safely reads the persisted visibility map; corrupt or missing storage yields all-visible. */
function readStoredVisibilityMap(): Record<string, boolean> {
  try {
    const rawStoredValue = window.localStorage.getItem(TOOL_VISIBILITY_STORAGE_KEY);
    if (rawStoredValue === null) return {};
    const parsedValue: unknown = JSON.parse(rawStoredValue);
    if (parsedValue === null || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {};
    return parsedValue as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * Global store for per-tool home visibility.
 * Read via the hook (or `resolveToolIsVisible`); write ONLY via `setToolVisibility`.
 */
export const useToolVisibilityStore = create<ToolVisibilityStoreState>(() => ({
  visibilityByCardId: readStoredVisibilityMap(),
}));

/** Returns whether a tool should show; `admin-hub` is visible unconditionally (FR-004). */
export function resolveToolIsVisible(visibilityByCardId: Record<string, boolean>, cardId: string): boolean {
  if (ALWAYS_VISIBLE_TOOL_IDS.has(cardId)) return true;
  return visibilityByCardId[cardId] !== false;
}

/** Sets one tool's visibility, persisting and notifying subscribers; pinned tools are ignored. */
export function setToolVisibility(cardId: string, isVisible: boolean): void {
  if (ALWAYS_VISIBLE_TOOL_IDS.has(cardId)) return;
  const nextVisibilityMap = { ...useToolVisibilityStore.getState().visibilityByCardId, [cardId]: isVisible };
  try {
    window.localStorage.setItem(TOOL_VISIBILITY_STORAGE_KEY, JSON.stringify(nextVisibilityMap));
  } catch {
    // Storage can fail in private browsing; the in-memory state stays authoritative.
  }
  useToolVisibilityStore.setState({ visibilityByCardId: nextVisibilityMap });
}

/** Re-reads the persisted map (startup/tests); corrupt storage degrades to all-visible. */
export function reloadToolVisibilityFromStorage(): void {
  useToolVisibilityStore.setState({ visibilityByCardId: readStoredVisibilityMap() });
}
