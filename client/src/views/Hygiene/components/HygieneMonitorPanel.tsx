// HygieneMonitorPanel.tsx — In-view panel that surfaces the hygiene monitor status
// and lets users trigger an on-demand scan for any configured team.
//
// This panel is only rendered when the Ctrl+Alt+Z AI Assist gate is unlocked.
// It polls GET /api/hygiene-monitor/status on mount and after each "Scan Now" click.

import { useCallback, useEffect, useState } from 'react'
import styles from '../HygieneView.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamStatus {
  teamName:        string
  violationsFound: number
  scannedAt:       string | null
  trend?:          string
}

interface HygieneMonitorStatus {
  lastScanAt:    string | null
  nextScanAt:    string | null
  teamStatuses:  TeamStatus[]
}

interface ScanResult {
  teamName:        string
  issuesScanned:   number
  violationsFound: number
  fixesApplied:    number
  actionsRequired: number
}

// ── Trend indicator (SC-009) ────────────────────────────────────────────────────

// Maps a trend string from the status endpoint to a human-readable indicator shown
// beside a team's violation count. 'n/a' (or absent) means fewer than two scans.
const TREND_INDICATORS: Record<string, string> = {
  down:  '↓ improving',
  up:    '↑ worsening',
  flat:  '→ unchanged',
  'n/a': '',
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchMonitorStatus(): Promise<HygieneMonitorStatus> {
  const response = await fetch('/api/hygiene-monitor/status')
  if (!response.ok) throw new Error('Failed to load hygiene monitor status')
  return response.json() as Promise<HygieneMonitorStatus>
}

async function triggerScan(teamName: string): Promise<ScanResult> {
  const response = await fetch('/api/hygiene-monitor/scan', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ teamName }),
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(errorBody.error ?? `Scan failed (HTTP ${response.status})`)
  }
  return response.json() as Promise<ScanResult>
}

function formatScanTime(isoDate: string | null): string {
  if (!isoDate) return 'Never'
  return new Date(isoDate).toLocaleString()
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Displays the hygiene monitor status and provides a per-team "Scan Now" trigger.
 * Must only be rendered when `isAiAssistUnlocked` is true — the gate is enforced
 * by the parent `HygieneView`.
 */
export function HygieneMonitorPanel() {
  const [status, setStatus] = useState<HygieneMonitorStatus | null>(null)
  // Starts true: the panel loads on mount, so the spinner is the honest first paint.
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [scanningTeam, setScanningTeam] = useState<string | null>(null)
  const [lastScanResults, setLastScanResults] = useState<Record<string, ScanResult>>({})

  // Re-fetch on demand: the refresh button and the post-scan reload. Announcing the load up front is
  // right here, because a user asked for it and expects the spinner to answer.
  const refreshStatus = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const currentStatus = await fetchMonitorStatus()
      setStatus(currentStatus)
    } catch (loadError) {
      setErrorMessage((loadError as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // The first load is deliberately NOT refreshStatus. On mount the state already says loading, so
  // re-announcing it would force a second render and flash the empty panel first. Every setState
  // below runs after the fetch settles, and isActive stops a late response touching an unmounted
  // panel - which this effect previously did not guard against.
  useEffect(() => {
    let isActive = true

    fetchMonitorStatus()
      .then((currentStatus) => {
        if (!isActive) return
        setStatus(currentStatus)
        setErrorMessage(null)
      })
      .catch((loadError: unknown) => {
        if (isActive) setErrorMessage((loadError as Error).message)
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => { isActive = false }
  }, [])

  const handleScanNow = useCallback(async (teamName: string) => {
    setScanningTeam(teamName)
    setErrorMessage(null)
    try {
      const result = await triggerScan(teamName)
      setLastScanResults((previous) => ({ ...previous, [teamName]: result }))
      // Reload the status so the panel reflects the new scan time.
      await refreshStatus()
    } catch (scanError) {
      setErrorMessage('Scan failed: ' + (scanError as Error).message)
    } finally {
      setScanningTeam(null)
    }
  }, [refreshStatus])

  return (
    <section
      className={styles.hygieneMonitorPanel}
      aria-label="Hygiene Monitor"
    >
      <header className={styles.monitorPanelHeader}>
        <h2 className={styles.monitorPanelTitle}>✦ AI Assist Hygiene Monitor</h2>
        <button
          type="button"
          className={styles.monitorRefreshButton}
          onClick={() => { void refreshStatus() }}
          disabled={isLoading}
          aria-label="Refresh hygiene monitor status"
        >
          {isLoading ? '⏳' : '↻'}
        </button>
      </header>

      {errorMessage && (
        <p className={styles.monitorError} role="alert">⚠ {errorMessage}</p>
      )}

      {!status && !isLoading && !errorMessage && (
        <p className={styles.monitorEmptyState}>No scan data available yet.</p>
      )}

      {status && (
        <>
          <p className={styles.monitorMeta}>
            Last scan: {formatScanTime(status.lastScanAt)}
          </p>

          {status.teamStatuses.length === 0 && (
            <p className={styles.monitorEmptyState}>
              No teams configured. Add teams in Admin Hub → ⚡ AI Assist → Hygiene Monitor.
            </p>
          )}

          <ul className={styles.monitorTeamList}>
            {status.teamStatuses.map((teamStatus) => {
              const freshResult = lastScanResults[teamStatus.teamName]
              const violationCount = freshResult?.violationsFound ?? teamStatus.violationsFound
              const isScanRunning = scanningTeam === teamStatus.teamName
              const trendLabel = TREND_INDICATORS[teamStatus.trend ?? 'n/a'] ?? ''

              return (
                <li key={teamStatus.teamName} className={styles.monitorTeamRow}>
                  <div className={styles.monitorTeamName}>{teamStatus.teamName}</div>
                  <div className={styles.monitorTeamStats}>
                    <span className={styles.monitorViolationCount}>
                      {violationCount} violation{violationCount !== 1 ? 's' : ''}
                    </span>
                    {trendLabel && (
                      <span className={styles.monitorTrend}>{trendLabel}</span>
                    )}
                    {freshResult && (
                      <span className={styles.monitorFixCount}>
                        {freshResult.fixesApplied} fixed, {freshResult.actionsRequired} action{freshResult.actionsRequired !== 1 ? 's' : ''} required
                      </span>
                    )}
                    <span className={styles.monitorScannedAt}>
                      Last: {formatScanTime(teamStatus.scannedAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.monitorScanButton}
                    disabled={isScanRunning || scanningTeam !== null}
                    onClick={() => { void handleScanNow(teamStatus.teamName) }}
                    aria-label={`Scan now for ${teamStatus.teamName}`}
                  >
                    {isScanRunning ? '⏳ Scanning…' : '▶ Scan Now'}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
