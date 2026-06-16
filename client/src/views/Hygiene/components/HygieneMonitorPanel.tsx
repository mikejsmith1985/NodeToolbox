// HygieneMonitorPanel.tsx — In-view panel that surfaces the hygiene monitor status
// and lets users trigger an on-demand scan for any configured team.
//
// This panel is only rendered when the Ctrl+Alt+Z Rovo gate is unlocked.
// It polls GET /api/hygiene-monitor/status on mount and after each "Scan Now" click.

import { useCallback, useEffect, useState } from 'react'
import styles from '../HygieneView.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamStatus {
  teamName:        string
  violationsFound: number
  scannedAt:       string | null
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

// NOTE (SC-009, deferred): a per-team trend indicator (↓ improving / ↑ worsening)
// is not yet shown — the /api/hygiene-monitor/status teamStatuses do not include a
// `trend` field. Completing SC-009 requires returning trend from getLastScanStatus
// and rendering it here; tracked as an open US3 item, separate from email delivery.

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
 * Must only be rendered when `isRovoUnlocked` is true — the gate is enforced
 * by the parent `HygieneView`.
 */
export function HygieneMonitorPanel() {
  const [status, setStatus] = useState<HygieneMonitorStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [scanningTeam, setScanningTeam] = useState<string | null>(null)
  const [lastScanResults, setLastScanResults] = useState<Record<string, ScanResult>>({})

  const loadStatus = useCallback(async () => {
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

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleScanNow = useCallback(async (teamName: string) => {
    setScanningTeam(teamName)
    setErrorMessage(null)
    try {
      const result = await triggerScan(teamName)
      setLastScanResults((previous) => ({ ...previous, [teamName]: result }))
      // Reload the status so the panel reflects the new scan time.
      await loadStatus()
    } catch (scanError) {
      setErrorMessage('Scan failed: ' + (scanError as Error).message)
    } finally {
      setScanningTeam(null)
    }
  }, [loadStatus])

  return (
    <section
      className={styles.hygieneMonitorPanel}
      aria-label="Hygiene Monitor"
    >
      <header className={styles.monitorPanelHeader}>
        <h2 className={styles.monitorPanelTitle}>✦ Rovo Hygiene Monitor</h2>
        <button
          type="button"
          className={styles.monitorRefreshButton}
          onClick={() => { void loadStatus() }}
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
              No teams configured. Add teams in Admin Hub → ⚡ Rovo → Hygiene Monitor.
            </p>
          )}

          <ul className={styles.monitorTeamList}>
            {status.teamStatuses.map((teamStatus) => {
              const freshResult = lastScanResults[teamStatus.teamName]
              const violationCount = freshResult?.violationsFound ?? teamStatus.violationsFound
              const isScanRunning = scanningTeam === teamStatus.teamName

              return (
                <li key={teamStatus.teamName} className={styles.monitorTeamRow}>
                  <div className={styles.monitorTeamName}>{teamStatus.teamName}</div>
                  <div className={styles.monitorTeamStats}>
                    <span className={styles.monitorViolationCount}>
                      {violationCount} violation{violationCount !== 1 ? 's' : ''}
                    </span>
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
