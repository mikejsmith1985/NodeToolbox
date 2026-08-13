// diagnosticsStore.ts — Whether the in-app troubleshooting surfaces are switched on.
//
// Diagnostics show raw Jira field ids and raw stored values. That is exactly what makes them useful
// for troubleshooting and exactly why they must not be on by default: most people opening a board
// have no use for a custom field id, and a panel full of them reads as clutter at best and as
// something broken at worst.
//
// So there are TWO gates, and both are deliberate. Admin Hub must be unlocked, AND this flag must be
// switched on there. Unlocking alone is not enough — an admin who unlocked to do something unrelated
// should not suddenly find diagnostic panels on their board.
//
// Kept apart from the unlock state in `adminStore` because they answer different questions: one is
// "may this person see admin things", the other is "does this person want to see them right now".

import { create } from 'zustand';

/** localStorage, not session: a deliberate choice to leave diagnostics on should survive a reload. */
const BOARD_DIAGNOSTICS_STORAGE_KEY = 'tbxFeatureBoardDiagnostics';

interface DiagnosticsStoreState {
  /** True only when an admin has explicitly switched diagnostics on. Never defaults to true. */
  isBoardDiagnosticsEnabled: boolean;
  setBoardDiagnosticsEnabled: (isEnabled: boolean) => void;
}

/** Reads the stored flag without throwing when storage is unavailable. */
export function readStoredBoardDiagnosticsEnabled(): boolean {
  try {
    return localStorage.getItem(BOARD_DIAGNOSTICS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether diagnostics may be drawn: unlocked AND switched on. Neither gate alone is enough. */
export function canShowBoardDiagnostics(isAdminUnlocked: boolean, isBoardDiagnosticsEnabled: boolean): boolean {
  return isAdminUnlocked && isBoardDiagnosticsEnabled;
}

/**
 * Global store for the diagnostics toggle.
 *
 * Written only from Admin Hub, which is the one place that has already established the viewer is an
 * admin. Read anywhere a diagnostic surface needs to know whether to draw itself.
 */
export const useDiagnosticsStore = create<DiagnosticsStoreState>((set) => ({
  isBoardDiagnosticsEnabled: readStoredBoardDiagnosticsEnabled(),
  setBoardDiagnosticsEnabled: (isEnabled: boolean) => {
    try {
      localStorage.setItem(BOARD_DIAGNOSTICS_STORAGE_KEY, isEnabled ? '1' : '0');
    } catch {
      // Storage failure is non-fatal: the toggle still applies for this session.
    }
    set({ isBoardDiagnosticsEnabled: isEnabled });
  },
}));
