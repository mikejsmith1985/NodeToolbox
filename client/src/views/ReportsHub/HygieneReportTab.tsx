// HygieneReportTab.tsx — Reports Hub tab that runs an on-demand hygiene scan for one team.
//
// The scan endpoint (/api/hygiene-monitor/scan) only knows teams configured in the Admin Hub
// Hygiene Monitor panel — a separate list from the ART team names in the Reports Hub global
// filter. This tab therefore loads that config and offers exactly those teams, so every
// selectable option is one the server can actually scan (agree-by-construction; previously the
// tab sent ART names and every scan answered "Team not found").

import { useCallback, useEffect, useState } from 'react'

import styles from './ReportsHubView.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HygieneScanResult {
  teamName:        string
  issuesScanned:   number
  violationsFound: number
  fixesApplied:    number
  actionsRequired: number
  failures:        { issueKey: string; reason: string }[]
}

interface HygieneReportTabProps {
  /** The currently selected team name from the Reports Hub global filter, or '' for All Teams. */
  teamName: string
}

const TEAM_SELECT_LABEL = 'Hygiene team'
const NO_TEAMS_MESSAGE =
  'No hygiene monitor teams configured — add them in Admin Hub → Hygiene Monitor, then run the scan here.'

// ── Component ─────────────────────────────────────────────────────────────────

/** Renders the Hygiene tab in Reports Hub — configured-team picker plus scan runner with inline results. */
export function HygieneReportTab({ teamName }: HygieneReportTabProps) {
  const [configuredTeamNames, setConfiguredTeamNames] = useState<string[] | null>(null)
  const [selectedTeamName, setSelectedTeamName] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [result, setResult] = useState<HygieneScanResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Load the hygiene monitor config once so the picker offers only scannable teams.
  // The global-filter team is preselected when it matches; otherwise the first configured team.
  useEffect(() => {
    let isActive = true

    fetch('/api/hygiene-monitor/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load hygiene monitor config')
        return response.json() as Promise<{ teams?: { teamName: string }[] }>
      })
      .then((config) => {
        if (!isActive) return
        const loadedNames = (config.teams ?? []).map((team) => team.teamName).filter((name) => name !== '')
        setConfiguredTeamNames(loadedNames)
        setSelectedTeamName(loadedNames.includes(teamName) ? teamName : (loadedNames[0] ?? ''))
      })
      .catch((loadError: unknown) => {
        if (!isActive) return
        setConfiguredTeamNames([])
        setErrorMessage((loadError as Error).message)
      })

    return () => { isActive = false }
  }, [teamName])

  const handleRunScan = useCallback(async () => {
    if (selectedTeamName === '') return
    setIsScanning(true)
    setResult(null)
    setErrorMessage(null)
    try {
      const response = await fetch('/api/hygiene-monitor/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ teamName: selectedTeamName }),
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Scan failed' })) as { error?: string }
        throw new Error(errorBody.error ?? `HTTP ${response.status}`)
      }
      setResult(await response.json() as HygieneScanResult)
    } catch (scanError) {
      setErrorMessage((scanError as Error).message)
    } finally {
      setIsScanning(false)
    }
  }, [selectedTeamName])

  // Honest loading state while the config fetch is in flight.
  if (configuredTeamNames === null) {
    return <div className={styles.emptyState}>Loading hygiene monitor teams…</div>
  }

  if (configuredTeamNames.length === 0) {
    return (
      <div className={styles.emptyState}>
        {errorMessage ? `⚠ ${errorMessage}` : NO_TEAMS_MESSAGE}
      </div>
    )
  }

  return (
    <div className={styles.scopeChangeTab}>
      <div className={styles.scopeChangeSection}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label htmlFor="hygiene-report-team-select">{TEAM_SELECT_LABEL}</label>
          <select
            id="hygiene-report-team-select"
            aria-label={TEAM_SELECT_LABEL}
            value={selectedTeamName}
            onChange={(changeEvent) => setSelectedTeamName(changeEvent.target.value)}
          >
            {configuredTeamNames.map((configuredName) => (
              <option key={configuredName} value={configuredName}>{configuredName}</option>
            ))}
          </select>
          <button
            className={`${styles.actionButton} ${styles.primaryButton}`}
            disabled={isScanning}
            onClick={() => { void handleRunScan() }}
          >
            {isScanning ? '⏳ Scanning…' : '▶ Run Hygiene Scan'}
          </button>
        </div>

        {errorMessage && (
          <p style={{ color: 'var(--color-tone-error-fg)', marginTop: '0.75rem' }}>⚠ {errorMessage}</p>
        )}

        {result && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <span><strong>{result.issuesScanned}</strong> issues scanned</span>
              <span><strong>{result.violationsFound}</strong> violations</span>
              <span><strong>{result.fixesApplied}</strong> auto-fixed</span>
              <span><strong>{result.actionsRequired}</strong> actions required</span>
            </div>
            {result.failures.length > 0 && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                  {result.failures.length} failures — click to expand
                </summary>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                  {result.failures.map((failure) => (
                    <li key={failure.issueKey}>
                      <strong>{failure.issueKey}</strong>: {failure.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
