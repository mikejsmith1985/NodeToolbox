// adminStore.ts — Shared reactive store for admin unlock state.
//
// Initializes from sessionStorage so the unlock persists across page navigations
// within the same browser tab. Updated by useAdminHubState when the user
// unlocks or locks Admin Hub, making the unlock state available to any component
// (e.g. ConnectionBar) without requiring a prop-drilling chain.

import { create } from 'zustand';

// Same key used by useAdminHubState — both read/write the same sessionStorage flag.
const ADMIN_UNLOCK_SESSION_KEY = 'tbxAdminUnlocked';

interface AdminStoreState {
  /** True when the user has successfully verified Admin Hub credentials in this browser tab. */
  isAdminUnlocked: boolean;
}

/** Safely reads the admin unlock flag from sessionStorage without throwing. */
function readSessionAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_UNLOCK_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Global store for the admin unlock state.
 * Read this from any component that needs to gate UI behind admin credentials.
 * Write it via useAdminHubState's tryUnlock/lock actions — never set it directly
 * from outside the auth flow.
 */
export const useAdminStore = create<AdminStoreState>(() => ({
  isAdminUnlocked: readSessionAdminUnlocked(),
}));
