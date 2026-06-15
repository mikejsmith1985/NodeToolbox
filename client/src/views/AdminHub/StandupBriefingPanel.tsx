// StandupBriefingPanel.tsx — Pre-standup briefing configuration and on-demand generation panel.
//
// Self-contained panel embedded in the Admin Hub "Standup" tab. Manages all
// state locally — no AdminHubState wiring required.

import { useCallback, useEffect, useState } from 'react'

import { useConnectionStore } from '../../store/connectionStore'
import styles from './AdminHubView.module.css'

// ── Types ──

interface StandupTeamReport {
  teamName:           string
  projectKeys:        string[]
  scheduleTime:       string
  confluenceSpaceKey: string
  targetBlogUrl:      string
  triggerUrl:         string
  triggerSecret:      string
  daysBack:           number
  isEnabled:          boolean
}

interface StandupArtRollup {
  confluenceSpaceKey: string
  targetBlogUrl:      string
  triggerUrl:         string
  triggerSecret:      string
  scheduleTime:       string
  isEnabled:          boolean
}

interface StandupBriefingCounts {
  statusChanges: number
  blockers:      number
  defects:       number
  risks:         number
  completions:   number
}

interface StandupRunResult {
  ok:           boolean
  briefingText: string
  message:      string
  counts?:      StandupBriefingCounts
  postUrl?:     string
}

// ── Default builders ──

function buildDefaultTeamReport(): StandupTeamReport {
  return {
    teamName:           '',
    projectKeys:        [],
    scheduleTime:       '08:45',
    confluenceSpaceKey: '',
    targetBlogUrl:      '',
    triggerUrl:         '',
    triggerSecret:      '',
    daysBack:           1,
    isEnabled:          false,
  }
}

function buildDefaultArtRollup(): StandupArtRollup {
  return {
    confluenceSpaceKey: '',
    targetBlogUrl:      '',
    triggerUrl:         '',
    triggerSecret:      '',
    scheduleTime:       '09:00',
    isEnabled:          false,
  }
}

// ── API helpers (no shared service layer needed — panel is self-contained) ──

async function fetchStandupConfig(): Promise<{ teamReports: StandupTeamReport[]; artRollup: StandupArtRollup }> {
  const response = await fetch('/api/standup/config')
  if (!response.ok) throw new Error('Failed to load standup config: ' + response.statusText)
  return response.json() as Promise<{ teamReports: StandupTeamReport[]; artRollup: StandupArtRollup }>
}

async function saveStandupConfig(teamReports: StandupTeamReport[], artRollup: StandupArtRollup): Promise<void> {
  const response = await fetch('/api/standup/config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ teamReports, artRollup }),
  })
  if (!response.ok) throw new Error('Failed to save standup config: ' + response.statusText)
}

async function runTeamBriefingNow(teamIndex: number): Promise<StandupRunResult> {
  const response = await fetch('/api/standup/run-team', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ teamIndex }),
  })
  return response.json() as Promise<StandupRunResult>
}

async function runArtRollupNow(): Promise<StandupRunResult> {
  const response = await fetch('/api/standup/run-rollup', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  })
  return response.json() as Promise<StandupRunResult>
}

// ── Component ──

/**
 * Renders the Pre-Standup Briefing configuration panel embedded in the Admin Hub.
 * Allows users to configure per-team briefing schedules, Confluence delivery,
 * and trigger webhooks, then run on demand or await the scheduled time.
 */
