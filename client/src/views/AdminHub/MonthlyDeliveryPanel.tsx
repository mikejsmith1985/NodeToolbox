// MonthlyDeliveryPanel.tsx — Admin Hub panel for the Monthly Delivery Report scheduler (feature 018).
// Self-contained: manages its own state and talks to /api/monthly-delivery/* directly. The team list
// is a point-in-time SNAPSHOT of the Team Dashboard team profiles (settings store) taken when the user
// clicks "Snapshot Teams" and persisted on Save — the server scheduler cannot read browser storage.

import { useCallback, useEffect, useState } from 'react'

import { useSettingsStore } from '../../store/settingsStore.ts'
import { loadConfiguredFeatureLinkFieldId } from '../../utils/featureLink.ts'
import styles from './AdminHubView.module.css'

// ── Types (mirror contracts/http-api.md) ──

interface MonthlyDeliveryTeamSnapshot {
  teamName: string
  projectKey: string
  boardId: string
}

interface MonthlyDeliveryConfig {
  isEnabled: boolean
  scheduleTime: string
  featureLinkFieldId: string
  teams: MonthlyDeliveryTeamSnapshot[]
  /** Atlassian Automation webhook the run's prompt is delivered to; empty = cache only. */
  triggerUrl: string
  triggerSecret: string
}

interface MonthlyDeliveryTeamOutcome {
  teamName: string
  status: 'ok' | 'empty' | 'error'
  productionCount: number
  externalTestCount: number
  message: string
}

interface MonthlyDeliveryRunResult {
  hasRun: boolean
  ranAtIso?: string
  coveredMonth?: string
  trigger?: 'scheduled' | 'manual'
  promptText?: string
  teams?: MonthlyDeliveryTeamOutcome[]
  /** What the run did about delivery: skipped (no webhook), delivered, or failed with a reason. */
  delivery?: { attempted: boolean; ok?: boolean; message?: string }
}

const COPY_PROMPT_IDLE_LABEL = '📋 Copy Prompt'
const COPY_PROMPT_DONE_LABEL = '✓ Copied!'
const COPY_LABEL_RESET_MS = 1500

// ── API helpers ──

async function fetchMonthlyDeliveryConfig(): Promise<MonthlyDeliveryConfig> {
  const response = await fetch('/api/monthly-delivery/config')
  if (!response.ok) throw new Error('Failed to load Monthly Delivery config: ' + response.statusText)
  return await response.json() as MonthlyDeliveryConfig
}

