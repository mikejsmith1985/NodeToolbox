// GithubEmailIntakePanel.tsx — Admin Hub panel for the GitHub Email Intake scheduler. Self-contained:
// manages its own state and talks to /api/github-email-intake/* directly. Lets an operator point the
// engine at a local drop folder, choose a safe rollout mode (dry-run → comment-only → full), map events
// to Jira transitions, and preview/run the parse. The server scheduler cannot read browser storage, so
// everything here is persisted server-side on Save.

import { useCallback, useEffect, useState } from 'react'

import styles from './AdminHubView.module.css'

// ── Types (mirror src/routes/githubEmailIntake.js) ──

type IntakeMode = 'dryRun' | 'commentOnly' | 'full'

interface IntakeTransitions {
  branchCreated: string
  commitPushed: string
  prOpened: string
  prMerged: string
}

interface OutlookExportConfig {
  isEnabled: boolean
  sourceFolder: string
  processedFolder: string
}

interface IntakeConfig {
  isEnabled: boolean
  mode: IntakeMode
  scheduleTime: string
  intervalMin: number
  dropFolder: string
  processedArchiveFolder: string
  errorFolder: string
  fileExtensions: string[]
  jiraProjectKeys: string[]
  transitions: IntakeTransitions
  outlookExport: OutlookExportConfig
}

interface OutlookExportResult {
  ok: boolean
  skipped?: boolean
  exportedCount?: number
  total?: number
  message?: string
}

interface IntakeEvent {
  fileName: string
  outcome: string
  reason?: string
  jiraKey?: string | null
  eventType?: string
  prNumber?: number | null
  message?: string
}

interface IntakeRunResult {
  hasRun: boolean
  ranAtIso?: string
  trigger?: string
  mode?: string
  postedCount?: number
  skippedCount?: number
  errorCount?: number
  folderError?: string
  events?: IntakeEvent[]
}

const MODE_LABELS: Record<IntakeMode, string> = {
  dryRun: 'Dry run — parse & log only, never touch Jira',
  commentOnly: 'Comment only — post comments, no status transitions',
  full: 'Full — post comments AND fire status transitions',
}

// ── API helpers ──

async function fetchConfig(): Promise<IntakeConfig> {
  const response = await fetch('/api/github-email-intake/config')
  if (!response.ok) throw new Error('Failed to load GitHub Email Intake config: ' + response.statusText)
  return await response.json() as IntakeConfig
}