export function StandupBriefingPanel() {
  const isJiraReady = useConnectionStore((storeState) => storeState.isJiraReady)

  const [teamReports, setTeamReports]       = useState<StandupTeamReport[]>([])
  const [artRollup,   setArtRollup]         = useState<StandupArtRollup>(buildDefaultArtRollup())
  const [isBusy,      setIsBusy]            = useState(false)
  const [saveStatus,  setSaveStatus]        = useState<string | null>(null)
  const [errorMessage, setErrorMessage]     = useState<string | null>(null)

  // Per-team run results, keyed by team index; ART rollup stored at index -1 convention
  const [teamRunResults,    setTeamRunResults]    = useState<(StandupRunResult | null)[]>([])
  const [artRollupResult,   setArtRollupResult]   = useState<StandupRunResult | null>(null)
  const [teamCopyLabels,    setTeamCopyLabels]    = useState<string[]>([])
  const [artRollupCopyLabel, setArtRollupCopyLabel] = useState('Copy Briefing')
  const [isTeamRunning,     setIsTeamRunning]     = useState<boolean[]>([])
  const [isArtRollupRunning, setIsArtRollupRunning] = useState(false)

  const refreshConfig = useCallback(async () => {
    setErrorMessage(null)
    try {
      const loadedConfig = await fetchStandupConfig()
      setTeamReports(loadedConfig.teamReports || [])
      setArtRollup(loadedConfig.artRollup   || buildDefaultArtRollup())
      setTeamRunResults(new Array(loadedConfig.teamReports.length).fill(null))
      setTeamCopyLabels(new Array(loadedConfig.teamReports.length).fill('Copy Briefing'))
      setIsTeamRunning(new Array(loadedConfig.teamReports.length).fill(false))
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
      setErrorMessage(message)
    }
  }, [])

  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void refreshConfig() }, 0)
    return () => clearTimeout(timeoutHandle)
  }, [refreshConfig, isJiraReady])

  // ── Team report helpers ──

  function updateTeamReport(teamIndex: number, field: keyof StandupTeamReport, value: unknown) {
    setTeamReports((previousReports) =>
      previousReports.map((report, reportIndex) =>
        reportIndex === teamIndex ? { ...report, [field]: value } : report
      )
    )
  }

  function addTeamReport() {
    setTeamReports((previousReports) => [...previousReports, buildDefaultTeamReport()])
    setTeamRunResults((previousResults) => [...previousResults, null])
    setTeamCopyLabels((previousLabels) => [...previousLabels, 'Copy Briefing'])
    setIsTeamRunning((previousRunning) => [...previousRunning, false])
  }

  function removeTeamReport(teamIndex: number) {
    setTeamReports((previousReports) => previousReports.filter((_, reportIndex) => reportIndex !== teamIndex))
    setTeamRunResults((previousResults) => previousResults.filter((_, resultIndex) => resultIndex !== teamIndex))
    setTeamCopyLabels((previousLabels) => previousLabels.filter((_, labelIndex) => labelIndex !== teamIndex))
    setIsTeamRunning((previousRunning) => previousRunning.filter((_, runningIndex) => runningIndex !== teamIndex))
  }

  // ── Save ──

  async function handleSaveConfig() {
    setIsBusy(true)
    setSaveStatus(null)
    setErrorMessage(null)
    try {
      await saveStandupConfig(teamReports, artRollup)
      setSaveStatus('✅ Saved')
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
      setErrorMessage(message)
    } finally {
      setIsBusy(false)
    }
  }

  // ── Run team now ──

  async function handleRunTeamNow(teamIndex: number) {
    setIsTeamRunning((previousRunning) => previousRunning.map((value, runningIndex) => runningIndex === teamIndex ? true : value))
    setErrorMessage(null)
    try {
      const result = await runTeamBriefingNow(teamIndex)
      setTeamRunResults((previousResults) =>
        previousResults.map((value, resultIndex) => resultIndex === teamIndex ? result : value)
      )
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
      setErrorMessage(message)
    } finally {
      setIsTeamRunning((previousRunning) => previousRunning.map((value, runningIndex) => runningIndex === teamIndex ? false : value))
    }
  }

  // ── Run ART rollup ──

  async function handleRunArtRollupNow() {
    setIsArtRollupRunning(true)
    setErrorMessage(null)
    try {
      const result = await runArtRollupNow()
      setArtRollupResult(result)
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
      setErrorMessage(message)
    } finally {
      setIsArtRollupRunning(false)
    }
  }

  // ── Copy helpers ──

  async function handleCopyTeamBriefing(teamIndex: number) {
    const briefingText = teamRunResults[teamIndex]?.briefingText
    if (!briefingText) return
    await navigator.clipboard.writeText(briefingText)
    setTeamCopyLabels((previousLabels) =>
      previousLabels.map((label, labelIndex) => labelIndex === teamIndex ? '✓ Copied!' : label)
    )
    setTimeout(() => {
      setTeamCopyLabels((previousLabels) =>
        previousLabels.map((label, labelIndex) => labelIndex === teamIndex ? 'Copy Briefing' : label)
      )
    }, 1500)
  }

  async function handleCopyArtRollup() {
    if (!artRollupResult?.briefingText) return
    await navigator.clipboard.writeText(artRollupResult.briefingText)
    setArtRollupCopyLabel('✓ Copied!')
    setTimeout(() => setArtRollupCopyLabel('Copy Briefing'), 1500)
  }

  // ── Render ──

  return (
    <div>
      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>📋 Pre-Standup Briefing</h2>
        <p className={styles.adminDescription}>
          Scans Jira activity from the last 24 hours and generates a structured plain-text briefing with
          markdown tables for status changes, blockers, defects, risks, and completions. Delivers to
          Confluence and fires an optional trigger webhook.
        </p>

        {errorMessage && (
          <p style={{ color: 'var(--color-tone-error-fg)', margin: '0' }}>{errorMessage}</p>
        )}

        {teamReports.map((teamReport, teamIndex) => (
          <TeamReportRow
            key={teamIndex}
            teamIndex={teamIndex}
            teamReport={teamReport}
            isRunning={isTeamRunning[teamIndex] ?? false}
            runResult={teamRunResults[teamIndex] ?? null}
            copyLabel={teamCopyLabels[teamIndex] ?? 'Copy Briefing'}
            onUpdate={(field, value) => updateTeamReport(teamIndex, field, value)}
            onRemove={() => removeTeamReport(teamIndex)}
            onRunNow={() => { void handleRunTeamNow(teamIndex) }}
            onCopy={() => { void handleCopyTeamBriefing(teamIndex) }}
          />
        ))}

        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          <button className={styles.secondaryBtn} onClick={addTeamReport}>
            + Add Team
          </button>
          <button className={styles.primaryBtn} disabled={isBusy} onClick={() => { void handleSaveConfig() }}>
            {isBusy ? 'Saving…' : 'Save Config'}
          </button>
          {saveStatus && <span style={{ color: 'var(--color-tone-success-fg)', alignSelf: 'center' }}>{saveStatus}</span>}
        </div>
      </section>

      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>📊 ART Rollup</h2>
        <p className={styles.adminDescription}>
          Combines all enabled teams into a single cross-team standup briefing for Scrum-of-Scrums or PI-level standups.
        </p>

        <ArtRollupRow
          artRollup={artRollup}
          isRunning={isArtRollupRunning}
          runResult={artRollupResult}
          copyLabel={artRollupCopyLabel}
          onUpdate={(field, value) => setArtRollup((previous) => ({ ...previous, [field]: value }))}
          onRunNow={() => { void handleRunArtRollupNow() }}
          onCopy={() => { void handleCopyArtRollup() }}
        />
      </section>
    </div>
  )
}