async function saveMonthlyDeliveryConfig(config: MonthlyDeliveryConfig): Promise<void> {
  const response = await fetch('/api/monthly-delivery/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!response.ok) throw new Error('Failed to save Monthly Delivery config: ' + response.statusText)
}

async function fetchLastRun(): Promise<MonthlyDeliveryRunResult> {
  const response = await fetch('/api/monthly-delivery/status')
  if (!response.ok) return { hasRun: false }
  return await response.json() as MonthlyDeliveryRunResult
}

async function requestRunNow(): Promise<{ ok: boolean; message?: string; result?: MonthlyDeliveryRunResult }> {
  const response = await fetch('/api/monthly-delivery/run-now', { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; result?: MonthlyDeliveryRunResult }
}

// ── Component ──

/** Admin Hub panel that configures, triggers, and surfaces the monthly delivery-report prompt. */
export function MonthlyDeliveryPanel() {
  const teamProfiles = useSettingsStore((state) => state.sprintDashboardTeamProfiles)
  const [config, setConfig] = useState<MonthlyDeliveryConfig | null>(null)
  const [lastRun, setLastRun] = useState<MonthlyDeliveryRunResult>({ hasRun: false })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [copyLabel, setCopyLabel] = useState(COPY_PROMPT_IDLE_LABEL)
  // True when the panel holds edits not yet saved. Run Now acts on the SERVER's saved config,
  // so it is disabled while dirty (same gating rule as the PI Review scheduler panel).
  const [isDirty, setIsDirty] = useState(false)

  const loadEverything = useCallback(async () => {
    try {
      const [loadedConfig, loadedLastRun] = await Promise.all([fetchMonthlyDeliveryConfig(), fetchLastRun()])
      setConfig(loadedConfig)
      setLastRun(loadedLastRun)
      setIsDirty(false)
      setStatusMessage('')
    } catch (loadError) {
      // A server whose monthly-delivery routes failed to mount (e.g. a build missing the engine
      // bundle) answers with the SPA fallback, so json() rejects — surface it, never hang on Loading.
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

  // Defer the initial load to a macrotask (house pattern) so the effect never setStates synchronously.
  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void loadEverything() }, 0)
    return () => clearTimeout(timeoutHandle)
  }, [loadEverything])

  function updateConfig(patch: Partial<MonthlyDeliveryConfig>) {
    setConfig((currentConfig) => (currentConfig === null ? currentConfig : { ...currentConfig, ...patch }))
    setIsDirty(true)
  }

  /**
   * The master on/off switch saves IMMEDIATELY (committing the form as shown), unlike the buffered
   * fields. A toggle that silently discarded itself unless the user remembered to click Save read
   * as "the enabled setting doesn't persist" — which is exactly how it was reported.
   */
  async function handleToggleEnabled(isEnabled: boolean) {
    if (config === null) return
    const nextConfig = { ...config, isEnabled }
    setConfig(nextConfig)
    setIsSaving(true)
    setStatusMessage('')
    try {
      await saveMonthlyDeliveryConfig(nextConfig)
      setIsDirty(false)
      setStatusMessage(isEnabled ? 'Saved — schedule enabled.' : 'Saved — schedule disabled.')
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  /** Replaces the team list with a fresh snapshot of the Team Dashboard profiles. */
  function handleSnapshotTeams() {
    updateConfig({
      teams: teamProfiles.map((profile) => ({
        teamName: profile.name,
        projectKey: profile.projectKey,
        boardId: profile.boardId,
      })),
      featureLinkFieldId: loadConfiguredFeatureLinkFieldId(),
    })
  }

  async function handleSave() {
    if (config === null) return
    setIsSaving(true)
    setStatusMessage('')
    try {
      await saveMonthlyDeliveryConfig(config)
      setIsDirty(false)
      setStatusMessage('Saved.')
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRunNow() {
    setIsRunning(true)
    setStatusMessage('')
    try {
      const outcome = await requestRunNow()
      if (outcome.ok && outcome.result) {
        setLastRun(outcome.result)
        setStatusMessage('Run complete.')
      } else {
        setStatusMessage(outcome.message || 'Run failed.')
      }
    } catch (runError) {
      setStatusMessage(runError instanceof Error ? runError.message : 'Run failed.')
    } finally {
      setIsRunning(false)
    }
  }

  async function handleCopyPrompt() {
    if (!lastRun.promptText) return
    await navigator.clipboard.writeText(lastRun.promptText)
    setCopyLabel(COPY_PROMPT_DONE_LABEL)
    setTimeout(() => setCopyLabel(COPY_PROMPT_IDLE_LABEL), COPY_LABEL_RESET_MS)
  }

  if (isLoading) {
    return <p>Loading Monthly Delivery scheduler…</p>
  }

  // Load finished but produced no config — the failure state, NOT a loading state. Without this
  // branch a failed load rendered "Loading…" forever (shipped in v0.74.0).
  if (config === null) {
    return (
      <div className={styles.panelSection}>
        <h2>📅 Monthly Delivery Report</h2>
        <p role="status" className={styles.panelStatusLine}>
          Could not load the Monthly Delivery scheduler: {statusMessage || 'unknown error'}.
          If this persists after a retry, the server build may be missing the monthly-delivery engine —
          check the server log for &quot;Monthly Delivery routes unavailable&quot;.
        </p>
        <button type="button" className={styles.actionButton} onClick={handleRetryLoad}>Retry</button>
      </div>
    )
  }

  const hasNoTeamsConfigured = config.teams.length === 0

  return (
    <div className={styles.panelSection}>
      <h2>📅 Monthly Delivery Report</h2>
      <p>
        On the <strong>2nd Tuesday of each month</strong>, gather everything each snapshotted team delivered in the
        prior calendar month — grouped by Feature, split into <strong>Production</strong> and
        <strong> External Test</strong> — and build one AI-ready prompt to paste into your in-house agent.
        Runs reuse the server&apos;s existing Jira credentials.
      </p>

      <fieldset className={styles.panelCard}>
        <div>
          <label>
            <input
              type="checkbox"
              aria-label="Enable monthly schedule"
              checked={config.isEnabled}
              disabled={isSaving}
              onChange={(event) => void handleToggleEnabled(event.target.checked)}
            />
            {' '}Enabled (fires on the 2nd Tuesday) — saves immediately
          </label>
        </div>
        <label>Schedule time (HH:MM)
          <input
            aria-label="Schedule time (HH:MM)"
            className={styles.inputField}
            value={config.scheduleTime}
            onChange={(event) => updateConfig({ scheduleTime: event.target.value })}
          />
        </label>
        <label>Automation webhook URL (optional — delivers the prompt like the other scheduled reports)
          <input
            aria-label="Automation webhook URL"
            className={styles.inputField}
            placeholder="https://api-private.atlassian.com/automation/webhooks/…"
            value={config.triggerUrl}
            onChange={(event) => updateConfig({ triggerUrl: event.target.value })}
          />
        </label>
        <label>Automation webhook secret (optional)
          <input
            aria-label="Automation webhook secret"
            className={styles.inputField}
            type="password"
            value={config.triggerSecret}
            onChange={(event) => updateConfig({ triggerSecret: event.target.value })}
          />
        </label>

        <p><strong>Snapshotted teams</strong> — copied from your Team Dashboard profiles; re-snapshot and save to pick up changes.</p>
        {hasNoTeamsConfigured
          ? <p className={styles.panelStatusLine}>No teams configured — snapshot teams and save first.</p>
          : (
            <ul>
              {config.teams.map((team, teamIndex) => (
                <li key={teamIndex}>
                  <span>{team.teamName}</span> · <span>{team.projectKey}</span>
                  {team.boardId ? <span> · board {team.boardId}</span> : null}
                </li>
              ))}
            </ul>
          )}

        <div className={styles.panelActions}>
          <button type="button" className={styles.actionButton} onClick={handleSnapshotTeams}>Snapshot Teams</button>
          <button type="button" className={styles.saveButton} disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {isDirty && <p className={styles.panelStatusLine}>Unsaved changes — save before Run Now.</p>}
      </fieldset>

      <fieldset className={styles.panelCard}>
        <p><strong>Generate</strong></p>
        <div className={styles.panelActions}>
          <button
            type="button"
            className={styles.actionButton}
            disabled={isRunning || isDirty || hasNoTeamsConfigured}
            title={isDirty ? 'Save your changes before running — Run Now uses the saved configuration.' : undefined}
            onClick={() => void handleRunNow()}
          >
            {isRunning ? 'Running…' : 'Run Now'}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            disabled={!lastRun.promptText}
            onClick={() => void handleCopyPrompt()}
          >
            {copyLabel}
          </button>
        </div>

        {lastRun.hasRun && (
          <div>
            <p className={styles.panelStatusLine}>
              Last run: {lastRun.coveredMonth} · {lastRun.ranAtIso} · {lastRun.trigger}
            </p>
            {lastRun.delivery && (
              <p className={styles.panelStatusLine}>
                Delivery: {lastRun.delivery.attempted
                  ? (lastRun.delivery.ok ? `✓ ${lastRun.delivery.message ?? 'delivered'}` : `⚠ ${lastRun.delivery.message ?? 'failed'}`)
                  : 'skipped — no Automation webhook configured'}
              </p>
            )}
            {(lastRun.teams || []).map((teamOutcome, outcomeIndex) => (
              <p key={outcomeIndex} className={styles.panelStatusLine}>
                {teamOutcome.teamName}: <strong>{teamOutcome.status}</strong>
                {teamOutcome.status === 'ok' && ` — ${teamOutcome.productionCount} production, ${teamOutcome.externalTestCount} external test`}
                {teamOutcome.message ? ` — ${teamOutcome.message}` : ''}
              </p>
            ))}
            <textarea
              aria-label="Generated prompt"
              readOnly
              rows={14}
              className={styles.inputField}
              value={lastRun.promptText || ''}
            />
          </div>
        )}
      </fieldset>

      {statusMessage && <p role="status" className={styles.panelStatusLine}>{statusMessage}</p>}
    </div>
  )
}
