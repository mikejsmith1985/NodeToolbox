// GithubEmailIntakePanel.tsx — Admin Hub panel for the GitHub Email Intake scheduler. Self-contained:
// manages its own state and talks to /api/github-email-intake/* directly. Lets an operator point the
// engine at a local drop folder, choose a safe rollout mode (dry-run → comment-only → full), map events
// to Jira transitions, and preview/run the parse. The server scheduler cannot read browser storage, so
// everything here is persisted server-side on Save.

import { useCallback, useEffect, useState } from 'react'

import { fetchGithubAutomationComments, type AutomationCommentRow } from '../../services/githubCommentAudit.ts'
import {
  filterMoveAuditRows,
  type LastStatusChange,
  type MoveAuditRow,
} from '../../services/automationMoveAudit.ts'
import {
  planAutomationMoveUndo,
  selectUndoableRows,
  undoAutomationMoves,
} from '../../services/automationMoveUndo'
import {
  fetchFeatureReviewTransitions,
  saveFeatureReviewTransition,
} from '../SprintDashboard/featureReviewFixes'
import { normalizeSharePointFolderInput, previewSharePointEmails, pullSharePointEmails } from '../../services/githubEmailSharePointPull.ts'
import { fetchJiraBaseUrl } from '../../services/proxyApi.ts'
import { buildJiraBrowseUrl } from '../../utils/jiraBrowseUrl.ts'
import { findEventTypeOverlaps, getDefaultSerializedRules, type SerializedEmailRule } from '../GithubEmail/lib/githubEmailRules.ts'
import { buildIntakeRunReport } from './intakeRunExport.ts'
import { formatSkippedEmailReport, summariseSkippedEmails, type SkippedEmailRecord } from '../GithubEmail/lib/skippedEmailReport.ts'
import { buildRuleExport, parseRuleExport, summariseRulesForReview } from './intakeRuleExport.ts'
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
  shouldClearSharePointAfterIngest: boolean
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
  /** Skipped emails kept for review, so a skip can be judged rather than merely counted. */
  skippedEmails?: SkippedEmailRecord[]
}

/** Line break for the copyable reports — named so a template literal never has to carry a raw one. */
const NEWLINE = String.fromCharCode(10)

/** What the read-only deployments probe reports back. */
interface DeploymentsProbeResult {
  ok: boolean
  httpStatus: number
  requestUrl: string
  authType: string
  errorBody: string
  deployments: Array<{ id: number; environment: string; ref: string; description: string; createdAt: string }>
}

/**
 * Renders the probe outcome as plain text.
 *
 * A failure prints the URL, status and body rather than an empty list — a 404 from a wrong Enterprise
 * base URL must never be readable as "this repo has no deployments".
 */
