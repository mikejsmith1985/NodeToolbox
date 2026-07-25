// GithubEmailIntakePanel.tsx — Admin Hub panel for the GitHub Email Intake scheduler. Self-contained:
// manages its own state and talks to /api/github-email-intake/* directly. Lets an operator point the
// engine at a local drop folder, choose a safe rollout mode (dry-run → comment-only → full), map events
// to Jira transitions, and preview/run the parse. The server scheduler cannot read browser storage, so
// everything here is persisted server-side on Save.

import { useCallback, useEffect, useState } from 'react'

import { useAiAssistStore } from '../../store/aiAssistStore.ts'
import { buildRulePrompt, parseRuleReply } from '../GithubEmail/lib/githubRulePrompt.ts'
import type { SerializedEmailRule } from '../GithubEmail/lib/githubEmailRules.ts'
import styles from './AdminHubView.module.css'

// ── Types (mirror src/routes/githubEmailIntake.js) ──

type IntakeMode = 'dryRun' | 'commentOnly' | 'full'

interface IntakeTransitions {
  branchCreated: string
  commitPushed: string
  prOpened: string
  prMerged: string
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
  customRules: SerializedEmailRule[]
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

/** Fetches the Jira status names for the transition dropdowns. Returns [] on any failure. */
async function fetchJiraStatuses(): Promise<string[]> {
  try {
    const response = await fetch('/api/github-email-intake/jira-statuses')
    if (!response.ok) return []
    const body = await response.json() as { statuses?: string[] }
    return Array.isArray(body.statuses) ? body.statuses : []
  } catch {
    return []
  }
}

async function postAction(pathSuffix: 'run-now' | 'preview'): Promise<{ ok: boolean; message?: string; result?: IntakeRunResult }> {
  const response = await fetch('/api/github-email-intake/' + pathSuffix, { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; result?: IntakeRunResult }
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
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([])
  // Rule Assist (AI): the generated prompt, the pasted JSON reply, and a validation message.
  const isAiUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked)
  const [rulePrompt, setRulePrompt] = useState('')
  const [ruleReply, setRuleReply] = useState('')
  const [ruleMessage, setRuleMessage] = useState('')

  const loadEverything = useCallback(async () => {
    try {
      const [loadedConfig, loadedStatus, loadedStatuses] = await Promise.all([fetchConfig(), fetchStatus(), fetchJiraStatuses()])
      setJiraStatuses(loadedStatuses)
      // Normalize newer fields so an older server or a partial payload can't crash the render.
      setConfig({ ...loadedConfig, customRules: loadedConfig.customRules ?? [] })
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

  function handleGenerateRulePrompt() {
    setRulePrompt(buildRulePrompt())
    setRuleMessage('Prompt generated — copy it, paste it plus a real email into your AI, then paste the JSON reply below.')
  }

  // Validates a pasted AI reply and, on success, adds it to the custom rules and saves.
  async function handleAddRuleFromReply() {
    if (config === null) return
    const outcome = parseRuleReply(ruleReply)
    if (!outcome.ok || !outcome.rule) {
      setRuleMessage(outcome.error || 'Could not read a rule from the reply.')
      return
    }
    const acceptedRule = outcome.rule
    // Replace a rule with the same id, otherwise append — so re-pasting a refined rule updates in place.
    const withoutDuplicate = config.customRules.filter((rule) => rule.id !== acceptedRule.id)
    const nextConfig = { ...config, customRules: [...withoutDuplicate, acceptedRule] }
    setConfig(nextConfig)
    setRuleReply('')
    setRuleMessage(`Added rule "${acceptedRule.id}" (${acceptedRule.eventType}).`)
    await persist(nextConfig, `Saved rule "${acceptedRule.id}".`)
  }

  async function handleRemoveRule(ruleId: string) {
    if (config === null) return
    const nextConfig = { ...config, customRules: config.customRules.filter((rule) => rule.id !== ruleId) }
    setConfig(nextConfig)
    await persist(nextConfig, `Removed rule "${ruleId}".`)
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
        <select aria-label="Rollout mode" className={styles.inputField} value={config.mode} onChange={(event) => updateConfig({ mode: event.target.value as IntakeMode })}>
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
        <label className={styles.fieldLabel}>
          Status transitions (leave blank to only comment).{' '}
          {jiraStatuses.length === 0
            ? 'Status list unavailable — type the exact Jira status name.'
            : 'Pick the target Jira status from the dropdown.'}
        </label>
        {([
          ['branchCreated', 'Branch created → status'],
          ['commitPushed', 'Commit pushed → status'],
          ['prOpened', 'PR opened → status'],
          ['prMerged', 'PR merged → status'],
        ] as [keyof IntakeTransitions, string][]).map(([transitionKey, label]) => (
          jiraStatuses.length === 0 ? (
            <input
              key={transitionKey}
              className={styles.inputField}
              value={config.transitions[transitionKey]}
              placeholder={label}
              onChange={(event) => updateTransition({ [transitionKey]: event.target.value } as Partial<IntakeTransitions>)}
            />
          ) : (
            <select
              key={transitionKey}
              aria-label={label}
              className={styles.inputField}
              value={config.transitions[transitionKey]}
              onChange={(event) => updateTransition({ [transitionKey]: event.target.value } as Partial<IntakeTransitions>)}
            >
              <option value="">{label} — comment only</option>
              {(jiraStatuses.includes(config.transitions[transitionKey]) || config.transitions[transitionKey] === ''
                ? jiraStatuses
                : [config.transitions[transitionKey], ...jiraStatuses]
              ).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          )
        ))}
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Rule Assist (AI) — teach the parser a new event type, without sharing emails</label>
        {!isAiUnlocked ? (
          <p className={styles.panelStatusLine}>Unlock AI Assist (Ctrl+Alt+Z) to generate classification rules from an email.</p>
        ) : (
          <>
            <p className={styles.panelStatusLine}>
              Generate a prompt, paste it plus a real notification email into your own AI, then paste the JSON
              rule it returns. Custom rules are applied <strong>before</strong> the built-in classifiers.
            </p>
            <button className={styles.actionButton} onClick={handleGenerateRulePrompt} type="button">Generate rule prompt</button>
            {rulePrompt ? (
              <textarea className={styles.inputField} readOnly rows={6} value={rulePrompt} onFocus={(event) => event.currentTarget.select()} />
            ) : null}
            <label className={styles.fieldLabel}>Paste the AI&apos;s JSON rule reply</label>
            <textarea
              className={styles.inputField}
              rows={4}
              value={ruleReply}
              placeholder={'{"kind":"githubEmailRule","rule":{ ... }}'}
              onChange={(event) => setRuleReply(event.target.value)}
            />
            <button className={styles.actionButton} disabled={!ruleReply.trim()} onClick={() => void handleAddRuleFromReply()} type="button">
              Validate &amp; add rule
            </button>
            {ruleMessage ? <p className={styles.panelStatusLine}>{ruleMessage}</p> : null}
            {config.customRules.length > 0 ? (
              <ul>
                {config.customRules.map((rule) => (
                  <li key={rule.id}>
                    <strong>{rule.id}</strong> → {rule.eventType}{' '}
                    <button className={styles.actionButton} onClick={() => void handleRemoveRule(rule.id)} type="button">Remove</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
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
