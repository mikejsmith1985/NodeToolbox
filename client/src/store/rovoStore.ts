// rovoStore.ts — Shared reactive store for the Rovo capability unlock state.
//
// The Rovo prompt generators and their Admin Hub config are gated behind a single
// passphrase. Holding the unlock here (initialised from sessionStorage, like
// adminStore) means one successful passphrase entry unlocks every "Run via Rovo"
// affordance and the config section app-wide, without re-entering it per surface.

import { create } from 'zustand';

// Session flag — survives navigation within the tab; cleared when the tab closes.
const ROVO_UNLOCK_SESSION_KEY = 'tbxRovoUnlocked';

interface RovoStoreState {
  /** True when the Rovo passphrase has been verified in this browser tab. */
  isRovoUnlocked: boolean;
}

/** Safely reads the Rovo unlock flag from sessionStorage without throwing. */
function readSessionRovoUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ROVO_UNLOCK_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Global store for the Rovo capability unlock state.
 * Read this from any component that gates UI behind the Rovo passphrase.
 * Write it via setRovoUnlocked (called by the passphrase verification flow).
 */
export const useRovoStore = create<RovoStoreState>(() => ({
  isRovoUnlocked: readSessionRovoUnlocked(),
}));

/**
 * Sets the Rovo unlock state and persists it so it survives navigation within
 * the tab. Pass false to lock and clear the session flag.
 *
 * @param isUnlocked - Whether the Rovo capability is unlocked.
 */
export function setRovoUnlocked(isUnlocked: boolean): void {
  try {
    if (isUnlocked) {
      sessionStorage.setItem(ROVO_UNLOCK_SESSION_KEY, '1');
    } else {
      sessionStorage.removeItem(ROVO_UNLOCK_SESSION_KEY);
    }
  } catch {
    // Storage access can fail in private browsing; in-memory state stays authoritative.
  }
  useRovoStore.setState({ isRovoUnlocked: isUnlocked });
}
