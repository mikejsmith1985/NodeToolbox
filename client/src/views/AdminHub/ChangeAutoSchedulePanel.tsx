// ChangeAutoSchedulePanel.tsx — Admin Hub panel for the change auto-start sweeper.
//
// Configures the server-side sweep that moves a ServiceNow change from Scheduled to Implement once
// its planned start arrives, triggers a sweep on demand, and shows what the recent sweeps actually
// did — including the sweeps that could not act, and why.

import { useCallback, useEffect, useState } from 'react'

import styles from './AdminHubView.module.css'

// ── Types (mirror src/routes/changeAutoSchedule.js) ──

interface ChangeAutoScheduleConfig {
  isEnabled: boolean
  /** Names the changes it would move, and moves none — for proving the scope before switching it on. */
  isDryRun: boolean
  intervalMin: number
  leadTimeMinutes: number
}

interface ChangeAutoScheduleFailure {
  changeNumber: string
  message: string
}

interface ChangeAutoScheduleRun {
  ranAtIso: string
  isDryRun: boolean
  scheduledChangeNumbers: string[]
  failures: ChangeAutoScheduleFailure[]
  /** Why the sweep did nothing — an unregistered relay, or a read ServiceNow refused. */
  skipReason: string
  consideredCount: number
}

// ── API helpers ──

async function fetchChangeAutoScheduleConfig(): Promise<ChangeAutoScheduleConfig> {
  const response = await fetch('/api/change-auto-schedule/config')
  if (!response.ok) throw new Error('Failed to load the auto-schedule config: ' + response.statusText)
  return await response.json() as ChangeAutoScheduleConfig
}

