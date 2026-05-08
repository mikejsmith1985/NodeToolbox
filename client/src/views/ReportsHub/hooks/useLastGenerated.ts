// useLastGenerated.ts — Tracks when each Reports Hub tab last had its data refreshed.
//
// Per-tab ISO timestamps persist to localStorage under `tbxReportsLastGenerated`.
// The exported `formatRelativeTime` helper converts a stored timestamp to a
// human-readable string like "3 minutes ago" for display below the tab header.

import { useCallback, useState } from 'react'

import type { ReportsHubTab } from './useReportsHubState.ts'

// ── Named constants ──

const LAST_GENERATED_STORAGE_KEY = 'tbxReportsLastGenerated'
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

// ── Helpers ──

/** Loads the per-tab timestamp map from localStorage, returning an empty object on failure. */
function loadTimestamps(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_GENERATED_STORAGE_KEY)
    if (raw === null) return {}
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

/** Writes the full timestamp map to localStorage. */
function persistTimestamps(timestamps: Record<string, string>): void {
  localStorage.setItem(LAST_GENERATED_STORAGE_KEY, JSON.stringify(timestamps))
}

// ── Exported pure helper ──

/**
 * Converts an ISO timestamp to a concise human-readable relative time string.
 * Examples: "just now", "45 seconds ago", "3 minutes ago", "2 hours ago".
 */
export function formatRelativeTime(isoTimestamp: string): string {
  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime()
  const totalSeconds = Math.floor(elapsedMs / MILLISECONDS_PER_SECOND)

  if (totalSeconds < 10) return 'just now'
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds} seconds ago`

  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  if (totalMinutes < MINUTES_PER_HOUR) {
    return totalMinutes === 1 ? '1 minute ago' : `${totalMinutes} minutes ago`
  }

  const totalHours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  return totalHours === 1 ? '1 hour ago' : `${totalHours} hours ago`
}

// ── Hook ──

/**
 * Hook that manages per-tab "last generated" timestamps for the Reports Hub.
 * Records when each tab's data was last refreshed so the UI can show relative elapsed time.
 * Timestamps persist to localStorage key `tbxReportsLastGenerated`.
 */
export function useLastGenerated() {
  const [timestamps, setTimestamps] = useState<Record<string, string>>(loadTimestamps)

  /** Records the current time as the last-generated timestamp for the given tab. */
  const markGenerated = useCallback((tabKey: ReportsHubTab): void => {
    const nowIso = new Date().toISOString()
    setTimestamps((previous) => {
      const updated = { ...previous, [tabKey]: nowIso }
      persistTimestamps(updated)
      return updated
    })
  }, [])

  /** Returns the ISO timestamp for the given tab, or null if the tab has never loaded data. */
  const getTabTimestamp = useCallback(
    (tabKey: ReportsHubTab): string | null => timestamps[tabKey] ?? null,
    [timestamps],
  )

  return { markGenerated, getTabTimestamp }
}