function buildDeploymentsProbeReport(outcome: DeploymentsProbeResult): string {
  // A 404 is far more often a misspelled repository than anything else — one transposed pair of
  // letters produced exactly this, and the name is only visible in the URL. So the hint that fires on
  // a 404 points at the name first.
  //
  // The old hint here claimed api.github.com was wrong for "Enterprise" orgs. That is only true of
  // self-hosted Enterprise SERVER; an Enterprise CLOUD org lives on github.com and api.github.com is
  // correct for it. The advice sent a reader hunting for a host that does not exist, which is worse
  // than saying nothing.
  const isProbableNameTypo = outcome.httpStatus === 404
  const headerLines = [
    `Result:  ${outcome.ok ? 'OK' : 'FAILED'}   HTTP ${outcome.httpStatus}`,
    `URL:     ${outcome.requestUrl}`,
    `Auth:    ${outcome.authType}`,
    isProbableNameTypo
      ? 'NOTE:    a 404 usually means the owner or repository name above is misspelt — check the URL'
        + ' letter by letter before assuming an access problem. If the name is right, it is scope:'
        + ' the token needs repo access to that repository (and SSO authorisation, on a SAML org).'
      : '',
  ].filter((line) => line !== '')
  if (!outcome.ok) {
    return [...headerLines, '', 'Error body:', outcome.errorBody || '(empty)'].join(NEWLINE)
  }
  return [
    ...headerLines,
    '',
    `Deployments returned (${outcome.deployments.length}):`,
    ...(outcome.deployments.length === 0
      ? ['  none — the call succeeded but this repo has no deployments']
      : outcome.deployments.map((deployment) =>
        `  ${deployment.environment || '(no env)'}  ref=${deployment.ref}  ${deployment.createdAt}${NEWLINE}      ${deployment.description}`)),
  ].join(NEWLINE)
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

/**
 * Says who moved an issue the automation did NOT move.
 *
 * "No status change near a comment" is the correct verdict and, on its own, a useless one: it left a
 * cancelled issue sitting under an automation heading with nothing to explain how it got there, and
 * an operator reasonably read it as an accusation (GH #375). Naming the person and the moment turns
 * the same row into a complete answer.
 *
 * When the history has no status change at all, that is stated rather than dressed up — an issue can
 * have been created in the status it sits in.
 */
function describeNonAutomationMove(lastStatusChange: LastStatusChange | null): string {
  if (lastStatusChange === null) {
    return ' · not the automation — and no status change on record at all'
  }

  const mover = lastStatusChange.byDisplayName ?? 'somebody Jira did not name'
  const movedAt = formatRunTimestamp(lastStatusChange.atIso)
  return ` · not the automation — ${mover} moved it `
    + `${lastStatusChange.fromStatus} → ${lastStatusChange.toStatus} at ${movedAt}`
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

/** Splits a comma-separated field into a trimmed string array, dropping blanks. */
function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter((part) => part !== '')
}

// ── Component ──

/** Admin Hub panel that configures, previews, and triggers the GitHub email intake engine. */
/**
 * End states that DISCARD work rather than complete it.
 *
 * Mirrors the server's refusal list (`jiraEventOutput.js`). The server will not INFER one of these
 * from a status category; a rule that names one explicitly is still obeyed, which is why naming one
 * has to be visible here.
 */
const DISCARD_STATUS_NAMES = [
  'cancelled', 'canceled', 'rejected', 'abandoned', 'withdrawn',
  "won't do", 'wont do', "won't fix", 'wont fix', 'duplicate',
];

/** Whether a configured status name throws the work away. */
function isDiscardStatusName(statusName: string | undefined): boolean {
  return DISCARD_STATUS_NAMES.includes((statusName ?? '').trim().toLowerCase());
}

export function GithubEmailIntakePanel() {
  const [config, setConfig] = useState<IntakeConfig | null>(null)
  // Raw text drafts for the comma-separated inputs. Rendering the parsed array back into the
  // input on every keystroke ate the comma the user just typed (splitList drops empty segments),
  // making it impossible to enter a second value — the draft string is the input's truth while
  // typing; the parsed list lives in config for save/preview.
  const [projectKeysText, setProjectKeysText] = useState('')
  const [fileExtensionsText, setFileExtensionsText] = useState('')
  const [lastRun, setLastRun] = useState<IntakeRunResult>({ hasRun: false })
  const [hasCopiedRun, setHasCopiedRun] = useState(false)
  const [copiedRuleFormat, setCopiedRuleFormat] = useState<'json' | 'summary' | null>(null)
  const [ruleImportText, setRuleImportText] = useState('')
  const [ruleTransferMessage, setRuleTransferMessage] = useState<string | null>(null)

  // How many events describe a move Jira did not make. Counted from the run rather than tracked
  // separately, so the banner and the exported report can never disagree about the number.
  const refusedMoveCount = (lastRun.events ?? [])
    .filter((event) => /did not move|refus|transition failed/i.test(event.message ?? '')).length

  /** The build the server reports, or null when it cannot be reached — never assumed. */
  async function readRunningVersion(): Promise<string | null> {
    try {
      const versionResponse = await fetch('/api/version-check')
      if (!versionResponse.ok) return null
      const versionPayload = await versionResponse.json() as { currentVersion?: string }
      return versionPayload.currentVersion ?? null
    } catch {
      return null
    }
  }

  /**
   * Copies the skipped-email report, drawn from the whole run log rather than the last run alone.
   *
   * A skip is rare within one run and repetitive across many, so a single run says almost nothing
   * while the log shows the shapes. This is what replaces asking somebody to open an email and read
   * it back — the question "does this kind of email ever name a Jira key?" is answered here.
   */
  async function handleCopySkippedReport(): Promise<void> {
    const skippedRecords = [lastRun, ...runLog].flatMap((oneRun) => oneRun.skippedEmails ?? [])
    await navigator.clipboard?.writeText(formatSkippedEmailReport(skippedRecords))
    setHasCopiedSkippedReport(true)
  }

  /** Copies the rule set as JSON — the shape `Import rules` reads back. */
  async function handleCopyRulesJson(): Promise<void> {
    // Config is null until the first load lands; an empty export is honest, a crash is not.
    await navigator.clipboard?.writeText(buildRuleExport(config?.customRules ?? [], await readRunningVersion(), getDefaultSerializedRules()))
    setCopiedRuleFormat('json')
  }

  /** Copies the rule set as prose — what each rule matches and what it does. */
  async function handleCopyRulesSummary(): Promise<void> {
    await navigator.clipboard?.writeText(summariseRulesForReview(config?.customRules ?? [], getDefaultSerializedRules()))
    setCopiedRuleFormat('summary')
  }

  /**
   * Replaces the rule set from a pasted export.
   *
   * Replaces rather than merges: an export is a whole set, and quietly merging two would produce a
   * third that neither machine has and nobody reviewed.
   */
  function handleImportRules(): void {
    const parsed = parseRuleExport(ruleImportText)
    if (!parsed.ok) {
      setRuleTransferMessage(parsed.message)
      return
    }
    updateConfig({ customRules: parsed.rules })
    setRuleImportText('')
    setRuleTransferMessage(`${parsed.message} Review them below, then Save to persist.`)
  }

  /** Copies the whole run — build, mode, per-file outcome, and every refused move — as plain text. */
  async function handleExportRun(): Promise<void> {
    const runningVersion = await readRunningVersion()
    await navigator.clipboard?.writeText(buildIntakeRunReport(lastRun, runningVersion))
    setHasCopiedRun(true)
  }
  // Persistent run history (newest first) + which row is expanded to its per-email details.
  const [runLog, setRunLog] = useState<IntakeRunResult[]>([])
  const [hasCopiedSkippedReport, setHasCopiedSkippedReport] = useState(false)
  const [expandedRunIndex, setExpandedRunIndex] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([])
  const [subStatusOptions, setSubStatusOptions] = useState<string[]>([])
  // Rule Assist (AI): the generated prompt, the pasted JSON reply, and a validation message.
  // Bulk rule generation: whether to bundle every email or only the currently-unclassified ones.
  // SharePoint source pull (macro-less pipeline): progress/summary message + in-flight flag.
  const [isPullingSharePoint, setIsPullingSharePoint] = useState(false)
  const [sharePointMessage, setSharePointMessage] = useState('')
  // Posted-comment audit: everything the automation has commented in Jira, for quality checking.
  const [isAuditing, setIsAuditing] = useState(false)
  const [auditLookbackDays, setAuditLookbackDays] = useState('30')
  const [auditRows, setAuditRows] = useState<AutomationCommentRow[]>([])
  const [auditSummary, setAuditSummary] = useState('')
  const [auditJiraBaseUrl, setAuditJiraBaseUrl] = useState('')
  const [moveRows, setMoveRows] = useState<MoveAuditRow[]>([])
  const [moveSearchText, setMoveSearchText] = useState('')
  const [isShowingMovedOnly, setIsShowingMovedOnly] = useState(false)
  const [hasCopiedMoveAudit, setHasCopiedMoveAudit] = useState(false)
  const [isUndoingMoves, setIsUndoingMoves] = useState(false)
  const [undoReport, setUndoReport] = useState<string[]>([])
  const [probeOwner, setProbeOwner] = useState('')
  const [probeRepository, setProbeRepository] = useState('')
  const [isProbingDeployments, setIsProbingDeployments] = useState(false)
  const [probeReport, setProbeReport] = useState('')

  /** Runs the read-only deployments check and renders whatever came back, success or failure. */
  async function handleDeploymentsProbe(): Promise<void> {
    setIsProbingDeployments(true)
    setProbeReport('')
    try {
      const response = await fetch('/api/github-email-intake/deployments-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: probeOwner, repository: probeRepository }),
      })
      const outcome = await response.json() as DeploymentsProbeResult
      setProbeReport(buildDeploymentsProbeReport(outcome))
    } catch (probeError) {
      setProbeReport(probeError instanceof Error ? probeError.message : 'The probe request failed.')
    } finally {
      setIsProbingDeployments(false)
    }
  }

  const visibleMoveRows = filterMoveAuditRows(moveRows, moveSearchText, isShowingMovedOnly)
  // Only the rows an undo would actually change. Offering to put back an issue somebody has
  // already moved on would override THEIR decision, which is this bug in the other direction.
  const undoableRowCount = selectUndoableRows(visibleMoveRows).length
  const movedIssueCount = moveRows.filter((moveRow) => moveRow.automationMoves.length > 0).length

  /**
   * Puts the automation's moves back, for the rows an undo would actually change.
   *
   * Scoped to what is ON SCREEN, like the copy button beside it: an operator who filtered to
   * "cancelled" and pressed undo means those, and a hidden row being moved would be the worst kind
   * of surprise. Every outcome is reported, because a run that says "12 restored" while four failed
   * silently is how somebody learns not to trust the button.
   */
  async function handleUndoAutomationMoves(): Promise<void> {
    const undoable = selectUndoableRows(visibleMoveRows)
    if (undoable.length === 0) {
      return
    }
    setIsUndoingMoves(true)
    setUndoReport([])
    try {
      const outcomes = await undoAutomationMoves(undoable.map((entry) => entry.row), {
        fetchTransitions: (issueKey) => fetchFeatureReviewTransitions(issueKey),
        applyTransition: (issueKey, transitionId) => saveFeatureReviewTransition(issueKey, transitionId),
      })
      setUndoReport(outcomes.map((outcome) => (outcome.didMove
        ? `${outcome.issueKey} → ${outcome.targetStatusName}`
        : `${outcome.issueKey} — ${outcome.reason}`)))
      const restoredCount = outcomes.filter((outcome) => outcome.didMove).length
      setMoveRows((rows) => rows.map((moveRow) => {
        const restored = outcomes.find((outcome) => outcome.issueKey === moveRow.issueKey && outcome.didMove)
        return restored ? { ...moveRow, currentStatus: restored.targetStatusName } : moveRow
      }))
      setStatusMessage(`Put back ${restoredCount} of ${outcomes.length}. Re-scan to confirm against Jira.`)
    } finally {
      setIsUndoingMoves(false)
    }
  }

  /** Copies exactly what is on screen — the filtered list, so a shared list matches what was seen. */
  async function handleCopyMoveAudit(): Promise<void> {
    const reportLines = [
      `Automation moves — ${visibleMoveRows.length} of ${moveRows.length} audited issue(s) shown`,
      moveSearchText.trim() ? `Search: "${moveSearchText.trim()}"` : '',
      isShowingMovedOnly ? 'Filtered to issues the automation moved' : '',
      '',
      ...visibleMoveRows.map((moveRow) => [
        `  ${moveRow.issueKey}  now=${moveRow.currentStatus}`,
        `      ${moveRow.issueSummary}`,
        moveRow.automationMoves.length === 0
          ? '      no status change within 3 minutes of an automation comment'
          : moveRow.automationMoves
            .map((move) => `      moved ${move.fromStatus} → ${move.toStatus} at ${move.atIso}`).join(NEWLINE),
      ].join(NEWLINE)),
    ].filter((line) => line !== '')
    await navigator.clipboard?.writeText(reportLines.join(NEWLINE))
    setHasCopiedMoveAudit(true)
  }

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
        // `!== false`, not `=== true`. Clearing now defaults ON, so an older server or a payload saved
        // before the field existed must arrive as ON — read as `=== true`, every such config came back
        // OFF, which is one of the reasons the library was never being cleared.
        shouldClearSharePointAfterIngest: loadedConfig.shouldClearSharePointAfterIngest !== false,
      })
      setProjectKeysText((loadedConfig.jiraProjectKeys ?? []).join(', '))
      setFileExtensionsText((loadedConfig.fileExtensions ?? []).join(', '))
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

  /**
   * Sweeps Jira for every comment carrying the automation's "GitHub: " signature so mistaken
   * posts can be spotted. Scoped to the configured project keys (blank = whole instance).
   */
  async function handleCommentAudit() {
    const parsedLookbackDays = Number.parseInt(auditLookbackDays, 10)
    const lookbackDays = Number.isFinite(parsedLookbackDays) && parsedLookbackDays > 0 ? parsedLookbackDays : 30
    setIsAuditing(true)
    setAuditSummary('')
    try {
      // The browse-link base URL is cosmetic — a failure must not block the audit itself.
      const loadedBaseUrl = await fetchJiraBaseUrl().catch(() => '')
      setAuditJiraBaseUrl(loadedBaseUrl)
      const auditResult = await fetchGithubAutomationComments(config?.jiraProjectKeys ?? [], lookbackDays)
      setAuditRows(auditResult.rows)
      // Defaulted, not assumed: an older server (or any partial payload) would otherwise blank the
      // whole panel rather than simply showing no move rows.
      setMoveRows(auditResult.moveRows ?? [])
      setAuditSummary(
        `${auditResult.rows.length} automation comment${auditResult.rows.length === 1 ? '' : 's'} ` +
        `across ${auditResult.scannedIssueCount} candidate issue(s) in the last ${lookbackDays} days.`,
      )
    } catch (auditError) {
      setAuditRows([])
      setMoveRows([])
      setAuditSummary(auditError instanceof Error ? auditError.message : 'Comment audit failed.')
    } finally {
      setIsAuditing(false)
    }
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
        await handleSharePointPreview()
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
      const summary = await pullSharePointEmails(
        folderUrl,
        (progressMessage) => setSharePointMessage(progressMessage),
        config.shouldClearSharePointAfterIngest,
      )
      // Skipped binaries are named, never hidden — a folder full of .msg exports must not read as
      // "all caught up" (GH #282): the fix is the flow's "Export email" action saving .eml files.
      const unsupportedNote = summary.unsupportedCount > 0
        ? ` ⚠ ${summary.unsupportedCount} file(s) skipped — unsupported binary type (e.g. .msg): set the Power Automate flow to use "Export email" and save the output as .eml.`
        : ''
      // Clearing files is destructive, so it is stated in the outcome rather than happening quietly.
      const clearedNote = summary.deletedCount > 0 || summary.keptCount > 0
        ? ` Cleared ${summary.deletedCount} from the library${summary.keptCount > 0
          ? `; ${summary.keptCount} left in place because the server did not confirm them.`
          : '.'}`
        : ''
      const outcomeMessage = (summary.newCount === 0
        ? `All caught up — ${summary.listedCount} email file(s) in the folder, none new. (Sweep recorded in the Activity Log.)`
        : `Pulled ${summary.newCount} new email(s) of ${summary.listedCount} in the folder — `
          + `${summary.postedCount} posted, ${summary.skippedCount} skipped, ${summary.errorCount} error(s).`)
        + unsupportedNote + clearedNote
      // The outcome must be visible at the action buttons too (GH #282: "Run Now doesn't seem to
      // do anything" — the message only rendered in the SharePoint section mid-page).
      setSharePointMessage(outcomeMessage)
      setStatusMessage(outcomeMessage)
      setLastRun(await fetchStatus())
      setRunLog(await fetchRunLog())
    } catch (pullError) {
      const errorMessage = pullError instanceof Error ? pullError.message : 'SharePoint pull failed.'
      setSharePointMessage(errorMessage)
      setStatusMessage(errorMessage)
    } finally {
      setIsPullingSharePoint(false)
    }
  }

  /**
   * Previews the SharePoint source: downloads the new files like a pull, but dry-run parses them
   * through the persist-nothing endpoint — no Jira writes, no ledgers, no Activity Log — and shows
   * the parsed events in the Last run section, exactly like the drop-folder Preview.
   */
  async function handleSharePointPreview() {
    if (config === null) return
    const folderUrl = normalizeSharePointFolderInput(config.sharePointFolderUrl)
    if (folderUrl === '') return
    setIsPullingSharePoint(true)
    setSharePointMessage('')
    setStatusMessage('')
    try {
      const preview = await previewSharePointEmails(folderUrl, (progressMessage) => setSharePointMessage(progressMessage))
      const previewUnsupportedNote = preview.unsupportedCount > 0
        ? ` ⚠ ${preview.unsupportedCount} file(s) skipped — unsupported binary type (e.g. .msg): set the Power Automate flow to use "Export email" and save the output as .eml.`
        : ''
      if (preview.result === null) {
        setSharePointMessage('')
        setStatusMessage(`Nothing new to preview — all ${preview.listedCount} email file(s) in the folder are already ingested.${previewUnsupportedNote}`)
        return
      }
      setLastRun(preview.result)
      setSharePointMessage('')
      setStatusMessage(`Preview complete — parsed ${preview.newCount} new email(s); nothing was posted and the files still ingest on the next pull.${previewUnsupportedNote}`)
    } catch (previewError) {
      setSharePointMessage(previewError instanceof Error ? previewError.message : 'SharePoint preview failed.')
    } finally {
      setIsPullingSharePoint(false)
    }
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
          The macro-less pipeline: a Power Automate flow saves each GitHub email into this library folder
          (use the flow&apos;s <strong>&quot;Export email&quot;</strong> action and save as <strong>.eml</strong> —
          .msg and other binaries cannot be read), and a pull reads it through the
          <strong> SharePoint relay</strong> (open the site, click the relay bookmarklet). Every non-binary
          file is read regardless of extension, so subject-named files work. Already-ingested files are
          always skipped, whether or not the library is cleared.
          Note: with no local drop folder, the configured schedule (start time + interval below) runs the
          SharePoint pull <strong>while Toolbox is open in your browser</strong> and the relay is connected —
          the server alone cannot reach SharePoint. A closed Toolbox tab or disconnected relay simply skips
          that slot; every run that does happen (including empty sweeps) lands in the Activity Log.
        </p>
        <label className={styles.flagRow}>
          <input
            checked={config.shouldClearSharePointAfterIngest}
            onChange={(event) => updateConfig({ shouldClearSharePointAfterIngest: event.target.checked })}
            type="checkbox"
          />
          <span className={styles.fieldLabel}>
            Clear each email from the library once it has been ingested
          </span>
        </label>
        <p className={styles.panelStatusLine}>
          Off by default, because it removes files from SharePoint. An email is only cleared after the
          server confirms it recorded it — anything that failed to parse is deliberately left behind for
          you to look at. Files go to the site&apos;s <strong>recycle bin</strong> rather than being
          destroyed. Leave this off if a Power Automate flow already empties the folder; with both
          running, whichever gets there first simply wins.
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
        <label className={styles.fieldLabel} htmlFor="github-email-file-extensions">File extensions (comma-separated)</label>
        <input
          className={styles.inputField}
          id="github-email-file-extensions"
          placeholder="e.g. .eml, .txt"
          value={fileExtensionsText}
          onChange={(event) => {
            setFileExtensionsText(event.target.value)
            updateConfig({ fileExtensions: splitList(event.target.value) })
          }}
        />
        <label className={styles.fieldLabel} htmlFor="github-email-project-keys">Jira project keys to act on (comma-separated; blank = all)</label>
        <input
          className={styles.inputField}
          id="github-email-project-keys"
          placeholder="e.g. DENP, ENFCT — this is only an example, blank acts on EVERY project"
          value={projectKeysText}
          onChange={(event) => {
            setProjectKeysText(event.target.value)
            updateConfig({ jiraProjectKeys: splitList(event.target.value) })
          }}
        />
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

      {/* Rules — always visible (managing existing rules is operator config, not an AI action). Shows exactly
          what Toolbox does per rule, and lets the operator turn it on/off, reword the comment, and force a
          status transition. Edits mark the config dirty; the main Save below persists them. */}
      <div className={styles.panelSection}>
        <label className={styles.fieldLabel}>Rules — what Toolbox does when an email matches</label>
        {/* Export/import exists because a rule set is the thing people need to compare and reproduce,
            and until now the only way to share one was a screenshot per rule. */}
        <div className={styles.panelActions}>
          <button className={styles.actionButton} onClick={() => void handleCopyRulesJson()} type="button">
            📋 {copiedRuleFormat === 'json' ? 'Copied' : 'Copy rules (JSON)'}
          </button>
          <button className={styles.actionButton} onClick={() => void handleCopyRulesSummary()} type="button">
            📋 {copiedRuleFormat === 'summary' ? 'Copied' : 'Copy rules (readable)'}
          </button>
        </div>
        <label className={styles.fieldLabel}>Paste a rule export to import</label>
        <textarea
          className={styles.inputField}
          rows={3}
          value={ruleImportText}
          placeholder={'{"kind":"githubEmailRuleExport","rules":[ ... ]}'}
          onChange={(event) => setRuleImportText(event.target.value)}
        />
        <div className={styles.panelActions}>
          <button
            className={styles.actionButton}
            disabled={!ruleImportText.trim()}
            onClick={handleImportRules}
            type="button"
          >
            Import rules
          </button>
        </div>
        {ruleTransferMessage ? <p className={styles.panelStatusLine}>{ruleTransferMessage}</p> : null}
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

                  {/* GH #375: automation moved live development work to Cancelled. The rule summary
                      announced it in the same quiet grey as every other setting, so the one option
                      that throws work away read exactly like the one that adds a comment. */}
                  {(isDiscardStatusName(rule.transitionStatus) || isDiscardStatusName(rule.parentTransitionStatus)) && (
                    <p className={styles.panelStatusLine} role="status">
                      ⚠️ <strong>This rule discards the work.</strong>{' '}
                      {isDiscardStatusName(rule.transitionStatus)
                        ? `Every matching email moves its issue to “${rule.transitionStatus}”. `
                        : ''}
                      {isDiscardStatusName(rule.parentTransitionStatus)
                        ? `Every match moves the PARENT story to “${rule.parentTransitionStatus}”. `
                        : ''}
                      That is an end state nobody works out of — set it only if a matching email really
                      means the work is abandoned.
                    </p>
                  )}
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
              (move the parent / set its Sub-status). For deployments, customise the rule for the ENVIRONMENT —
              <strong>pr-merged-int</strong> or <strong>pr-merged-prd</strong> — not the generic{' '}
              <strong>pr-merged</strong>, which now only catches merges into ordinary feature branches. Each
              environment rule fires on its own branch, so a merge into <code>prd</code> can move a story
              somewhere a merge into <code>dev</code> does not.
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
        <button className={styles.actionButton} disabled={isBusy || isPullingSharePoint} onClick={() => void handleAction('preview')} type="button">
          {isBusy || isPullingSharePoint ? 'Working…' : 'Preview (dry-run parse)'}
        </button>
        <button className={styles.actionButton} disabled={isBusy || isPullingSharePoint || isDirty} title={isDirty ? 'Save first — Run Now acts on the saved config.' : ''} onClick={() => void handleAction('run-now')} type="button">
          {isBusy || isPullingSharePoint ? 'Working…' : 'Run Now'}
        </button>
      </div>

      {statusMessage ? <p className={styles.panelStatusLine}>{statusMessage}</p> : null}

      {lastRun.hasRun ? (
        <div className={styles.panelSection}>
          <p className={styles.fieldLabel}>
            Last run ({lastRun.mode}, {lastRun.trigger}) — posted {lastRun.postedCount ?? 0}, skipped {lastRun.skippedCount ?? 0}, errors {lastRun.errorCount ?? 0}
          </p>
          {lastRun.folderError ? <p className={styles.panelStatusLine}>⚠ {lastRun.folderError}</p> : null}
          {/* Moves Jira REFUSED get their own line. Everywhere else a refusal reads as "nothing
              happened", which is the worst presentation a safety guard can have — an ambiguous
              "Done" that could have meant Cancelled looks identical to a rule that did nothing. */}
          {refusedMoveCount > 0 ? (
            <p className={styles.panelStatusLine}>
              ⚠ {refusedMoveCount} issue(s) were NOT moved — Jira refused or the move failed. See the
              lines below, or export the run for the full reason.
            </p>
          ) : null}
          <div className={styles.panelActions}>
            <button className={styles.actionButton} onClick={() => void handleExportRun()} type="button">
              📋 {hasCopiedRun ? 'Copied' : 'Copy run details'}
            </button>
          </div>
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
      {/* Skipped-email review. A one-word reason says an email was passed over; only these shapes say
          whether it SHOULD have been — and until now the only way to check was to open one by hand. */}
      <SkippedEmailReviewSection
        runs={[lastRun, ...runLog]}
        hasCopied={hasCopiedSkippedReport}
        onCopy={() => void handleCopySkippedReport()}
      />

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

      {/* Deployments probe — a read-only check of whether GitHub's Deployments API can be read from
          this machine. The whole email pipeline exists because that has failed here before; the
          connection dot only proves GET /user works, which says nothing about reading a repo. */}
      <div className={styles.panelSection}>
        <h3 className={styles.sectionTitle}>GitHub Deployments — access check</h3>
        <p className={styles.panelStatusLine}>
          Read-only. Asks GitHub for a repo&apos;s five most recent deployments and reports exactly what
          came back — status, URL, auth method, and the error body if it failed. A deployment names the
          environment (dev / int / rel), which is the only reliable signal for SL / INT / BT testing.
        </p>
        <label className={styles.fieldLabel} htmlFor="deployments-probe-owner">Owner (org)</label>
        <input
          className={styles.inputField}
          id="deployments-probe-owner"
          placeholder="your-github-org"
          value={probeOwner}
          onChange={(changeEvent) => setProbeOwner(changeEvent.target.value)}
        />
        <label className={styles.fieldLabel} htmlFor="deployments-probe-repo">Repository</label>
        <input
          className={styles.inputField}
          id="deployments-probe-repo"
          placeholder="your-repository"
          value={probeRepository}
          onChange={(changeEvent) => setProbeRepository(changeEvent.target.value)}
        />
        <div className={styles.panelActions}>
          {/* Deliberately NOT disabled on empty fields. It was, to save a wasted round trip, and that
              cost two rounds of "the button is locked and I cannot tell why" — a far worse trade than
              the click it saved. The server answers an empty submit with a plain sentence saying what
              is missing, which explains itself without anyone having to hover a dead control. */}
          <button
            className={styles.actionButton}
            disabled={isProbingDeployments}
            type="button"
            onClick={() => { void handleDeploymentsProbe() }}
          >
            {isProbingDeployments ? 'Checking…' : '🔎 Test deployments access'}
          </button>

          {probeReport ? (
            <button className={styles.actionButton} onClick={() => void navigator.clipboard?.writeText(probeReport)} type="button">
              📋 Copy result
            </button>
          ) : null}
        </div>
        {probeReport ? <pre className={styles.diagnosticsReport}>{probeReport}</pre> : null}
      </div>

      {/* Posted-comment audit — finds every Jira comment carrying the automation's signature so
          mistaken posts can be quality-checked (user report: a comment landed on the wrong issue). */}
      <div className={styles.panelSection}>
        <h3 className={styles.sectionTitle}>Posted-comment audit</h3>
        <p className={styles.panelStatusLine}>
          Sweeps Jira for comments the automation posted (its <strong>emoji + "GitHub:"</strong> signature),
          scoped to the configured project keys, so you can quality-check where it commented.
        </p>
        <label className={styles.fieldLabel} htmlFor="github-comment-audit-lookback">Lookback (days)</label>
        <input
          className={styles.inputField}
          id="github-comment-audit-lookback"
          inputMode="numeric"
          value={auditLookbackDays}
          onChange={(changeEvent) => setAuditLookbackDays(changeEvent.target.value)}
        />
        <button
          className={styles.actionButton}
          disabled={isAuditing}
          type="button"
          onClick={() => { void handleCommentAudit() }}
        >
          {isAuditing ? 'Scanning…' : '🔎 Scan Jira for automation comments'}
        </button>
        {auditSummary ? <p className={styles.panelStatusLine}>{auditSummary}</p> : null}

        {/* What the automation MOVED, not just where it commented. The comment sweep alone could
            never answer "did our automation cancel this?" — it proves the automation was there and
            says nothing about status. A status change within three minutes of its own comment is
            attributed to the same run, because a person does not also leave a signed comment. */}
        {moveRows.length > 0 ? (
          <div className={styles.panelSection}>
            {/* Not "what the automation moved": the list holds every audited issue, and most of
                them the automation did NOT move. A heading that claims otherwise turns an
                exonerated row into an accusation nobody can answer (GH #375). */}
            <label className={styles.fieldLabel}>Automation move audit</label>
            <p className={styles.panelStatusLine}>
              Every issue the automation commented on, whether or not it moved it.{' '}
              <strong>{movedIssueCount} of {moveRows.length}</strong> had a status change within three
              minutes of an automation comment; the rest were moved by somebody else, and each says
              who. Search a key, a summary, or a status — typing
              <strong> cancelled</strong> answers the question this exists for.
            </p>
            <input
              aria-label="Search audited issues"
              className={styles.inputField}
              placeholder="Search key, summary, or status…"
              value={moveSearchText}
              onChange={(changeEvent) => setMoveSearchText(changeEvent.target.value)}
            />
            <label className={styles.fieldLabel}>
              <input
                type="checkbox"
                checked={isShowingMovedOnly}
                onChange={(changeEvent) => setIsShowingMovedOnly(changeEvent.target.checked)}
              />
              {' '}Only issues the automation moved
            </label>
            <div className={styles.panelActions}>
              <button className={styles.actionButton} onClick={() => void handleCopyMoveAudit()} type="button">
                📋 {hasCopiedMoveAudit ? 'Copied' : 'Copy this list'}
              </button>
              {/* Scoped to what is ON SCREEN, like the copy button beside it. An operator who
                  filtered to "cancelled" and pressed this means those, and moving a hidden row
                  would be the worst kind of surprise. */}
              {undoableRowCount > 0 ? (
                <button
                  className={styles.actionButton}
                  disabled={isUndoingMoves}
                  onClick={() => void handleUndoAutomationMoves()}
                  type="button"
                >
                  {isUndoingMoves ? 'Putting back…' : `↩ Put ${undoableRowCount} back`}
                </button>
              ) : null}
            </div>

            {undoReport.length > 0 ? (
              <ul className={styles.panelStatusLine}>
                {undoReport.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
            <ul>
              {visibleMoveRows.map((moveRow) => (
                <li key={moveRow.issueKey}>
                  <a href={buildJiraBrowseUrl(moveRow.issueKey, auditJiraBaseUrl)} rel="noreferrer" target="_blank">
                    {moveRow.issueKey}
                  </a>
                  {' · now '}<strong>{moveRow.currentStatus}</strong>
                  {/* An exonerated row says WHO did it. "No status change near a comment" is the
                      right verdict and a useless one on its own: it left a cancelled issue sitting
                      under an automation heading with nothing to explain how it got there. */}
                  {moveRow.automationMoves.length === 0
                    ? describeNonAutomationMove(moveRow.lastStatusChange)
                    : ' · ' + moveRow.automationMoves
                      .map((move) => `${move.fromStatus} → ${move.toStatus}`).join(', ')}
                  {moveRow.issueSummary ? <em>{' (' + moveRow.issueSummary + ')'}</em> : null}
                  {/* Said per row, because "Put 9 back" does not tell anybody which nine, nor why
                      the tenth is not among them. */}
                  {moveRow.automationMoves.length > 0 ? (
                    <span className={styles.panelStatusLine}>
                      {planAutomationMoveUndo(moveRow).canUndo
                        ? ` ↩ can go back to ${planAutomationMoveUndo(moveRow).targetStatusName}`
                        : ` · ${planAutomationMoveUndo(moveRow).reason}`}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {visibleMoveRows.length === 0 ? (
              <p className={styles.panelStatusLine}>Nothing matches that search.</p>
            ) : null}
          </div>
        ) : null}

        {auditRows.length > 0 ? (
          <ul>
            {auditRows.map((auditRow, rowIndex) => (
              <li key={auditRow.issueKey + '-' + auditRow.createdIso + '-' + rowIndex}>
                <a href={buildJiraBrowseUrl(auditRow.issueKey, auditJiraBaseUrl)} rel="noreferrer" target="_blank">
                  {auditRow.issueKey}
                </a>
                {' · '}{formatRunTimestamp(auditRow.createdIso)}
                {auditRow.authorDisplayName ? ' · ' + auditRow.authorDisplayName : ''}
                {' — '}{auditRow.commentBody}
                {auditRow.issueSummary ? <em>{' (' + auditRow.issueSummary + ')'}</em> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The shapes of email the intake passed over, commonest first.
 *
 * Grouped rather than listed: emails of one kind arrive in bulk, so two hundred rows would bury the
 * conclusion they exist to show. The "ever carries" line is the load-bearing one — it answers, from
 * real traffic rather than from one sample somebody happened to open, whether a kind of email can
 * identify the work at all.
 */
function SkippedEmailReviewSection({ runs, hasCopied, onCopy }: {
  runs: IntakeRunResult[]
  hasCopied: boolean
  onCopy: () => void
}) {
  const skippedRecords = runs.flatMap((oneRun) => oneRun.skippedEmails ?? [])
  const shapes = summariseSkippedEmails(skippedRecords)

  return (
    <div className={styles.panelSection}>
      <h3 className={styles.sectionTitle}>Skipped emails — review</h3>
      <p className={styles.panelStatusLine}>
        Every email the intake passed over, grouped by shape. Use this to confirm a skip was right, and to
        see whether a kind of email ever carries a Jira key or a branch.
      </p>
      {shapes.length === 0 ? (
        <p className={styles.panelStatusLine}>
          Nothing recorded yet. Skipped emails are captured from the next run onward — older runs pre-date
          this record and cannot be recovered.
        </p>
      ) : (
        <>
          <ul>
            {shapes.map((shape, shapeIndex) => (
              <li key={shape.reason + shapeIndex}>
                <strong>{shape.emailCount}</strong> skipped as <code>{shape.reason}</code>
                {' · '}{shape.eventType}
                {shape.matchedRuleId ? ' (' + shape.matchedRuleId + ')' : ' (no rule matched)'}
                <p className={styles.panelStatusLine}>
                  Ever carries:{' '}
                  {[
                    shape.hasEverCarriedJiraKey ? 'Jira key' : '',
                    shape.hasEverCarriedBranch ? 'branch' : '',
                    shape.hasEverCarriedPrNumber ? 'PR number' : '',
                  ].filter(Boolean).join(', ') || 'NOTHING that identifies an issue'}
                </p>
                <p className={styles.panelStatusLine}>
                  e.g. <em>{shape.exampleRecord.subject}</em> — {shape.exampleRecord.bodyExcerpt.slice(0, 160)}
                </p>
              </li>
            ))}
          </ul>
          <button className={styles.actionButton} onClick={onCopy} type="button">
            {hasCopied ? '✓ Copied' : 'Copy skipped-email report'}
          </button>
        </>
      )}
    </div>
  )
}

