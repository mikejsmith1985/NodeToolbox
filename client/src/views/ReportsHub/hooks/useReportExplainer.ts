// useReportExplainer.ts — Manages collapsible state for "About this report" explainer cards.
//
// Each tab has its own independent collapsed/expanded state. The state persists across
// page visits via localStorage so users do not have to re-dismiss cards every session.

import { useCallback, useState } from 'react'

import type { ReportsHubTab } from './useReportsHubState.ts'

// ── Named constants ──

const EXPLAINER_STORAGE_KEY = 'tbxReportsHubHelp'

// Cards default to collapsed so they do not dominate the page for returning users.
const DEFAULT_IS_COLLAPSED = true

// ── Helpers ──

/** Loads the per-tab collapsed state map from localStorage, returning an empty object on failure. */
function loadExplainerStates(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPLAINER_STORAGE_KEY)
    if (raw === null) return {}
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Writes the full collapsed state map to localStorage. */
function persistExplainerStates(states: Record<string, boolean>): void {
  localStorage.setItem(EXPLAINER_STORAGE_KEY, JSON.stringify(states))
}

// ── Hook ──

/**
 * Hook that manages the per-tab collapsed state of "About this report" explainer cards.
 * State persists across sessions via localStorage key `tbxReportsHubHelp`.
 * Cards default to collapsed so they do not interrupt returning users.
 */
export function useReportExplainer() {
  const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>(
    loadExplainerStates,
  )

  /** Returns true if the explainer card for the given tab is currently collapsed. */
  const isTabExplainerCollapsed = useCallback(
    (tabKey: ReportsHubTab): boolean => collapsedStates[tabKey] ?? DEFAULT_IS_COLLAPSED,
    [collapsedStates],
  )

  /** Toggles the explainer card open or closed for the given tab and persists the change. */
  const toggleTabExplainer = useCallback((tabKey: ReportsHubTab): void => {
    setCollapsedStates((previous) => {
      const currentlyCollapsed = previous[tabKey] ?? DEFAULT_IS_COLLAPSED
      const updated = { ...previous, [tabKey]: !currentlyCollapsed }
      persistExplainerStates(updated)
      return updated
    })
  }, [])

  return { isTabExplainerCollapsed, toggleTabExplainer }
}