async function saveChangeAutoScheduleConfig(config: ChangeAutoScheduleConfig): Promise<void> {
  const response = await fetch('/api/change-auto-schedule/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!response.ok) throw new Error('Failed to save the auto-schedule config: ' + response.statusText)
}

async function fetchRecentRuns(): Promise<ChangeAutoScheduleRun[]> {
  const response = await fetch('/api/change-auto-schedule/runs')
  if (!response.ok) return []
  const body = await response.json() as { runs?: ChangeAutoScheduleRun[] }
  return body.runs ?? []
}

async function requestSweepNow(): Promise<{ ok: boolean; message?: string; run?: ChangeAutoScheduleRun }> {
  const response = await fetch('/api/change-auto-schedule/run-now', { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; run?: ChangeAutoScheduleRun }
}

// ── Presentation helpers ──

/** One sweep in a sentence: what it moved, or why it moved nothing. */
function describeRun(run: ChangeAutoScheduleRun): string {
  if (run.skipReason) return run.skipReason
  if (run.scheduledChangeNumbers.length === 0) return `Nothing was due (${run.consideredCount} change(s) checked).`
  const verb = run.isDryRun ? 'Would have started' : 'Started'
  return `${verb} ${run.scheduledChangeNumbers.join(', ')}.`
}

/** Renders an ISO timestamp in the reader's own locale, or a dash when it cannot be read. */
function formatRunTimestamp(ranAtIso: string): string {
  const parsedMilliseconds = Date.parse(ranAtIso)
  return Number.isNaN(parsedMilliseconds) ? '—' : new Date(parsedMilliseconds).toLocaleString()
}

// ── Component ──

/** Admin Hub panel that configures and triggers the change auto-start sweeper. */
export function ChangeAutoSchedulePanel() {
  const [config, setConfig] = useState<ChangeAutoScheduleConfig | null>(null)
  const [recentRuns, setRecentRuns] = useState<ChangeAutoScheduleRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSweeping, setIsSweeping] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  // Run Now acts on the SERVER's saved config, so it is disabled while the form holds edits — the
  // same gating rule as the sibling scheduler panels.
  const [isDirty, setIsDirty] = useState(false)

  const loadEverything = useCallback(async () => {
    try {
      const [loadedConfig, loadedRuns] = await Promise.all([fetchChangeAutoScheduleConfig(), fetchRecentRuns()])
      setConfig(loadedConfig)
      setRecentRuns(loadedRuns)
      setIsDirty(false)
      setStatusMessage('')
    } catch (loadError) {
      setStatusMessage(loadError instanceof Error ? loadError.message : 'Failed to load configuration.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  /** Re-attempts the initial load after a failure (shown on the error screen). */
  const handleRetryLoad = useCallback(() => {
    setIsLoading(true)
    void loadEverything()
  }, [loadEverything])

  // Deferred to a macrotask (house pattern) so the effect never setStates synchronously.
  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void loadEverything() }, 0)
    return () => clearTimeout(timeoutHandle)
  }, [loadEverything])

  function updateConfig(patch: Partial<ChangeAutoScheduleConfig>) {
    setConfig((currentConfig) => (currentConfig === null ? currentConfig : { ...currentConfig, ...patch }))
    setIsDirty(true)
  }

  /**
   * The master on/off switch saves IMMEDIATELY, committing the form as shown. A toggle that quietly
   * discarded itself unless Save was also clicked reads as a setting that does not persist.
   */
  async function handleToggleEnabled(isEnabled: boolean) {
    if (config === null) return
    const nextConfig = { ...config, isEnabled }
    setConfig(nextConfig)
    setIsSaving(true)
    setStatusMessage('')
    try {
      await saveChangeAutoScheduleConfig(nextConfig)
      setIsDirty(false)
      setStatusMessage(isEnabled ? 'Saved — sweeping enabled.' : 'Saved — sweeping disabled.')
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSave() {
    if (config === null) return
    setIsSaving(true)
    setStatusMessage('')
    try {
      await saveChangeAutoScheduleConfig(config)
      setIsDirty(false)
      setStatusMessage('Saved.')
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSweepNow() {
    setIsSweeping(true)
    setStatusMessage('')
    try {
      const outcome = await requestSweepNow()
      if (outcome.ok && outcome.run) {
        setStatusMessage(describeRun(outcome.run))
        setRecentRuns(await fetchRecentRuns())
      } else {
        setStatusMessage(outcome.message || 'Sweep failed.')
      }
    } catch (sweepError) {
      setStatusMessage(sweepError instanceof Error ? sweepError.message : 'Sweep failed.')
    } finally {
      setIsSweeping(false)
    }
  }

  if (isLoading) {
    return <p>Loading the change auto-start sweeper…</p>
  }

  // Load finished but produced no config — a failure state, never a permanent "Loading…".
  if (config === null) {
    return (
      <div className={styles.panelSection}>
        <h2>🗓 Auto-start Changes</h2>
        <p role="status" className={styles.panelStatusLine}>
          Could not load the change auto-start sweeper: {statusMessage || 'unknown error'}.
        </p>
        <button type="button" className={styles.actionButton} onClick={handleRetryLoad}>Retry</button>
      </div>
    )
  }

  return (
    <div className={styles.panelSection}>
      <h2>🗓 Auto-start Changes</h2>
      <p>
        Moves each of your ServiceNow changes from <strong>Scheduled</strong> to <strong>Implement</strong> once its
        planned start arrives, so nobody has to sit and watch the clock. Only changes
        <strong> assigned to you</strong> are touched, and only from Scheduled — a change that has not got that far
        is reported, never advanced past the steps it has not had.
      </p>
      <p className={styles.panelStatusLine}>
        ServiceNow writes ride the <strong>relay bookmarklet</strong>, so a sweep can only act while it is registered.
        A sweep that finds the relay closed changes nothing and says so; the work stays due and the next sweep does it.
      </p>

      <fieldset className={styles.panelCard}>
        <div>
          <label>
            <input
              type="checkbox"
              aria-label="Enable auto-start"
              checked={config.isEnabled}
              disabled={isSaving}
              onChange={(event) => void handleToggleEnabled(event.target.checked)}
            />
            {' '}Enabled — saves immediately
          </label>
        </div>
        <div>
          <label>
            <input
              type="checkbox"
              aria-label="Dry run"
              checked={config.isDryRun}
              onChange={(event) => updateConfig({ isDryRun: event.target.checked })}
            />
            {' '}Dry run — name what would move, change nothing
          </label>
        </div>
        <label>Sweep every (minutes)
          <input
            aria-label="Sweep interval in minutes"
            className={styles.inputField}
            type="number"
            min={1}
            max={240}
            value={config.intervalMin}
            onChange={(event) => updateConfig({ intervalMin: Number(event.target.value) })}
          />
        </label>
        <label>Lead time (minutes before planned start)
          <input
            aria-label="Lead time in minutes"
            className={styles.inputField}
            type="number"
            min={0}
            max={1440}
            value={config.leadTimeMinutes}
            onChange={(event) => updateConfig({ leadTimeMinutes: Number(event.target.value) })}
          />
        </label>

        <div className={styles.panelActions}>
          <button type="button" className={styles.saveButton} disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            disabled={isSweeping || isDirty}
            onClick={() => void handleSweepNow()}
          >
            {isSweeping ? 'Sweeping…' : 'Sweep Now'}
          </button>
        </div>
        {isDirty && <p className={styles.panelStatusLine}>Unsaved changes — save before Sweep Now.</p>}
        {statusMessage !== '' && <p role="status" className={styles.panelStatusLine}>{statusMessage}</p>}
      </fieldset>

      <fieldset className={styles.panelCard}>
        <p><strong>Recent sweeps</strong></p>
        {recentRuns.length === 0
          ? <p className={styles.panelStatusLine}>No sweeps recorded yet.</p>
          : (
            <ul>
              {recentRuns.map((run) => (
                <li key={run.ranAtIso}>
                  <span>{formatRunTimestamp(run.ranAtIso)}</span> — <span>{describeRun(run)}</span>
                  {run.failures.length > 0 && (
                    <ul>
                      {run.failures.map((failure) => (
                        <li key={failure.changeNumber}>{failure.changeNumber}: {failure.message}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
      </fieldset>
    </div>
  )
}
