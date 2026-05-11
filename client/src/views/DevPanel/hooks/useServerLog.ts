// useServerLog.ts — Polls the server's log buffer endpoint to show server-side console output.

import { useCallback, useEffect, useRef, useState } from 'react'

/** A single server-side log entry as returned by GET /api/logs. */
export interface ServerLogEntry {
  /** Monotonic sequence number assigned by the server's ring buffer. */
  id: number
  /** ISO-8601 timestamp when the log line was captured. */
  timestamp: string
  /** The severity level: log, warn, error, or info. */
  level: 'log' | 'warn' | 'error' | 'info'
  /** The formatted log message text. */
  message: string
}

const SERVER_LOG_POLL_INTERVAL_MS = 3_000
const MAX_DISPLAYED_SERVER_ENTRIES = 500

export interface ServerLogHookResult {
  /** All log entries currently held in state (newest first). */
  entries: ServerLogEntry[]
  /** True while the first fetch is in flight (before any data arrives). */
  isLoading: boolean
  /** Non-null when the most recent poll encountered a network/parse error. */
  fetchError: string | null
  /** Clears the server-side ring buffer and local state. */
  clearLog: () => void
}

/**
 * Polls GET /api/logs every 3 seconds and accumulates server-side console entries.
 * Calls POST /api/logs/clear when the user clicks "Clear".
 */
export function useServerLog(): ServerLogHookResult {
  const [entries, setEntries] = useState<ServerLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Keep the latest entry ID seen so we can detect new entries without
  // replacing the entire list on every poll.
  const lastSeenIdRef = useRef<number>(-1)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollLogs = useCallback(async () => {
    try {
      const response = await fetch('/api/logs')

      if (!response.ok) {
        setFetchError(`Server responded with ${response.status}`)
        return
      }

      const allEntries: ServerLogEntry[] = await response.json()
      const newEntries = allEntries.filter(
        (entry) => entry.id > lastSeenIdRef.current,
      )

      if (newEntries.length > 0) {
        lastSeenIdRef.current = newEntries[newEntries.length - 1].id
        setEntries((previousEntries) => {
          // Prepend new entries (newest first) and cap the list size.
          const combined = [...newEntries.reverse(), ...previousEntries]
          return combined.slice(0, MAX_DISPLAYED_SERVER_ENTRIES)
        })
      }

      setFetchError(null)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Fetch immediately on mount, then on a fixed interval.
    void pollLogs()
    pollIntervalRef.current = setInterval(() => void pollLogs(), SERVER_LOG_POLL_INTERVAL_MS)

    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [pollLogs])

  const clearLog = useCallback(async () => {
    try {
      await fetch('/api/logs/clear', { method: 'POST' })
      setEntries([])
      lastSeenIdRef.current = -1
    } catch {
      // Clear is best-effort — ignore network errors.
    }
  }, [])

  return { entries, isLoading, fetchError, clearLog }
}