async function saveConfig(config: IntakeConfig): Promise<{ ok: boolean; folderWarning?: string | null; message?: string }> {
  const response = await fetch('/api/github-email-intake/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return await response.json() as { ok: boolean; folderWarning?: string | null; message?: string }
}

async function fetchStatus(): Promise<IntakeRunResult> {
  const response = await fetch('/api/github-email-intake/status')
  if (!response.ok) return { hasRun: false }
  return await response.json() as IntakeRunResult
}

async function postAction(pathSuffix: 'run-now' | 'preview'): Promise<{ ok: boolean; message?: string; result?: IntakeRunResult }> {
  const response = await fetch('/api/github-email-intake/' + pathSuffix, { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; result?: IntakeRunResult }
}

async function postExportTest(): Promise<{ ok: boolean; message?: string; result?: OutlookExportResult }> {
  const response = await fetch('/api/github-email-intake/export-test', { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; result?: OutlookExportResult }
}

/** Renders a comma-separated list into a trimmed string array, dropping blanks. */
function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter((part) => part !== '')
}

// ── Component ──

/** Admin Hub panel that configures, previews, and triggers the GitHub email intake engine. */
export function GithubEmailIntakePanel() {
  const [config, setConfig] = useState<IntakeConfig | null>(null)
  const [lastRun, setLastRun] = useState<IntakeRunResult>({ hasRun: false })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')

  const loadEverything = useCallback(async () => {
    try {
      const [loadedConfig, loadedStatus] = await Promise.all([fetchConfig(), fetchStatus()])
      setConfig(loadedConfig)
      setLastRun(loadedStatus)
      setIsDirty(false)
      setStatusMessage('')
    } catch (loadError) {
      setStatusMessage(loadError instanceof Error ? loadError.message : 'Failed to load configuration.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutHandle = setTimeout(() => { void loadEverything() }, 0)
    return () => clearTimeout(timeoutHandle)
  }, [loadEverything])

  function updateConfig(patch: Partial<IntakeConfig>) {
    setConfig((current) => (current === null ? current : { ...current, ...patch }))
    setIsDirty(true)
  }

  function updateTransition(patch: Partial<IntakeTransitions>) {
    setConfig((current) => (current === null ? current : { ...current, transitions: { ...current.transitions, ...patch } }))
    setIsDirty(true)
  }

  function updateOutlookExport(patch: Partial<OutlookExportConfig>) {
    setConfig((current) => (current === null ? current : { ...current, outlookExport: { ...current.outlookExport, ...patch } }))
    setIsDirty(true)
  }

  // Runs just the Outlook export (pull emails → drop folder), so the operator can verify the Outlook side
  // before enabling it in the scheduled run. Save first, since it acts on the saved config.
  async function handleTestExport() {
    setIsExporting(true)
    setExportMessage('')
    try {
      const outcome = await postExportTest()
      const result = outcome.result
      if (outcome.ok && result) {
        setExportMessage(`Exported ${result.exportedCount ?? 0} of ${result.total ?? 0} Outlook message(s).`)
      } else {
        setExportMessage(result?.message || outcome.message || 'Outlook export failed.')
      }
    } catch (exportError) {
      setExportMessage(exportError instanceof Error ? exportError.message : 'Outlook export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  async function persist(nextConfig: IntakeConfig, successMessage: string) {
    setIsSaving(true)
    setStatusMessage('')
    try {
      const outcome = await saveConfig(nextConfig)
      if (!outcome.ok) {
        setStatusMessage(outcome.message || 'Failed to save.')
        return
      }
      setIsDirty(false)
      setStatusMessage(outcome.folderWarning ? successMessage + ' ⚠ ' + outcome.folderWarning : successMessage)
    } catch (saveError) {
      setStatusMessage(saveError instanceof Error ? saveError.message : 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  // The enabled toggle commits immediately (a silently-discarded toggle reads as "it doesn't persist").
  async function handleToggleEnabled(isEnabled: boolean) {
    if (config === null) return
    const nextConfig = { ...config, isEnabled }
    setConfig(nextConfig)
    await persist(nextConfig, isEnabled ? 'Saved — intake enabled.' : 'Saved — intake disabled.')
  }

  async function handleSave() {
    if (config === null) return
    await persist(config, 'Saved.')
  }

  async function handleAction(pathSuffix: 'run-now' | 'preview') {
    setIsBusy(true)
    setStatusMessage('')
    try {
      const outcome = await postAction(pathSuffix)
      if (outcome.ok && outcome.result) {
        setLastRun(outcome.result)
        setStatusMessage(pathSuffix === 'preview' ? 'Preview complete (nothing was posted or moved).' : 'Run complete.')
      } else {
        setStatusMessage(outcome.message || 'Action failed.')
      }
    } catch (actionError) {
      setStatusMessage(actionError instanceof Error ? actionError.message : 'Action failed.')
    } finally {
      setIsBusy(false)
    }
  }

  if (isLoading) {
    return <div className={styles.panelCard}><p className={styles.panelStatusLine}>Loading GitHub Email Intake…</p></div>
  }
  if (config === null) {
    return (
      <div className={styles.panelCard}>
        <h3 className={styles.sectionTitle}>GitHub Email Intake</h3>
        <p className={styles.panelStatusLine}>{statusMessage || 'Configuration unavailable.'}</p>
      </div>
    )
  }

  return (
    <div className={styles.panelCard}>
      <h3 className={styles.sectionTitle}>📧 GitHub Email Intake</h3>
      <p className={styles.panelStatusLine}>
        Parses GitHub notification emails saved to a local folder and drives Jira comments/transitions — the
        GitHub integration without GitHub API access. Start in <strong>Dry run</strong>, confirm parsing with
        Preview, then advance to Comment only and Full.
      </p>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>
          <input type="checkbox" checked={config.isEnabled} disabled={isSaving} onChange={(event) => void handleToggleEnabled(event.target.checked)} />
          {' '}Enable scheduled intake
        </label>
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Rollout mode</label>
        <select className={styles.inputField} value={config.mode} onChange={(event) => updateConfig({ mode: event.target.value as IntakeMode })}>
          {(Object.keys(MODE_LABELS) as IntakeMode[]).map((mode) => (
            <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
          ))}
        </select>
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Drop folder (absolute path where GitHub emails are saved)</label>
        <input className={styles.inputField} value={config.dropFolder} placeholder="C:\Users\you\GitHubEmails" onChange={(event) => updateConfig({ dropFolder: event.target.value })} />
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>
          <input type="checkbox" checked={config.outlookExport.isEnabled} onChange={(event) => updateOutlookExport({ isEnabled: event.target.checked })} />
          {' '}Pull emails from Outlook automatically (this machine)
        </label>
        <p className={styles.panelStatusLine}>
          Before each run, Toolbox exports GitHub emails from an Outlook folder into the drop folder above —
          no separate script or Task Scheduler. Requires Outlook running on this machine. Set up an Outlook
          rule to file GitHub notifications into the source folder below.
        </p>
        <label className={styles.fieldLabel}>Outlook source folder (a rule files GitHub emails here)</label>
        <input className={styles.inputField} value={config.outlookExport.sourceFolder} placeholder="Inbox\GitHub Intake" onChange={(event) => updateOutlookExport({ sourceFolder: event.target.value })} />
        <label className={styles.fieldLabel}>Outlook processed folder (exported mail is moved here)</label>
        <input className={styles.inputField} value={config.outlookExport.processedFolder} placeholder="Inbox\GitHub Processed" onChange={(event) => updateOutlookExport({ processedFolder: event.target.value })} />
        <button className={styles.actionButton} disabled={isExporting || isDirty} title={isDirty ? 'Save first — the test uses the saved folders.' : ''} onClick={() => void handleTestExport()} type="button">
          {isExporting ? 'Exporting…' : 'Test Outlook export'}
        </button>
        {exportMessage ? <p className={styles.panelStatusLine}>{exportMessage}</p> : null}
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Schedule time (HH:MM, daily) — or set an interval below</label>
        <input className={styles.inputField} value={config.scheduleTime} placeholder="07:00" onChange={(event) => updateConfig({ scheduleTime: event.target.value })} />
        <label className={styles.fieldLabel}>Interval minutes (0 = use the daily schedule time)</label>
        <input className={styles.inputField} type="number" min={0} value={config.intervalMin} onChange={(event) => updateConfig({ intervalMin: Number(event.target.value) || 0 })} />
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>File extensions (comma-separated)</label>
        <input className={styles.inputField} value={config.fileExtensions.join(', ')} placeholder=".eml, .txt" onChange={(event) => updateConfig({ fileExtensions: splitList(event.target.value) })} />
        <label className={styles.fieldLabel}>Jira project keys to act on (comma-separated; blank = all)</label>
        <input className={styles.inputField} value={config.jiraProjectKeys.join(', ')} placeholder="DENP, ENFCT" onChange={(event) => updateConfig({ jiraProjectKeys: splitList(event.target.value) })} />
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Status transitions (leave blank to only comment). Match the Jira status name.</label>
        <input className={styles.inputField} value={config.transitions.branchCreated} placeholder="Branch created → status (e.g. In Progress)" onChange={(event) => updateTransition({ branchCreated: event.target.value })} />
        <input className={styles.inputField} value={config.transitions.commitPushed} placeholder="Commit pushed → status" onChange={(event) => updateTransition({ commitPushed: event.target.value })} />
        <input className={styles.inputField} value={config.transitions.prOpened} placeholder="PR opened → status (e.g. In Progress)" onChange={(event) => updateTransition({ prOpened: event.target.value })} />
        <input className={styles.inputField} value={config.transitions.prMerged} placeholder="PR merged → status (e.g. Ready for QA)" onChange={(event) => updateTransition({ prMerged: event.target.value })} />
      </div>

      <div className={styles.panelActions}>
        <button className={styles.saveButton} disabled={isSaving} onClick={() => void handleSave()} type="button">
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button className={styles.actionButton} disabled={isBusy} onClick={() => void handleAction('preview')} type="button">
          {isBusy ? 'Working…' : 'Preview (dry-run parse)'}
        </button>
        <button className={styles.actionButton} disabled={isBusy || isDirty} title={isDirty ? 'Save first — Run Now acts on the saved config.' : ''} onClick={() => void handleAction('run-now')} type="button">
          {isBusy ? 'Working…' : 'Run Now'}
        </button>
      </div>

      {statusMessage ? <p className={styles.panelStatusLine}>{statusMessage}</p> : null}

      {lastRun.hasRun ? (
        <div className={styles.panelSection}>
          <p className={styles.fieldLabel}>
            Last run ({lastRun.mode}, {lastRun.trigger}) — posted {lastRun.postedCount ?? 0}, skipped {lastRun.skippedCount ?? 0}, errors {lastRun.errorCount ?? 0}
          </p>
          {lastRun.folderError ? <p className={styles.panelStatusLine}>⚠ {lastRun.folderError}</p> : null}
          <ul>
            {(lastRun.events ?? []).slice(0, 25).map((event, index) => (
              <li key={event.fileName + '-' + index}>
                <strong>{event.fileName}</strong> — {event.outcome}
                {event.eventType ? ' · ' + event.eventType : ''}
                {event.jiraKey ? ' · ' + event.jiraKey : ''}
                {event.reason ? ' · ' + event.reason : ''}
                {event.message ? ' · ' + event.message : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
