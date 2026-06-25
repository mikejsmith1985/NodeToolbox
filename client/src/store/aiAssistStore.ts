// aiAssistStore.ts — Shared reactive store for the AI Assist capability unlock state.
//
// The AI Assist prompt generators and their Admin Hub config are gated behind a single
// passphrase. Holding the unlock here (initialised from sessionStorage, like
// adminStore) means one successful passphrase entry unlocks every "Run via AI Assist"
// affordance and the config section app-wide, without re-entering it per surface.

import { create } from 'zustand';

// Session flag — survives navigation within the tab; cleared when the tab closes.
const AI_ASSIST_UNLOCK_SESSION_KEY = 'tbxAiAssistUnlocked';

interface AiAssistStoreState {
  /** True when the AI Assist passphrase has been verified in this browser tab. */
  isAiAssistUnlocked: boolean;
}

/** Safely reads the AI Assist unlock flag from sessionStorage without throwing. */
function readSessionAiAssistUnlocked(): boolean {
  try {
    return sessionStorage.getItem(AI_ASSIST_UNLOCK_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Global store for the AI Assist capability unlock state.
 * Read this from any component that gates UI behind the AI Assist passphrase.
 * Write it via setAiAssistUnlocked (called by the passphrase verification flow).
 */
export const useAiAssistStore = create<AiAssistStoreState>(() => ({
  isAiAssistUnlocked: readSessionAiAssistUnlocked(),
}));

/**
 * Sets the AI Assist unlock state and persists it so it survives navigation within
 * the tab. Pass false to lock and clear the session flag.
 *
 * @param isUnlocked - Whether the AI Assist capability is unlocked.
 */
export function setAiAssistUnlocked(isUnlocked: boolean): void {
  try {
    if (isUnlocked) {
      sessionStorage.setItem(AI_ASSIST_UNLOCK_SESSION_KEY, '1');
    } else {
      sessionStorage.removeItem(AI_ASSIST_UNLOCK_SESSION_KEY);
    }
  } catch {
    // Storage access can fail in private browsing; in-memory state stays authoritative.
  }
  useAiAssistStore.setState({ isAiAssistUnlocked: isUnlocked });
}
