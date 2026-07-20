// quickLookupStore.ts — App-wide open/close state for the F2 Quick Issue Lookup popup.
//
// Feature 022 kept open/close state inside the gate component, so only the F2 keydown could open it.
// US3 (feature 023) needs a second entry point: clicking a linked issue in IssueDetailPanel should
// open the same popup already seeded with that issue's key. Lifting the open/close/seed state into a
// tiny zustand store (todoStore precedent) lets any surface trigger the popup without prop-drilling.

import { create } from 'zustand';

/** Open/close state for the Quick Issue Lookup popup plus the actions that drive it. */
interface QuickLookupState {
  /** True while the popup is mounted. */
  isOpen: boolean;
  /** Issue key to pre-load when opening (null = open idle, showing recents). */
  seedKey: string | null;
  /** Incremented on every open() so the gate can key the popup and force a fresh remount. */
  openNonce: number;
  /** Opens the popup; pass a key to pre-load that issue immediately, omit it to open idle. */
  open: (seedKey?: string) => void;
  /** Closes the popup and clears any seed so the next plain open() starts idle. */
  close: () => void;
}

/**
 * Global store for the Quick Issue Lookup popup.
 * Open it from anywhere via useQuickLookupStore.getState().open(key); the gate subscribes to render it.
 */
export const useQuickLookupStore = create<QuickLookupState>((setState) => ({
  isOpen: false,
  seedKey: null,
  openNonce: 0,
  open: (seedKey) =>
    setState((previousState) => ({
      isOpen: true,
      seedKey: seedKey ?? null,
      // Bumping the nonce on every open lets a repeat open remount (and thus reset) the popup.
      openNonce: previousState.openNonce + 1,
    })),
  close: () => setState({ isOpen: false, seedKey: null }),
}));
