// useCrgSubmissionDebugStore.ts — Shared global store for CRG submission debug data
// exposed across all views (primarily for Admin Hub access to live CRG diagnostics).

import { create } from 'zustand'
import type { ChgSubmissionDebug } from '../views/SnowHub/hooks/useCrgState.ts'

interface CrgSubmissionDebugStore {
  lastSubmissionDebug: ChgSubmissionDebug | null
  updateLastSubmissionDebug(debug: ChgSubmissionDebug | null): void
}

/**
 * Zustand store for the most recent CRG submission debug data.
 * useCrgState updates this whenever a CHG is created or updated.
 * Admin Hub reads from this to display diagnostics.
 */
export const useCrgSubmissionDebugStore = create<CrgSubmissionDebugStore>((set) => ({
  lastSubmissionDebug: null,
  updateLastSubmissionDebug: (debug) => set({ lastSubmissionDebug: debug }),
}))