// ── Sub-components ──

interface TeamReportRowProps {
  teamIndex:  number
  teamReport: StandupTeamReport
  isRunning:  boolean
  runResult:  StandupRunResult | null
  copyLabel:  string
  onUpdate(field: keyof StandupTeamReport, value: unknown): void
  onRemove(): void
  onRunNow(): void
  onCopy(): void
}

/**
 * Renders a single team report configuration row with run controls and result display.
 */
function TeamReportRow({
  teamIndex, teamReport, isRunning, runResult, copyLabel, onUpdate, onRemove, onRunNow, onCopy,
}: TeamReportRowProps) {
  const projectKeysString = teamReport.projectKeys.join(', ')

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--spacing-md)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Team {teamIndex + 1}{teamReport.teamName ? ': ' + teamReport.teamName : ''}</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={teamReport.isEnabled}
            onChange={(changeEvent) => onUpdate('isEnabled', changeEvent.target.checked)}
          />
          Enabled
        </label>
      </div>

      <ConfigRow label="Team Name">
        <input
          type="text"
          className={styles.inputField}
          placeholder="e.g. Team Alpha"
          value={teamReport.teamName}
          onChange={(changeEvent) => onUpdate('teamName', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Project Keys">
        <input
          type="text"
          className={styles.inputField}
          placeholder="e.g. ALPHA, SHARED"
          value={projectKeysString}
          onChange={(changeEvent) => {
            const parsedKeys = changeEvent.target.value
              .split(',')
              .map((keyValue) => keyValue.trim())
              .filter(Boolean)
            onUpdate('projectKeys', parsedKeys)
          }}
        />
        <small style={{ color: 'var(--color-text-secondary)' }}>Comma-separated. All listed projects are included in one query.</small>
      </ConfigRow>

      <ConfigRow label="Schedule Time">
        <input
          type="text"
          className={styles.inputField}
          placeholder="08:45"
          value={teamReport.scheduleTime}
          style={{ width: '7rem' }}
          onChange={(changeEvent) => onUpdate('scheduleTime', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Days Back">
        <input
          type="number"
          className={styles.inputField}
          min={1}
          max={7}
          value={teamReport.daysBack}
          style={{ width: '5rem' }}
          onChange={(changeEvent) => onUpdate('daysBack', Number(changeEvent.target.value))}
        />
      </ConfigRow>

      <ConfigRow label="Confluence Space Key">
        <input
          type="text"
          className={styles.inputField}
          placeholder="e.g. TEAM"
          value={teamReport.confluenceSpaceKey}
          onChange={(changeEvent) => onUpdate('confluenceSpaceKey', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Target Blog URL">
        <input
          type="text"
          className={styles.inputField}
          placeholder="Paste Confluence page URL to update (optional)"
          value={teamReport.targetBlogUrl}
          onChange={(changeEvent) => onUpdate('targetBlogUrl', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Trigger Webhook URL">
        <input
          type="text"
          className={styles.inputField}
          placeholder="https://... (optional)"
          value={teamReport.triggerUrl}
          onChange={(changeEvent) => onUpdate('triggerUrl', changeEvent.target.value)}
        />
      </ConfigRow>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
        <button className={styles.primaryBtn} disabled={isRunning} onClick={onRunNow}>
          {isRunning ? '⏳ Running…' : '▶ Run Now'}
        </button>
        <button
          className={styles.secondaryBtn}
          disabled={!runResult?.briefingText}
          onClick={onCopy}
        >
          {copyLabel}
        </button>
        <button className={styles.dangerBtn ?? styles.secondaryBtn} onClick={onRemove}>
          Remove
        </button>
      </div>

      {runResult && (
        <RunResultDisplay runResult={runResult} />
      )}
    </div>
  )
}

interface ArtRollupRowProps {
  artRollup:  StandupArtRollup
  isRunning:  boolean
  runResult:  StandupRunResult | null
  copyLabel:  string
  onUpdate(field: keyof StandupArtRollup, value: unknown): void
  onRunNow(): void
  onCopy(): void
}

/**
 * Renders the ART rollup configuration and run controls.
 */
function ArtRollupRow({ artRollup, isRunning, runResult, copyLabel, onUpdate, onRunNow, onCopy }: ArtRollupRowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={artRollup.isEnabled}
          onChange={(changeEvent) => onUpdate('isEnabled', changeEvent.target.checked)}
        />
        Enable ART Rollup
      </label>

      <ConfigRow label="Schedule Time">
        <input
          type="text"
          className={styles.inputField}
          placeholder="09:00"
          value={artRollup.scheduleTime}
          style={{ width: '7rem' }}
          onChange={(changeEvent) => onUpdate('scheduleTime', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Confluence Space Key">
        <input
          type="text"
          className={styles.inputField}
          placeholder="e.g. ART"
          value={artRollup.confluenceSpaceKey}
          onChange={(changeEvent) => onUpdate('confluenceSpaceKey', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Target Blog URL">
        <input
          type="text"
          className={styles.inputField}
          placeholder="Confluence page URL to update (optional)"
          value={artRollup.targetBlogUrl}
          onChange={(changeEvent) => onUpdate('targetBlogUrl', changeEvent.target.value)}
        />
      </ConfigRow>

      <ConfigRow label="Trigger Webhook URL">
        <input
          type="text"
          className={styles.inputField}
          placeholder="https://... (optional)"
          value={artRollup.triggerUrl}
          onChange={(changeEvent) => onUpdate('triggerUrl', changeEvent.target.value)}
        />
      </ConfigRow>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
        <button className={styles.primaryBtn} disabled={isRunning} onClick={onRunNow}>
          {isRunning ? '⏳ Running…' : '▶ Run ART Rollup Now'}
        </button>
        <button className={styles.secondaryBtn} disabled={!runResult?.briefingText} onClick={onCopy}>
          {copyLabel}
        </button>
      </div>

      {runResult && (
        <RunResultDisplay runResult={runResult} />
      )}
    </div>
  )
}

// ── Shared display helpers ──

interface ConfigRowProps {
  label:    string
  children: React.ReactNode
}

/** Renders a label + input in a consistent two-column layout. */
function ConfigRow({ label, children }: ConfigRowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

interface RunResultDisplayProps {
  runResult: StandupRunResult
}

/**
 * Shows the run status message, counts bar, Confluence URL (if delivered),
 * and the plain-text briefing in a scrollable textarea for review.
 */
function RunResultDisplay({ runResult }: RunResultDisplayProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)', marginTop: 'var(--spacing-xs)' }}>
      <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: runResult.ok ? 'var(--color-tone-success-fg)' : 'var(--color-tone-error-fg)' }}>
        {runResult.message}
      </p>

      {runResult.counts && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          Status Changes: {runResult.counts.statusChanges} &nbsp;|&nbsp;
          Blockers: {runResult.counts.blockers} &nbsp;|&nbsp;
          Defects: {runResult.counts.defects} &nbsp;|&nbsp;
          Risks: {runResult.counts.risks} &nbsp;|&nbsp;
          Completions: {runResult.counts.completions}
        </p>
      )}

      {runResult.postUrl && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-sm)' }}>
          Confluence: <a href={runResult.postUrl} target="_blank" rel="noreferrer">{runResult.postUrl}</a>
        </p>
      )}

      {runResult.briefingText && (
        <textarea
          readOnly
          value={runResult.briefingText}
          rows={20}
          style={{
            width: '100%',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
            background: 'var(--color-surface-2, var(--color-card-bg))',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--spacing-sm)',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
          aria-label="Generated standup briefing — read-only preview"
        />
      )}
    </div>
  )
}
