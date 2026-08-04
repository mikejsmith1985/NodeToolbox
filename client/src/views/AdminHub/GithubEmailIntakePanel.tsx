// GithubEmailIntakePanel.tsx — Admin Hub panel for the GitHub Email Intake scheduler. Self-contained:
// manages its own state and talks to /api/github-email-intake/* directly. Lets an operator point the
// engine at a local drop folder, choose a safe rollout mode (dry-run → comment-only → full), map events
// to Jira transitions, and preview/run the parse. The server scheduler cannot read browser storage, so
// everything here is persisted server-side on Save.

import { useCallback, useEffect, useState } from 'react'

import { normalizeSharePointFolderInput, pullSharePointEmails } from '../../services/githubEmailSharePointPull.ts'
import { useAiAssistStore } from '../../store/aiAssistStore.ts'
import { buildRulePrompt, buildBulkRulePrompt, parseRuleReplyToList, type EmailSample } from '../GithubEmail/lib/githubRulePrompt.ts'
import { findEventTypeOverlaps, getDefaultSerializedRules, ruleSignature, type SerializedEmailRule } from '../GithubEmail/lib/githubEmailRules.ts'
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
  /** Server-relative URL of the SharePoint library folder the Power Automate flow drops emails into. */
  sharePointFolderUrl: string
  fileExtensions: string[]
  jiraProjectKeys: string[]
  transitions: IntakeTransitions
  customRules: SerializedEmailRule[]
  /** Custom field id of the parent Sub-status dropdown a rule's parent action writes to. */
  subStatusFieldId: string
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

/** The built-in comment a known event type posts, mirrored from the server's EVENT_COMMENT_TEMPLATES so the
 *  Rules panel can show (as a placeholder) exactly what Toolbox will say when a rule has no custom comment. */
const DEFAULT_EVENT_COMMENTS: Record<string, string> = {
  branch_created: '🔀 GitHub: branch created and work has started.',
  commit_pushed: '✅ GitHub: new commit pushed to feature branch.',
  pr_opened: '📬 GitHub: pull request opened for review.',
  pr_merged: '🎉 GitHub: pull request has been merged.',
  review_requested: '👀 GitHub: a review was requested.',
}

/** The default comment Toolbox posts for an event type — the template, or an emoji-led generic line
 *  for a custom bucket (mirrors the server's buildCommentText so the placeholder shows the truth). */
function defaultCommentFor(eventType: string): string {
  return DEFAULT_EVENT_COMMENTS[eventType] ?? ('🔔 GitHub: ' + eventType.replace(/_/g, ' ') + '.')
}

