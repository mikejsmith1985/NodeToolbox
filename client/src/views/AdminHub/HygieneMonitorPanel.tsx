// HygieneMonitorPanel.tsx — Admin Hub panel for the proactive hygiene monitor.
//
// Allows administrators to configure per-team hygiene settings:
// which Jira project keys to scan, when to run, which checks to enable,
// and where to deliver the digest. All secrets are write-only from the UI;
// the server never returns them in GET responses.

import { useCallback, useEffect, useState } from 'react'
import styles from './AdminHubView.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HygieneTeamConfig {
  teamName:            string
  projectKeys:         string[]
  scheduleTime:        string
  weekdays:            string[]
  digestTriggerUrl:    string
  digestTriggerSecret: string
  digestEmailTo:       string
  enabledCheckIds:     string[]
}

interface ScanResult {
  teamName:        string
  issuesScanned:   number
  violationsFound: number
  fixesApplied:    number
  actionsRequired: number
  failures:        { issueKey: string; reason: string }[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DEFAULT_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const DEFAULT_SCHEDULE_TIME = '06:00'

function buildDefaultTeamConfig(): HygieneTeamConfig {
  return {
    teamName:            '',
    projectKeys:         [],
    scheduleTime:        DEFAULT_SCHEDULE_TIME,
    weekdays:            [...DEFAULT_WEEKDAYS],
    digestTriggerUrl:    '',
    digestTriggerSecret: '',
    digestEmailTo:       '',
    enabledCheckIds:     [],
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchHygieneConfig(): Promise<{ teams: HygieneTeamConfig[] }> {
  const response = await fetch('/api/hygiene-monitor/config')
  if (!response.ok) throw new Error('Failed to load hygiene monitor config')
  return response.json() as Promise<{ teams: HygieneTeamConfig[] }>
}

async function saveHygieneConfig(teams: HygieneTeamConfig[]): Promise<void> {
  const response = await fetch('/api/hygiene-monitor/config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ teams }),
  })
  if (!response.ok) throw new Error('Failed to save hygiene monitor config')
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

// ── Component ─────────────────────────────────────────────────────────────────

/** Admin Hub panel for configuring per-team hygiene monitor settings. */
export function HygieneMonitorPanel() {
  const [teams, setTeams] = useState<HygieneTeamConfig[]>([])
  // Starts true: the panel loads on mount, so the spinner is the honest first paint.
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [scanResults, setScanResults] = useState<Record<string, ScanResult>>({})
  const [scanningTeam, setScanningTeam] = useState<string | null>(null)

  // Load the config once, on mount.
  //
  // Every setState here happens after the fetch settles, never while the effect body runs: the state
  // already says loading, so announcing it again would only force a second render and show the empty
  // panel for a frame before the spinner replaced it.
  //
  // isActive also stops a late response updating a panel the admin has already navigated away from,
  // which this effect previously did not guard against.
  useEffect(() => {
    let isActive = true

    fetchHygieneConfig()
      .then((config) => {
        if (!isActive) return
        setTeams(config.teams ?? [])
        setErrorMessage(null)
      })
      .catch((loadError: unknown) => {
        if (!isActive) return
        setErrorMessage((loadError as Error).message)
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => { isActive = false }
  }, [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveMessage(null)
    setErrorMessage(null)
    try {
      await saveHygieneConfig(teams)
      setSaveMessage('Saved.')
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (saveError) {
      setErrorMessage((saveError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }, [teams])

  const handleAddTeam = useCallback(() => {
    setTeams((previous) => [...previous, buildDefaultTeamConfig()])
  }, [])

  const handleRemoveTeam = useCallback((teamIndex: number) => {
    setTeams((previous) => previous.filter((_, index) => index !== teamIndex))
  }, [])

  const handleUpdateTeam = useCallback((teamIndex: number, updatedTeam: HygieneTeamConfig) => {
    setTeams((previous) =>
      previous.map((team, index) => (index === teamIndex ? updatedTeam : team))
    )
  }, [])

  const handleScanNow = useCallback(async (teamName: string) => {
    setScanningTeam(teamName)
    try {
      const result = await triggerScan(teamName)
      setScanResults((previous) => ({ ...previous, [teamName]: result }))
    } catch (scanError) {
      setErrorMessage('Scan failed: ' + (scanError as Error).message)
    } finally {
      setScanningTeam(null)
    }
  }, [])

  if (isLoading) {
    return <div className={styles.sectionCard}>Loading hygiene monitor config…</div>
  }

  return (
    <div className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🧹 Hygiene Monitor</h2>
      <p className={styles.adminDescription}>
        Configure per-team daily Jira hygiene scans. AI Assist classifies violations as
        FIXABLE (auto-applied via Jira) or UNFIXABLE (comment added to the issue).
        After each scan a digest is emailed via an Atlassian Automation webhook (an
        inbox rule then forwards it into Teams).
      </p>

      {errorMessage && (
        <p className={styles.errorBanner} role="alert">⚠ {errorMessage}</p>
      )}
      {saveMessage && (
        <p className={styles.successBanner} role="status">{saveMessage}</p>
      )}

      {teams.length === 0 && (
        <p className={styles.emptyHint}>No teams configured. Add a team to get started.</p>
      )}

      {teams.map((teamConfig, teamIndex) => (
        <HygieneTeamForm
          key={teamIndex}
          teamConfig={teamConfig}
          teamIndex={teamIndex}
          isScanRunning={scanningTeam === teamConfig.teamName}
          lastScanResult={scanResults[teamConfig.teamName] ?? null}
          onChange={(updatedTeam) => handleUpdateTeam(teamIndex, updatedTeam)}
          onRemove={() => handleRemoveTeam(teamIndex)}
          onScanNow={() => { void handleScanNow(teamConfig.teamName) }}
        />
      ))}

      <div className={styles.inputRow}>
        <button type="button" className={styles.actionButton} onClick={handleAddTeam}>
          + Add team
        </button>
        <button
          type="button"
          className={styles.saveButton}
          disabled={isSaving}
          onClick={() => { void handleSave() }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Per-team form ─────────────────────────────────────────────────────────────

interface HygieneTeamFormProps {
  teamConfig:      HygieneTeamConfig
  teamIndex:       number
  isScanRunning:   boolean
  lastScanResult:  ScanResult | null
  onChange:        (updatedTeam: HygieneTeamConfig) => void
  onRemove:        () => void
  onScanNow:       () => void
}

function HygieneTeamForm({
  teamConfig,
  teamIndex,
  isScanRunning,
  lastScanResult,
  onChange,
  onRemove,
  onScanNow,
}: HygieneTeamFormProps) {
  function setField<K extends keyof HygieneTeamConfig>(fieldName: K, value: HygieneTeamConfig[K]) {
    onChange({ ...teamConfig, [fieldName]: value })
  }

  function handleProjectKeysChange(rawText: string) {
    const parsedKeys = rawText.split(',').map((key) => key.trim()).filter(Boolean)
    setField('projectKeys', parsedKeys)
  }

  function toggleWeekday(weekdayName: string) {
    const currentWeekdays = teamConfig.weekdays
    const updatedWeekdays = currentWeekdays.includes(weekdayName)
      ? currentWeekdays.filter((day) => day !== weekdayName)
      : [...currentWeekdays, weekdayName]
    setField('weekdays', updatedWeekdays)
  }

  return (
    <div className={styles.teamBlock} aria-label={`Team ${teamIndex + 1} hygiene config`}>
      <div className={styles.teamBlockHeader}>
        <strong className={styles.teamBlockTitle}>
          {teamConfig.teamName || `Team ${teamIndex + 1}`}
        </strong>
        <button
          type="button"
          className={styles.removeButton}
          aria-label="Remove this team"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor={`hygiene-team-name-${teamIndex}`}>Team name</label>
        <input
          id={`hygiene-team-name-${teamIndex}`}
          className={styles.textInput}
          value={teamConfig.teamName}
          placeholder="Platform"
          onChange={(changeEvent) => setField('teamName', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor={`hygiene-project-keys-${teamIndex}`}>Project keys (comma-separated)</label>
        <input
          id={`hygiene-project-keys-${teamIndex}`}
          className={styles.textInput}
          value={teamConfig.projectKeys.join(', ')}
          placeholder="PLAT, CORE"
          onChange={(changeEvent) => handleProjectKeysChange(changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor={`hygiene-schedule-${teamIndex}`}>Daily scan time (HH:MM local)</label>
        <input
          id={`hygiene-schedule-${teamIndex}`}
          className={styles.textInput}
          type="time"
          value={teamConfig.scheduleTime}
          onChange={(changeEvent) => setField('scheduleTime', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <span className={styles.fieldLabel}>Run on weekdays</span>
        <div className={styles.weekdayGroup}>
          {ALL_WEEKDAYS.map((weekdayName) => (
            <label key={weekdayName} className={styles.weekdayLabel}>
              <input
                type="checkbox"
                checked={teamConfig.weekdays.includes(weekdayName)}
                onChange={() => toggleWeekday(weekdayName)}
              />
              {weekdayName}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor={`hygiene-trigger-url-${teamIndex}`}>Digest trigger webhook URL (Atlassian Automation)</label>
        <input
          id={`hygiene-trigger-url-${teamIndex}`}
          className={styles.textInput}
          value={teamConfig.digestTriggerUrl}
          placeholder="https://…atlassian.net/… incoming webhook (rule emails the digest)"
          onChange={(changeEvent) => setField('digestTriggerUrl', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor={`hygiene-email-${teamIndex}`}>Digest email recipient</label>
        <input
          id={`hygiene-email-${teamIndex}`}
          className={styles.textInput}
          value={teamConfig.digestEmailTo}
          placeholder="team-dl@example.com (passed to the Automation rule)"
          onChange={(changeEvent) => setField('digestEmailTo', changeEvent.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor={`hygiene-secret-${teamIndex}`}>Digest webhook secret (write-only)</label>
        <input
          id={`hygiene-secret-${teamIndex}`}
          className={styles.textInput}
          type="password"
          value={teamConfig.digestTriggerSecret}
          placeholder="Leave blank to keep existing"
          onChange={(changeEvent) => setField('digestTriggerSecret', changeEvent.target.value)}
          autoComplete="new-password"
        />
      </div>

      <div className={styles.inputRow}>
        <button
          type="button"
          className={styles.actionButton}
          disabled={isScanRunning || !teamConfig.teamName}
          onClick={onScanNow}
          aria-label={`Scan now for team ${teamConfig.teamName}`}
        >
          {isScanRunning ? '⏳ Scanning…' : '▶ Scan Now'}
        </button>
      </div>

      {lastScanResult && (
        <div className={styles.scanResultSummary} aria-live="polite">
          Last scan: {lastScanResult.issuesScanned} issues scanned,{' '}
          {lastScanResult.violationsFound} violations, {lastScanResult.fixesApplied} fixed,{' '}
          {lastScanResult.actionsRequired} actions required.
          {lastScanResult.failures.length > 0 && (
            <span className={styles.scanFailureNote}>
              {' '}({lastScanResult.failures.length} failures)
            </span>
          )}
        </div>
      )}
    </div>
  )
}