/** A short plain-English summary of what an email must look like for a rule to match, for the Rules panel. */
function describeMatcher(rule: SerializedEmailRule): string {
  const parts: string[] = []
  if (rule.reasonHeaderIn && rule.reasonHeaderIn.length > 0) parts.push('reason is ' + rule.reasonHeaderIn.join(' / '))
  if (rule.subjectPattern) parts.push('subject matches /' + rule.subjectPattern + '/')
  if (rule.bodyPattern) parts.push('body matches /' + rule.bodyPattern + '/')
  if (rule.requiresPrNumber) parts.push('and it has a PR number')
  return parts.length > 0 ? parts.join(', ') : 'any email'
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

/** Fetches the persistent run history (newest first). Returns [] on any failure. */
async function fetchRunLog(): Promise<IntakeRunResult[]> {
  try {
    const response = await fetch('/api/github-email-intake/run-log')
    if (!response.ok) return []
    const body = await response.json() as { runs?: IntakeRunResult[] }
    return Array.isArray(body.runs) ? body.runs : []
  } catch {
    return []
  }
}

/** Formats a run's ISO timestamp for the Activity Log; an unparseable value renders as-is. */
function formatRunTimestamp(ranAtIso: string | undefined): string {
  if (!ranAtIso) return 'unknown time'
  const parsedDate = new Date(ranAtIso)
  return Number.isNaN(parsedDate.getTime()) ? ranAtIso : parsedDate.toLocaleString()
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

/** Fetches the valid parent Sub-status dropdown options. Returns [] on any failure (free-text fallback). */
async function fetchSubStatusOptions(): Promise<string[]> {
  try {
    const response = await fetch('/api/github-email-intake/sub-status-options')
    if (!response.ok) return []
    const body = await response.json() as { options?: string[] }
    return Array.isArray(body.options) ? body.options : []
  } catch {
    return []
  }
}

async function postAction(pathSuffix: 'run-now' | 'preview'): Promise<{ ok: boolean; message?: string; result?: IntakeRunResult }> {
  const response = await fetch('/api/github-email-intake/' + pathSuffix, { method: 'POST' })
  return await response.json() as { ok: boolean; message?: string; result?: IntakeRunResult }
}

interface RuleSamplesResponse {
  ok: boolean
  message?: string
  samples: EmailSample[]
  totalCount: number
  unknownCount: number
  truncated: boolean
}

/** Reads the drop folder (server-side, read-only) and returns raw emails + their current classification. */
async function fetchRuleSamples(includeAll: boolean): Promise<RuleSamplesResponse> {
  const response = await fetch('/api/github-email-intake/rule-samples', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeAll }),
  })
  return await response.json() as RuleSamplesResponse
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
  // Persistent run history (newest first) + which row is expanded to its per-email details.
  const [runLog, setRunLog] = useState<IntakeRunResult[]>([])
  const [expandedRunIndex, setExpandedRunIndex] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([])
  const [subStatusOptions, setSubStatusOptions] = useState<string[]>([])
  // Rule Assist (AI): the generated prompt, the pasted JSON reply, and a validation message.
  const isAiUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked)
  const [rulePrompt, setRulePrompt] = useState('')
  const [ruleReply, setRuleReply] = useState('')
  const [ruleMessage, setRuleMessage] = useState('')
  // Bulk rule generation: whether to bundle every email or only the currently-unclassified ones.
  const [includeAllSamples, setIncludeAllSamples] = useState(false)
  const [isCollectingSamples, setIsCollectingSamples] = useState(false)
  // SharePoint source pull (macro-less pipeline): progress/summary message + in-flight flag.
  const [isPullingSharePoint, setIsPullingSharePoint] = useState(false)
  const [sharePointMessage, setSharePointMessage] = useState('')

  const loadEverything = useCallback(async () => {
    try {
      const [loadedConfig, loadedStatus, loadedStatuses, loadedSubStatusOptions, loadedRunLog] = await Promise.all([
        fetchConfig(), fetchStatus(), fetchJiraStatuses(), fetchSubStatusOptions(), fetchRunLog(),
      ])
      setRunLog(loadedRunLog)
      setJiraStatuses(loadedStatuses)
      setSubStatusOptions(loadedSubStatusOptions)
      // Normalize newer fields so an older server or a partial payload can't crash the render.
      setConfig({
        ...loadedConfig,
        customRules: loadedConfig.customRules ?? [],
        subStatusFieldId: loadedConfig.subStatusFieldId ?? 'customfield_10201',
        sharePointFolderUrl: loadedConfig.sharePointFolderUrl ?? '',
      })
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
    // SharePoint-only setup (no local drop folder): Run Now IS the SharePoint pull, and Preview's
    // job is served by Dry run mode — never a dead-end "no drop folder configured" error.
    const isSharePointOnly = config !== null
      && config.dropFolder.trim() === ''
      && config.sharePointFolderUrl.trim() !== ''
    if (isSharePointOnly) {
      if (pathSuffix === 'preview') {
        setStatusMessage('Preview reads the local drop folder. For the SharePoint source, set Rollout mode to Dry run and use Pull from SharePoint now — same safety, real files.')
        return
      }
      await handleSharePointPull()
      return
    }
    setIsBusy(true)
    setStatusMessage('')
    try {
      const outcome = await postAction(pathSuffix)
      if (outcome.ok && outcome.result) {
        setLastRun(outcome.result)
        setStatusMessage(pathSuffix === 'preview' ? 'Preview complete (nothing was posted or moved).' : 'Run complete.')
        // A real run lands in the persistent log — refresh it so the Activity Log shows it at once.
        if (pathSuffix === 'run-now') {
          setRunLog(await fetchRunLog())
        }
      } else {
        setStatusMessage(outcome.message || 'Action failed.')
      }
    } catch (actionError) {
      setStatusMessage(actionError instanceof Error ? actionError.message : 'Action failed.')
    } finally {
      setIsBusy(false)
    }
  }

  /**
   * Pulls new GitHub emails from the SharePoint library through the relay and ingests them via the
   * server pipeline. Saves the config first when dirty (the server labels the run with the SAVED
   * folder URL), then refreshes the last-run + Activity Log so the pull's runs appear immediately.
   */
  async function handleSharePointPull() {
    if (config === null) return
    // Accept a pasted share link or full URL: normalize it, show the clean path in the field, and
    // persist that — so the stored config (and the run's Activity Log label) is the real folder.
    const folderUrl = normalizeSharePointFolderInput(config.sharePointFolderUrl)
    if (folderUrl === '') return
    setIsPullingSharePoint(true)
    setSharePointMessage('')
    try {
      const nextConfig = { ...config, sharePointFolderUrl: folderUrl }
      if (isDirty || folderUrl !== config.sharePointFolderUrl) {
        setConfig(nextConfig)
        await persist(nextConfig, 'Saved.')
      }
      const summary = await pullSharePointEmails(folderUrl, (progressMessage) => setSharePointMessage(progressMessage))
      setSharePointMessage(summary.newCount === 0
        ? `All caught up — ${summary.listedCount} email file(s) in the folder, none new.`
        : `Pulled ${summary.newCount} new email(s) of ${summary.listedCount} in the folder — `
          + `${summary.postedCount} posted, ${summary.skippedCount} skipped, ${summary.errorCount} error(s).`)
      setLastRun(await fetchStatus())
      setRunLog(await fetchRunLog())
    } catch (pullError) {
      setSharePointMessage(pullError instanceof Error ? pullError.message : 'SharePoint pull failed.')
    } finally {
      setIsPullingSharePoint(false)
    }
  }

  function handleGenerateRulePrompt() {
    setRulePrompt(buildRulePrompt())
    setRuleMessage('Prompt generated — copy it, paste it plus a real email into your AI, then paste the JSON reply below.')
  }

  // Reads the drop folder (server-side) and builds ONE prompt covering every distinct email shape, so the
  // operator can generate a whole rule set with a single paste into their own AI. Nothing leaves the machine.
  async function handleGenerateBulkPrompt() {
    setIsCollectingSamples(true)
    setRuleMessage('')
    try {
      const response = await fetchRuleSamples(includeAllSamples)
      if (!response.ok) {
        setRuleMessage(response.message || 'Could not read the drop folder.')
        return
      }
      if (response.samples.length === 0) {
        const scope = includeAllSamples ? 'emails' : 'unclassified emails'
        const hint = response.totalCount === 0
          ? ' The drop folder and its _processed / _errors archives are empty — save a real GitHub email there first.'
          : ' Tick "Include already-classified emails" to bundle them anyway.'
        setRuleMessage(`No ${scope} found (${response.totalCount} email(s) scanned, ${response.unknownCount} unclassified).${hint}`)
        setRulePrompt('')
        return
      }
      const built = buildBulkRulePrompt(response.samples)
      setRulePrompt(built.prompt)
      const scope = includeAllSamples ? 'all emails' : 'unclassified emails'
      const omittedNote = built.omittedCount > 0 ? ` (${built.omittedCount} extra shape(s) omitted to keep the prompt pasteable)` : ''
      const truncatedNote = response.truncated ? ' The drop folder is large — only the first batch was read.' : ''
      setRuleMessage(
        `Bundled ${built.representativeCount} distinct email shape(s) from ${response.samples.length} ${scope}${omittedNote}.`
        + ` Copy the prompt into your AI, then paste the JSON rule set below.${truncatedNote}`,
      )
    } catch (sampleError) {
      setRuleMessage(sampleError instanceof Error ? sampleError.message : 'Could not read the drop folder.')
    } finally {
      setIsCollectingSamples(false)
    }
  }

  // Validates a pasted AI reply (single rule OR a bulk rule set) and, on success, adds every valid rule and saves.
  async function handleAddRulesFromReply() {
    if (config === null) return
    const outcome = parseRuleReplyToList(ruleReply)
    if (!outcome.ok || outcome.rules.length === 0) {
      setRuleMessage(outcome.error || 'Could not read a rule from the reply.')
      return
    }
    // Two-layer dedup. By SIGNATURE first: an incoming rule whose matcher already exists under a DIFFERENT id
    // is a content-duplicate — skip it (the existing rule already covers those emails) rather than clutter the
    // list. By ID second: an incoming rule that reuses an existing id REPLACES it, so re-pasting a refined rule
    // updates in place. Signatures accumulate as we accept, so duplicates WITHIN one reply are caught too.
    const signatureToId = new Map(config.customRules.map((rule) => [ruleSignature(rule), rule.id]))
    const accepted: SerializedEmailRule[] = []
    const skipped: string[] = []
    for (const incoming of outcome.rules) {
      const existingId = signatureToId.get(ruleSignature(incoming))
      if (existingId !== undefined && existingId !== incoming.id) {
        skipped.push(`"${incoming.id}" (same match as "${existingId}")`)
        continue
      }
      accepted.push(incoming)
      signatureToId.set(ruleSignature(incoming), incoming.id)
    }

    if (accepted.length === 0) {
      setRuleMessage(`No rules added — ${skipped.length === 1 ? 'it is a' : 'they are'} duplicate of an existing rule: ${skipped.join(', ')}.`)
      return
    }

    const acceptedIds = new Set(accepted.map((rule) => rule.id))
    const withoutDuplicates = config.customRules.filter((rule) => !acceptedIds.has(rule.id))
    const nextConfig = { ...config, customRules: [...withoutDuplicates, ...accepted] }
    setConfig(nextConfig)
    setRuleReply('')
    const rejectedNote = outcome.rejectedCount > 0 ? ` (${outcome.rejectedCount} rejected as invalid)` : ''
    const skippedNote = skipped.length > 0 ? ` (${skipped.length} skipped as duplicate)` : ''
    const summary = accepted.length === 1
      ? `rule "${accepted[0].id}" (${accepted[0].eventType})`
      : `${accepted.length} rules`
    setRuleMessage(`Added ${summary}${rejectedNote}${skippedNote}.`)
    await persist(nextConfig, `Saved ${summary}.`)
  }

  async function handleRemoveRule(ruleId: string) {
    if (config === null) return
    const nextConfig = { ...config, customRules: config.customRules.filter((rule) => rule.id !== ruleId) }
    setConfig(nextConfig)
    await persist(nextConfig, `Removed rule "${ruleId}".`)
  }

  /** Patches one rule (enable/disable, comment, transition) and marks the config dirty for the main Save. */
  function updateRule(ruleId: string, patch: Partial<SerializedEmailRule>) {
    if (config === null) return
    updateConfig({ customRules: config.customRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)) })
  }

  /** Seeds an editable copy of a built-in default rule (same id) so it can be tuned like any custom rule. */
  function handleCustomizeDefault(defaultRule: SerializedEmailRule) {
    if (config === null) return
    if (config.customRules.some((rule) => rule.id === defaultRule.id)) return
    updateConfig({ customRules: [...config.customRules, { ...defaultRule }] })
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

  // Built-in default rules the operator has not yet customized — shown read-only with a "Customize" action
  // that seeds an editable copy (same id, which supersedes the code default).
  const customizedRuleIds = new Set(config.customRules.map((rule) => rule.id))
  const uncustomizedDefaults = getDefaultSerializedRules().filter((rule) => !customizedRuleIds.has(rule.id))
  // Soft, advisory overlaps: event types more than one running rule produces (first match wins).
  const eventTypeOverlaps = findEventTypeOverlaps(config.customRules, getDefaultSerializedRules())

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
        <label className={styles.fieldLabel} htmlFor="github-email-sharepoint-folder">
          SharePoint folder (server-relative URL of the library folder your Power Automate flow saves emails to)
        </label>
        <input
          id="github-email-sharepoint-folder"
          className={styles.inputField}
          value={config.sharePointFolderUrl}
          placeholder="/sites/YourTeam/Shared Documents/GitHubEmails"
          onChange={(event) => updateConfig({ sharePointFolderUrl: event.target.value })}
        />
        <p className={styles.panelStatusLine}>
          The macro-less pipeline: a Power Automate flow saves each GitHub email (.eml/.txt) into this
          library folder, and a pull reads it through the <strong>SharePoint relay</strong> (open the site,
          click the relay bookmarklet). Files are never moved or deleted in SharePoint — already-ingested
          files are skipped, so have the flow clean up old files. Note: <strong>scheduled</strong> intake
          sweeps only a local drop folder — SharePoint pulls are always started from this button, since
          the relay needs your browser session.
        </p>
        <button
          type="button"
          className={styles.actionButton}
          disabled={isPullingSharePoint || config.sharePointFolderUrl.trim() === ''}
          onClick={() => void handleSharePointPull()}
        >
          {isPullingSharePoint ? 'Pulling…' : '📥 Pull from SharePoint now'}
        </button>
        {sharePointMessage !== '' && <p role="status" className={styles.panelStatusLine}>{sharePointMessage}</p>}
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Start time (HH:MM) — the earliest run each day; also the exact time when interval is 0</label>
        <input className={styles.inputField} value={config.scheduleTime} placeholder="07:00" onChange={(event) => updateConfig({ scheduleTime: event.target.value })} />
        <label className={styles.fieldLabel}>Interval minutes (30 = run on the clock at :00 and :30; 0 = once daily at the start time)</label>
        <input className={styles.inputField} type="number" min={0} value={config.intervalMin} onChange={(event) => updateConfig({ intervalMin: Number(event.target.value) || 0 })} />
        <p className={styles.panelStatusLine}>
          With an interval set, runs land on wall-clock boundaries at or after the start time — e.g. 30 minutes
          from a 07:00 start runs 07:00, 07:30, 08:00…
        </p>
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>File extensions (comma-separated)</label>
        <input className={styles.inputField} value={config.fileExtensions.join(', ')} placeholder=".eml, .txt" onChange={(event) => updateConfig({ fileExtensions: splitList(event.target.value) })} />
        <label className={styles.fieldLabel}>Jira project keys to act on (comma-separated; blank = all)</label>
        <input className={styles.inputField} value={config.jiraProjectKeys.join(', ')} placeholder="DENP, ENFCT" onChange={(event) => updateConfig({ jiraProjectKeys: splitList(event.target.value) })} />
        <p className={styles.panelStatusLine}>
          {config.jiraProjectKeys.length === 0
            ? '⚠ Blank means EVERY project — other teams working in the same repos will also get comments/transitions. Set your team\'s project keys to scope this to your work.'
            : `Only issues in ${config.jiraProjectKeys.map((key) => key.toUpperCase()).join(', ')} are acted on; keys from any other project (e.g. another team sharing the repo) are skipped as "project-filtered".`}
        </p>
      </div>

      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>
          Status transitions (leave blank to only comment).{' '}
          {jiraStatuses.length === 0
            ? 'Status list unavailable — type the exact Jira status name.'
            : 'Pick the target Jira status from the dropdown.'}
        </label>
        <p className={styles.panelStatusLine}>
          The comment is ALWAYS posted for a matched event — selecting a status here adds a transition on
          top of it (fired only after the comment succeeds); it never replaces the comment.
        </p>
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

      {isAiUnlocked ? (
        <div className={styles.panelSection}>
            <label className={styles.fieldLabel}>Rule Assist (AI) — classify a new kind of email into an event type</label>
            <p className={styles.panelStatusLine}>
              A rule only decides <strong>which event</strong> a new kind of email is (branch created, PR opened,
              PR merged, …) — its bucket. What then happens for that event — the Jira comment and the status
              transition — is set deterministically in <strong>Transitions</strong> above, never by the AI.
              Generate a prompt, paste it plus a real notification email into your own AI, then paste the JSON
              rule it returns. Custom rules are applied <strong>before</strong> the built-in classifiers. The
              emails never leave this machine — only you and your own AI ever see them.
            </p>
            <label className={styles.fieldLabel}>
              <input
                type="checkbox"
                checked={includeAllSamples}
                onChange={(event) => setIncludeAllSamples(event.target.checked)}
              />
              {' '}Include already-classified emails (default: only unclassified)
            </label>
            <div className={styles.panelActions}>
              <button className={styles.actionButton} disabled={isCollectingSamples} onClick={() => void handleGenerateBulkPrompt()} type="button">
                {isCollectingSamples ? 'Reading drop folder…' : 'Generate rule prompt from drop folder'}
              </button>
              <button className={styles.actionButton} onClick={handleGenerateRulePrompt} type="button">Generate prompt for one email</button>
            </div>
            {rulePrompt ? (
              <textarea className={styles.inputField} readOnly rows={6} value={rulePrompt} onFocus={(event) => event.currentTarget.select()} />
            ) : null}
            <label className={styles.fieldLabel}>Paste the AI&apos;s JSON rule reply (one rule or a whole rule set)</label>
            <textarea
              className={styles.inputField}
              rows={4}
              value={ruleReply}
              placeholder={'{"kind":"githubEmailRuleSet","rules":[ ... ]}'}
              onChange={(event) => setRuleReply(event.target.value)}
            />
            <button className={styles.actionButton} disabled={!ruleReply.trim()} onClick={() => void handleAddRulesFromReply()} type="button">
              Validate &amp; add rule(s)
            </button>
            {ruleMessage ? <p className={styles.panelStatusLine}>{ruleMessage}</p> : null}
        </div>
      ) : null}

      {/* Rules — always visible (managing existing rules is operator config, not an AI action). Shows exactly
          what Toolbox does per rule, and lets the operator turn it on/off, reword the comment, and force a
          status transition. Edits mark the config dirty; the main Save below persists them. */}
      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Rules — what Toolbox does when an email matches</label>
        {eventTypeOverlaps.length > 0 ? (
          <p className={styles.panelStatusLine}>
            ⚠ Heads up: {eventTypeOverlaps.map((overlap) => `${overlap.ruleCount} rules target ${overlap.eventType}`).join('; ')}.
            {' '}The first that matches wins; the others only apply when it doesn&apos;t. That is fine if intended
            (e.g. two ways to spot the same event) — just worth a look.
          </p>
        ) : null}
        {config.customRules.length === 0 ? (
          <p className={styles.panelStatusLine}>No rules configured yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
            {config.customRules.map((rule) => {
              const isRuleEnabled = rule.isEnabled !== false
              const defaultComment = defaultCommentFor(rule.eventType)
              const effectiveComment = (rule.comment && rule.comment.trim() !== '') ? rule.comment : defaultComment
              const statusOptions = jiraStatuses.includes(rule.transitionStatus ?? '') || (rule.transitionStatus ?? '') === ''
                ? jiraStatuses
                : [rule.transitionStatus as string, ...jiraStatuses]
              return (
                <li key={rule.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--spacing-sm)', opacity: isRuleEnabled ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label className={styles.fieldLabel} style={{ margin: 0 }}>
                      <input type="checkbox" aria-label={`Enable rule ${rule.id}`} checked={isRuleEnabled} onChange={(event) => updateRule(rule.id, { isEnabled: event.target.checked })} />
                      {' '}Enabled
                    </label>
                    <strong>{rule.id}</strong> → <code>{rule.eventType}</code>
                    <button className={styles.dangerButton} style={{ marginLeft: 'auto' }} onClick={() => void handleRemoveRule(rule.id)} type="button">Remove</button>
                  </div>
                  <p className={styles.panelStatusLine}>Matches: {describeMatcher(rule)}</p>

                  <label className={styles.fieldLabel}>Comment to post (blank = the default below)</label>
                  <input
                    className={styles.inputField}
                    aria-label={`Comment for rule ${rule.id}`}
                    value={rule.comment ?? ''}
                    placeholder={defaultComment}
                    onChange={(event) => updateRule(rule.id, { comment: event.target.value })}
                  />

                  <label className={styles.fieldLabel}>Force status transition (blank = comment only)</label>
                  {jiraStatuses.length === 0 ? (
                    <input
                      className={styles.inputField}
                      aria-label={`Transition status for rule ${rule.id}`}
                      value={rule.transitionStatus ?? ''}
                      placeholder="e.g. In Progress"
                      onChange={(event) => updateRule(rule.id, { transitionStatus: event.target.value })}
                    />
                  ) : (
                    <select
                      className={styles.inputField}
                      aria-label={`Transition status for rule ${rule.id}`}
                      value={rule.transitionStatus ?? ''}
                      onChange={(event) => updateRule(rule.id, { transitionStatus: event.target.value })}
                    >
                      <option value="">No transition — comment only</option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  )}

                  <label className={styles.fieldLabel}>Also move the PARENT story to (blank = leave the parent alone)</label>
                  {jiraStatuses.length === 0 ? (
                    <input
                      className={styles.inputField}
                      aria-label={`Parent story status for rule ${rule.id}`}
                      value={rule.parentTransitionStatus ?? ''}
                      placeholder="e.g. Ready for Testing"
                      onChange={(event) => updateRule(rule.id, { parentTransitionStatus: event.target.value })}
                    />
                  ) : (
                    <select
                      className={styles.inputField}
                      aria-label={`Parent story status for rule ${rule.id}`}
                      value={rule.parentTransitionStatus ?? ''}
                      onChange={(event) => updateRule(rule.id, { parentTransitionStatus: event.target.value })}
                    >
                      <option value="">Leave the parent story alone</option>
                      {(jiraStatuses.includes(rule.parentTransitionStatus ?? '') || (rule.parentTransitionStatus ?? '') === ''
                        ? jiraStatuses
                        : [rule.parentTransitionStatus as string, ...jiraStatuses]
                      ).map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  )}
                  {/* Always visible (not gated behind a parent-status pick) — hiding these made the
                      Sub-status control undiscoverable, and Sub-status is usable on its own. */}
                  <label className={styles.fieldLabel}>Set the parent&apos;s Sub-status to (blank = don&apos;t touch it)</label>
                  {subStatusOptions.length === 0 ? (
                    <input
                      className={styles.inputField}
                      aria-label={`Parent Sub-status for rule ${rule.id}`}
                      value={rule.parentSubStatusValue ?? ''}
                      placeholder="e.g. Dev Complete (options unavailable — typed value must match Jira exactly)"
                      onChange={(event) => updateRule(rule.id, { parentSubStatusValue: event.target.value })}
                    />
                  ) : (
                    <select
                      className={styles.inputField}
                      aria-label={`Parent Sub-status for rule ${rule.id}`}
                      value={rule.parentSubStatusValue ?? ''}
                      onChange={(event) => updateRule(rule.id, { parentSubStatusValue: event.target.value })}
                    >
                      <option value="">Don&apos;t change Sub-status</option>
                      {(subStatusOptions.includes(rule.parentSubStatusValue ?? '') || (rule.parentSubStatusValue ?? '') === ''
                        ? subStatusOptions
                        : [rule.parentSubStatusValue as string, ...subStatusOptions]
                      ).map((optionValue) => (
                        <option key={optionValue} value={optionValue}>{optionValue}</option>
                      ))}
                    </select>
                  )}
                  <label className={styles.fieldLabel}>
                    <input
                      type="checkbox"
                      aria-label={`Require all coding sub-tasks done for rule ${rule.id}`}
                      checked={rule.parentRequiresAllDevDone !== false}
                      onChange={(event) => updateRule(rule.id, { parentRequiresAllDevDone: event.target.checked ? undefined : false })}
                    />
                    {' '}Parent actions only when EVERY coding sub-task is Done (the [SL]/[INT]/[REL]/[PROD] scaffold never holds it)
                  </label>

                  <p className={styles.panelStatusLine}>
                    On a matching email → comments “{effectiveComment}”
                    {rule.transitionStatus && rule.transitionStatus.trim() !== '' ? ` and moves the issue to “${rule.transitionStatus}”.` : ' (no status change).'}
                    {(rule.parentTransitionStatus ?? '').trim() !== ''
                      ? ` Parent story → “${rule.parentTransitionStatus}”${rule.parentRequiresAllDevDone !== false ? ' once every coding sub-task is Done' : ' immediately'}.`
                      : ''}
                    {(rule.parentSubStatusValue ?? '').trim() !== '' ? ` Parent Sub-status → “${rule.parentSubStatusValue}”.` : ''}
                    {!isRuleEnabled ? ' — currently DISABLED.' : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
        {uncustomizedDefaults.length > 0 ? (
          <>
            <label className={styles.fieldLabel} style={{ marginTop: 'var(--spacing-sm)' }}>Built-in default rules</label>
            <p className={styles.panelStatusLine}>
              These ship with Toolbox and run automatically. Click <strong>Customize</strong> to make an editable
              copy you can turn off, reword, give a status transition, or give <strong>parent-story actions</strong>
              (move the parent / set its Sub-status) — e.g. Customize <strong>pr-merged</strong> to move a story to
              Ready for Testing when its branches merge.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
              {uncustomizedDefaults.map((rule) => (
                <li key={rule.id} style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--spacing-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{rule.id}</strong> → <code>{rule.eventType}</code>
                    <button className={styles.actionButton} style={{ marginLeft: 'auto' }} onClick={() => handleCustomizeDefault(rule)} type="button">Customize</button>
                  </div>
                  <p className={styles.panelStatusLine}>
                    Matches: {describeMatcher(rule)} → comments “{defaultCommentFor(rule.eventType)}”
                    {rule.eventType === 'pr_opened' || rule.eventType === 'pr_merged' || rule.eventType === 'branch_created' || rule.eventType === 'commit_pushed'
                      ? ' (transition set in the Status transitions section above).'
                      : ' (comment only).'}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className={styles.panelStatusLine}>
          Transitions only fire in <strong>Full</strong> mode; in Comment-only mode every rule posts its comment
          but no status changes. Edits here are saved with the <strong>Save</strong> button below.
        </p>
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

      {/* Persistent run history — proves whether scheduled runs actually fire (user report:
          90+ emails sat untouched with no way to tell) and records what each run did. */}
      <div className={styles.panelSection}>
        <h3 className={styles.sectionTitle}>Activity Log</h3>
        <p className={styles.panelStatusLine}>
          Every intake run recorded on this machine — scheduled or manual, including empty sweeps — newest first.
        </p>
        {runLog.length === 0 ? (
          <p className={styles.panelStatusLine}>
            No runs recorded yet. If the schedule should be firing, check that the intake is <strong>enabled</strong> above
            and that the Toolbox server has been running past the scheduled time.
          </p>
        ) : (
          <ul>
            {runLog.map((loggedRun, runIndex) => (
              <li key={(loggedRun.ranAtIso ?? 'run') + '-' + runIndex}>
                <strong>{formatRunTimestamp(loggedRun.ranAtIso)}</strong>
                {' · '}{loggedRun.trigger ?? 'unknown'} · {loggedRun.mode ?? 'unknown'} —{' '}
                {(loggedRun.postedCount ?? 0)} posted · {(loggedRun.skippedCount ?? 0)} skipped · {(loggedRun.errorCount ?? 0)} {(loggedRun.errorCount ?? 0) === 1 ? 'error' : 'errors'}
                {loggedRun.folderError ? ' · ⚠ ' + loggedRun.folderError : ''}
                {(loggedRun.events ?? []).length > 0 ? (
                  <button
                    className={styles.actionButton}
                    onClick={() => setExpandedRunIndex(expandedRunIndex === runIndex ? null : runIndex)}
                    type="button"
                  >
                    {expandedRunIndex === runIndex ? 'Hide details' : 'Details'}
                  </button>
                ) : null}
                {expandedRunIndex === runIndex ? (
                  <ul>
                    {(loggedRun.events ?? []).map((event, eventIndex) => (
                      <li key={event.fileName + '-' + eventIndex}>
                        <strong>{event.fileName}</strong> — {event.outcome}
                        {event.eventType ? ' · ' + event.eventType : ''}
                        {event.jiraKey ? ' · ' + event.jiraKey : ''}
                        {event.reason ? ' · ' + event.reason : ''}
                        {event.message ? ' · ' + event.message : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
