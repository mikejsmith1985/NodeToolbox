// AdminHubView.tsx — Tabbed administration centre for configuration, controls, and embedded diagnostics.
//
// The Config tab keeps the existing proxy, ART, access-control, hygiene, update, and backup sections.
// The Dev Panel tab embeds the live API diagnostics view so leadership and support workflows stay in one hub.

import { useEffect, useRef, useState, useCallback, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'

import { BookmarkletInstallLink } from '../../components/BookmarkletInstallLink/index.tsx'
import ConfirmDialog from '../../components/ConfirmDialog/index.tsx'
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx'
import ViewFrame from '../../components/ViewFrame/ViewFrame.tsx'
import { SNOW_RELAY_BOOKMARKLET_CODE } from '../../services/browserRelay.ts'
import { listGitHubAppInstallations, type GitHubAppInstallation } from '../../services/connectivityConfigApi.ts'
import { fetchSchedulerValidation, type SchedulerValidationRepoResult } from '../../services/schedulerApi.ts'
import { useConnectionStore } from '../../store/connectionStore'
import { useAiAssist } from '../SnowHub/hooks/useAiAssist.ts'
import DevPanelView from '../DevPanel/DevPanelView.tsx'
import { HygieneMonitorPanel } from './HygieneMonitorPanel.tsx'
import { RepoMonitorPanel } from './RepoMonitorPanel.tsx'
import { AiAssistAutomationPanel } from './AiAssistAutomationPanel.tsx'
import { SprintReleasePanel } from './SprintReleasePanel.tsx'
import { StandupBriefingPanel } from './StandupBriefingPanel.tsx'
import { PiReviewSchedulerPanel } from './PiReviewSchedulerPanel.tsx'
import { MonthlyDeliveryPanel } from './MonthlyDeliveryPanel.tsx'
import { useAdminHubState } from './hooks/useAdminHubState.ts'
import type {
  AdminHubActions,
  AdminHubState,
  ArtSettingsConfig,
  DeliveryOutcome,
  DiagnosticsResult,
  FeatureChangeArtRollupConfig,
  FeatureChangeReportConfig,
  HygieneRules,
  NotificationTeamConfig,
  NotificationArtRollupConfig,
  UpdateCheckResult,
  ReleaseSummary,
} from './hooks/useAdminHubState.ts'

/**
 * Formats a report's last delivery outcome into a short status line. Always returns a
 * string — when the report has not run since this version was installed it reads
 * "not yet recorded" so the row visibly shows the feature is wired up, rather than
 * rendering nothing at all.
 */
function formatLastDelivery(outcome?: DeliveryOutcome): string {
  if (!outcome) return 'Last run: not yet recorded'
  const when = new Date(outcome.ranAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  if (outcome.status === 'delivered') return `✓ Last run delivered · ${when}`
  if (outcome.status === 'skipped') return `ℹ Last run skipped (no changes) · ${when}`
  return `❌ Last run failed: ${outcome.message || 'error'} · ${when}`
}
import type { ConnectivityConfigResult, ConnectionProbeResult } from '../../types/config.ts'
import ClientDiagnosticsPanel from './ClientDiagnosticsPanel'
import SharePointRelayDiagnosticsPanel from './SharePointRelayDiagnosticsPanel'
import CredentialManagementSection from './CredentialManagementSection'
import { CrgSubmissionDebugSection } from './CrgSubmissionDebugSection'
import EnterpriseStandardsPanel from './EnterpriseStandardsPanel'
import TbxBackupRestoreSection from './TbxBackupRestoreSection'
import ToolVisibilitySection from './ToolVisibilitySection'
import styles from './AdminHubView.module.css'

// ── Named constants ──

const VIEW_TITLE = '⚙️ Admin Hub'
const VIEW_SUBTITLE = 'Proxy configuration, PI field mappings, feature flags, and developer tools.'

const TERMINAL_COMMAND = 'python "%USERPROFILE%\\Downloads\\toolbox-server.py"'

type AdminHubTab = 'main' | 'repo-monitor' | 'reports-config' | 'standup-briefing' | 'pi-review-scheduler' | 'monthly-delivery' | 'dev-panel' | 'sprint-release' | 'ai-assist'

const ADMIN_HUB_TAB_OPTIONS: { key: AdminHubTab; label: string }[] = [
  { key: 'main', label: '⚙️ Config' },
  { key: 'repo-monitor', label: '🔁 Repo Monitor' },
  { key: 'reports-config', label: '📊 Reports Config' },
  { key: 'standup-briefing', label: '📋 Standup' },
  { key: 'pi-review-scheduler', label: '🗓️ PI Review Sync' },
  { key: 'monthly-delivery', label: '📅 Monthly Delivery' },
  { key: 'sprint-release', label: '🚀 Sprint Release' },
]

// The Dev Panel is admin-gated: its tab is offered only when Admin Access is unlocked, matching the
// intended admin scope (admin unlocks SNow access + the Dev Panel).
const DEV_PANEL_ADMIN_TAB: { key: AdminHubTab; label: string } = { key: 'dev-panel', label: '🛰️ Dev Panel' }
// Hidden "⚡ AI Assist" tab, appended only while the AI Assist capability is unlocked.
const AI_ASSIST_ADMIN_TAB: { key: AdminHubTab; label: string } = { key: 'ai-assist', label: '⚡ AI Assist' }

type ReportsConfigSubTab = 'scope-change' | 'feature-change' | 'hygiene-monitor'

const REPORTS_CONFIG_SUB_TAB_OPTIONS: { key: ReportsConfigSubTab; label: string }[] = [
  { key: 'scope-change', label: '🔔 Scope Change' },
  { key: 'feature-change', label: '🎯 Feature Change' },
  { key: 'hygiene-monitor', label: '🧹 Hygiene Monitor' },
]

/**
 * Launcher files available as one-click downloads from the Proxy & Server Setup section.
 * The href points to the Express download route that serves the file from the
 * distribution root on disk (handles both zip and exe distributions).
 */
const LAUNCHER_DOWNLOADS = [
  { label: '⬇️ Silent Launcher (.vbs)', href: '/api/download/launcher-vbs', filename: 'Launch Toolbox Silent.vbs' },
  { label: '⬇️ Launcher (.bat)',         href: '/api/download/launcher-bat', filename: 'Launch Toolbox.bat' },
] as const

const ONBOARDING_STORAGE_KEYS = ['tbxOnboarded', 'tbxWizardDone'] as const
const TBX_PREFIX = 'tbx'

// ── Proxy section ──

interface ProxySectionProps {
  jiraProxyUrl: string
  snowProxyUrl: string
  githubProxyUrl: string
  isAdminUnlocked: boolean
  proxySaveStatus: string | null
  onSetProxyUrl(service: 'jira' | 'snow' | 'github', url: string): void
  onSave(): void
}

// How long to show the server control confirmation message before clearing it.
const SERVER_CONTROL_MESSAGE_CLEAR_MS = 5000

/**
 * Proxy & Server Setup section — shows connection status, server process controls,
 * download buttons, terminal command, and editable proxy URL fields.
 */
function ProxySection({
  jiraProxyUrl,
  snowProxyUrl,
  githubProxyUrl,
  isAdminUnlocked,
  proxySaveStatus,
  onSetProxyUrl,
  onSave,
}: ProxySectionProps) {
  const proxyStatus = useConnectionStore((storeState) => storeState.proxyStatus)
  const isProxyRunning = proxyStatus !== null

  const [copyButtonLabel, setCopyButtonLabel] = useState('Copy')
  const [isServerControlPending, setIsServerControlPending] = useState(false)
  const [serverControlMessage, setServerControlMessage] = useState<string | null>(null)

  function handleCopyTerminalCommand() {
    navigator.clipboard.writeText(TERMINAL_COMMAND).then(() => {
      setCopyButtonLabel('✓ Copied')
      setTimeout(() => setCopyButtonLabel('Copy'), 1500)
    })
  }

  /** Sends a POST to /api/restart. The server spawns a fresh process then exits. */
  const handleRestartServer = useCallback(async () => {
    setIsServerControlPending(true)
    setServerControlMessage(null)
    try {
      await fetch('/api/restart', { method: 'POST' })
      setServerControlMessage('✅ Server is restarting — the page will reload shortly.')
    } catch {
      // Network error is expected if the server exits before the response arrives.
      setServerControlMessage('✅ Server is restarting — reload the page in a moment.')
    } finally {
      setIsServerControlPending(false)
      setTimeout(() => setServerControlMessage(null), SERVER_CONTROL_MESSAGE_CLEAR_MS)
    }
  }, [])

  /**
   * Sends a POST to /api/shutdown. The server exits cleanly.
   * The launch process automatically kills any occupant of port 5555 on next startup,
   * so relaunching the exe is all that is needed to recover.
   */
  const handleKillPort = useCallback(async () => {
    setIsServerControlPending(true)
    setServerControlMessage(null)
    try {
      await fetch('/api/shutdown', { method: 'POST' })
      setServerControlMessage('✅ Server stopped — relaunch the exe to start again.')
    } catch {
      // Network error here means the server shut down before replying — that's fine.
      setServerControlMessage('✅ Server stopped — relaunch the exe to start again.')
    } finally {
      setIsServerControlPending(false)
      setTimeout(() => setServerControlMessage(null), SERVER_CONTROL_MESSAGE_CLEAR_MS)
    }
  }, [])

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>Proxy &amp; Server Setup</h2>

      {/* Live connection status banner */}
      {isProxyRunning ? (
        <div className={styles.statusBannerGreen}>🟢 Proxy server is running</div>
      ) : (
        <div className={styles.statusBannerMuted}>⚪ Proxy server not detected</div>
      )}

      {/* ── Server process controls ── */}
      {/* Restart clears stale state; Kill Port 5555 stops the process entirely so   */}
      {/* the user can relaunch fresh. On next launch, portManager automatically     */}
      {/* kills any occupant of port 5555 before binding, so a clean restart always  */}
      {/* works even if a previous process got stuck.                                */}
      <div className={styles.serverControlsRow}>
        <button
          className={styles.actionButton}
          onClick={() => void handleRestartServer()}
          disabled={isServerControlPending}
          aria-label="Restart server"
        >
          🔄 Restart Server
        </button>
        <button
          className={`${styles.actionButton} ${styles.dangerButton}`}
          onClick={() => void handleKillPort()}
          disabled={isServerControlPending}
          aria-label="Kill Port 5555"
          title="Stops the server process. Relaunch the exe to start again."
        >
          ⛔ Kill Port 5555
        </button>
        {serverControlMessage !== null && (
          <span className={styles.serverControlMessage}>{serverControlMessage}</span>
        )}
      </div>

      {/* Launcher download links — click to download the file to the user's machine */}
      <div className={styles.downloadButtonsRow}>
        {LAUNCHER_DOWNLOADS.map((launcher) => (
          <a
            key={launcher.label}
            href={launcher.href}
            download={launcher.filename}
            className={styles.downloadButton}
          >
            {launcher.label}
          </a>
        ))}
      </div>

      {/* Terminal command code block */}
      <div className={styles.codeBlock}>
        <code className={styles.codeText}>{TERMINAL_COMMAND}</code>
        <button className={styles.actionButton} onClick={handleCopyTerminalCommand}>
          {copyButtonLabel}
        </button>
      </div>

      {/* Jira proxy URL (always visible) */}
      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="jira-proxy-url">
          Jira Proxy URL
        </label>
        <div className={styles.inputRow}>
          <input
            id="jira-proxy-url"
            type="url"
            className={styles.textInput}
            value={jiraProxyUrl}
            onChange={(changeEvent) => onSetProxyUrl('jira', changeEvent.target.value)}
            placeholder="http://localhost:3001"
          />
          <button className={styles.actionButton} disabled title="Testing via relay">
            Test
          </button>
        </div>
      </div>

      {/* SNow + GitHub proxy URLs — only visible when admin is unlocked */}
      {isAdminUnlocked && (
        <>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="snow-proxy-url">
              ServiceNow Proxy URL
            </label>
            <div className={styles.inputRow}>
              <input
                id="snow-proxy-url"
                type="url"
                className={styles.textInput}
                value={snowProxyUrl}
                onChange={(changeEvent) => onSetProxyUrl('snow', changeEvent.target.value)}
                placeholder="http://localhost:3002"
              />
              <button className={styles.actionButton} disabled title="Testing via relay">
                Test
              </button>
            </div>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="github-proxy-url">
              GitHub Proxy URL
            </label>
            <div className={styles.inputRow}>
              <input
                id="github-proxy-url"
                type="url"
                className={styles.textInput}
                value={githubProxyUrl}
                onChange={(changeEvent) => onSetProxyUrl('github', changeEvent.target.value)}
                placeholder="http://localhost:3003"
              />
              <button className={styles.actionButton} disabled title="Testing via relay">
                Test
              </button>
            </div>
          </div>
        </>
      )}

      <div className={styles.inputRow}>
        <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={onSave}>
          Save All Proxy URLs
        </button>
        {proxySaveStatus !== null && (
          <span className={styles.saveStatus}>{proxySaveStatus}</span>
        )}
      </div>
    </section>
  )
}

// ── ART Settings section ──

interface ArtSettingsSectionProps {
  artSettings: ArtSettingsConfig
  artSaveStatus: string | null
  onSetArtField(field: keyof ArtSettingsConfig, value: string): void
  onSave(): void
}

/** ART Settings section — PI field IDs, sprint points field, PI name and dates. */
function ArtSettingsSection({
  artSettings,
  artSaveStatus,
  onSetArtField,
  onSave,
}: ArtSettingsSectionProps) {
  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>ART Settings</h2>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="pi-field-id">
          PI Field ID
        </label>
        <input
          id="pi-field-id"
          type="text"
          className={styles.textInput}
          value={artSettings.piFieldId}
          onChange={(changeEvent) => onSetArtField('piFieldId', changeEvent.target.value)}
          placeholder="customfield_10301"
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="sprint-points-field-id">
          Sprint Points Field ID
        </label>
        <input
          id="sprint-points-field-id"
          type="text"
          className={styles.textInput}
          value={artSettings.sprintPointsFieldId}
          onChange={(changeEvent) =>
            onSetArtField('sprintPointsFieldId', changeEvent.target.value)
          }
          placeholder="customfield_10016"
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="feature-link-field">
          Feature Link Field
        </label>
        <input
          id="feature-link-field"
          type="text"
          className={styles.textInput}
          value={artSettings.featureLinkField}
          onChange={(changeEvent) => onSetArtField('featureLinkField', changeEvent.target.value)}
          placeholder="customfield_10014"
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="pi-name">
          PI Name
        </label>
        <input
          id="pi-name"
          type="text"
          className={styles.textInput}
          value={artSettings.piName}
          onChange={(changeEvent) => onSetArtField('piName', changeEvent.target.value)}
          placeholder="PI 26.2"
        />
      </div>

      <div className={styles.inputRow}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="pi-start-date">
            PI Start Date
          </label>
          <input
            id="pi-start-date"
            type="date"
            className={styles.dateInput}
            value={artSettings.piStartDate}
            onChange={(changeEvent) => onSetArtField('piStartDate', changeEvent.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="pi-end-date">
            PI End Date
          </label>
          <input
            id="pi-end-date"
            type="date"
            className={styles.dateInput}
            value={artSettings.piEndDate}
            onChange={(changeEvent) => onSetArtField('piEndDate', changeEvent.target.value)}
          />
        </div>
      </div>

      <div className={styles.inputRow}>
        <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={onSave}>
          Save ART Config
        </button>
        {artSaveStatus !== null && <span className={styles.saveStatus}>{artSaveStatus}</span>}
      </div>
    </section>
  )
}


// ── Admin Access section ──

interface AdminAccessSectionProps {
  isAdminUnlocked: boolean
  adminUsername: string
  adminPinInput: string
  adminUnlockError: string | null
  isSnowIntegrationEnabled: boolean
  onUsernameChange(value: string): void
  onPinInputChange(value: string): void
  onTryUnlock(): void
  onLock(): void
  onToggleFeatureFlag(flagKey: 'isSnowIntegrationEnabled'): void
}

/** Clears all localStorage keys that start with the 'tbx' prefix. */
function clearAllConnectionData(): void {
  const keysToRemove: string[] = []
  for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
    const storageKey = localStorage.key(storageIndex)
    if (storageKey !== null && storageKey.startsWith(TBX_PREFIX)) {
      keysToRemove.push(storageKey)
    }
  }
  for (const keyToRemove of keysToRemove) {
    localStorage.removeItem(keyToRemove)
  }
}

/** Admin Access section — username+password entry gate + unlock sections when authenticated. */
function AdminAccessSection({
  isAdminUnlocked,
  adminUsername,
  adminPinInput,
  adminUnlockError,
  isSnowIntegrationEnabled,
  onUsernameChange,
  onPinInputChange,
  onTryUnlock,
  onLock,
  onToggleFeatureFlag,
}: AdminAccessSectionProps) {
  const [wizardResetConfirmation, setWizardResetConfirmation] = useState('')
  const [clearDataConfirmation, setClearDataConfirmation] = useState('')

  function handleResetOnboarding() {
    for (const onboardingKey of ONBOARDING_STORAGE_KEYS) {
      localStorage.removeItem(onboardingKey)
    }
    setWizardResetConfirmation('✅ Wizard reset — reload to re-run onboarding')
  }

  function handleClearAllData() {
    clearAllConnectionData()
    setClearDataConfirmation('✅ All connection data cleared')
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>Admin Access</h2>

      {isAdminUnlocked ? (
        /* Unlocked state */
        <>
          <div className={styles.adminAccessUnlocked}>
            <span className={styles.adminUnlockedLabel}>🔓 Admin access is active</span>
            <button className={styles.actionButton} onClick={onLock}>
              🔒 Lock
            </button>
          </div>

          <hr className={styles.sectionDivider} />

          {/* Advanced Feature Controls */}
          <h3 className={styles.sectionTitle}>Advanced Feature Controls</h3>
          <div className={styles.flagRow}>
            <input
              id="flag-snow-integration"
              type="checkbox"
              checked={isSnowIntegrationEnabled}
              onChange={() => onToggleFeatureFlag('isSnowIntegrationEnabled')}
              aria-label="SNow Integration"
            />
            <label htmlFor="flag-snow-integration" className={styles.fieldLabel}>
              SNow Integration
            </label>
          </div>

          <hr className={styles.sectionDivider} />

          {/* Developer Utilities */}
          <h3 className={styles.sectionTitle}>Developer Utilities</h3>
          <div className={styles.devUtilitiesRow}>
            <button className={styles.actionButton} onClick={handleResetOnboarding}>
              🧙 Reset Onboarding Wizard
            </button>
            <button className={styles.actionButton} onClick={handleClearAllData}>
              🗑 Clear All Connection Data
            </button>
          </div>
          {wizardResetConfirmation !== '' && (
            <p className={styles.confirmationText}>{wizardResetConfirmation}</p>
          )}
          {clearDataConfirmation !== '' && (
            <p className={styles.confirmationText}>{clearDataConfirmation}</p>
          )}
        </>
      ) : (
        /* Locked state — username + password form connecting to POST /api/admin-verify */
        <>
          <p className={styles.adminDescription}>
            Enter admin credentials to access advanced controls.
            Default credentials: <strong>admin / toolbox</strong>
          </p>
          <div className={styles.pinRow}>
            <input
              id="admin-username-input"
              type="text"
              className={styles.pinInput}
              value={adminUsername}
              onChange={(changeEvent) => onUsernameChange(changeEvent.target.value)}
              placeholder="Username"
              maxLength={64}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === 'Enter') onTryUnlock()
              }}
              aria-label="Admin Username"
            />
          </div>
          <div className={styles.pinRow}>
            <input
              id="admin-pin-input"
              type="password"
              className={styles.pinInput}
              value={adminPinInput}
              onChange={(changeEvent) => onPinInputChange(changeEvent.target.value)}
              placeholder="Password"
              maxLength={64}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === 'Enter') onTryUnlock()
              }}
              aria-label="Admin Password"
            />
            <button className={styles.actionButton} onClick={onTryUnlock}>
              Unlock
            </button>
          </div>
          {adminUnlockError !== null && (
            <p className={styles.sectionErrorText} role="alert">
              {adminUnlockError}
            </p>
          )}
        </>
      )}
    </section>
  )
}

// ── Root component ──

// ── Diagnostics section ──

interface DiagnosticsSectionProps {
  isDiagnosticsRunning: boolean
  diagnosticsResult: DiagnosticsResult | null
  diagnosticsError: string | null
  isDiagnosticsSectionCollapsed: boolean
  onRunDiagnostics(): void
  onSetCollapsed(isCollapsed: boolean): void
}

/**
 * Diagnostics section — runs a server-side health check and displays the JSON
 * result. Useful for confirming version, uptime, and Node.js environment.
 */
function DiagnosticsSection({
  isDiagnosticsRunning,
  diagnosticsResult,
  diagnosticsError,
  isDiagnosticsSectionCollapsed,
  onRunDiagnostics,
  onSetCollapsed,
}: DiagnosticsSectionProps) {
  const [copyReportLabel, setCopyReportLabel] = useState('📋 Copy Report')

  function handleCopyReport() {
    if (diagnosticsResult === null) return
    const reportText = JSON.stringify(diagnosticsResult, null, 2)
    navigator.clipboard.writeText(reportText).then(() => {
      setCopyReportLabel('✓ Copied')
      setTimeout(() => setCopyReportLabel('📋 Copy Report'), 1500)
    })
  }

  return (
    <section className={styles.sectionCard}>
      <div className={styles.collapsibleHeader}>
        <h2 className={styles.sectionTitle}>🩺 Diagnostics</h2>
        <button
          className={styles.actionButton}
          onClick={() => onSetCollapsed(!isDiagnosticsSectionCollapsed)}
          aria-label={isDiagnosticsSectionCollapsed ? 'Expand Diagnostics' : 'Collapse Diagnostics'}
        >
          {isDiagnosticsSectionCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isDiagnosticsSectionCollapsed && (
        <>
          <div className={styles.devUtilitiesRow}>
            <button
              className={styles.actionButton}
              onClick={onRunDiagnostics}
              disabled={isDiagnosticsRunning}
            >
              {isDiagnosticsRunning ? '⏳ Running…' : '🔍 Run Diagnostics'}
            </button>
            {diagnosticsResult !== null && (
              <button className={styles.actionButton} onClick={handleCopyReport}>
                {copyReportLabel}
              </button>
            )}
          </div>

          {diagnosticsError !== null && (
            <p className={styles.sectionErrorText}>{diagnosticsError}</p>
          )}

          {diagnosticsResult !== null && (
            <pre className={styles.diagnosticsResultPre}>
              {JSON.stringify(diagnosticsResult, null, 2)}
            </pre>
          )}
        </>
      )}
    </section>
  )
}

// ── Backup & Reset section ──

interface BackupSectionProps {
  isBackupRestoring: boolean
  restoreError: string | null
  isBackupSectionCollapsed: boolean
  onDownloadBackup(): void
  onTriggerRestoreBackup(file: File): void
  onOpenResetAllSettingsDialog(): void
  onSetCollapsed(isCollapsed: boolean): void
}

/**
 * Backup & Reset section — download a JSON snapshot of all toolbox localStorage
 * keys, restore from a previously downloaded file, or wipe all settings.
 */
function BackupSection({
  isBackupRestoring,
  restoreError,
  isBackupSectionCollapsed,
  onDownloadBackup,
  onTriggerRestoreBackup,
  onOpenResetAllSettingsDialog,
  onSetCollapsed,
}: BackupSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleRestoreClick() {
    fileInputRef.current?.click()
  }

  function handleFileChange(changeEvent: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = changeEvent.target.files?.[0]
    if (selectedFile) {
      onTriggerRestoreBackup(selectedFile)
    }
    // Reset the input so the same file can be re-selected if restore fails.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <section className={styles.sectionCard}>
      <div className={styles.collapsibleHeader}>
        <h2 className={styles.sectionTitle}>💾 Backup &amp; Reset</h2>
        <button
          className={styles.actionButton}
          onClick={() => onSetCollapsed(!isBackupSectionCollapsed)}
          aria-label={
            isBackupSectionCollapsed ? 'Expand Backup section' : 'Collapse Backup section'
          }
        >
          {isBackupSectionCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isBackupSectionCollapsed && (
        <>
          <div className={styles.devUtilitiesRow}>
            <button className={styles.actionButton} onClick={onDownloadBackup}>
              ⬇ Download Backup
            </button>
            {/* Hidden file input — triggered by the button below for accessibility */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className={styles.fileInputHidden}
              onChange={handleFileChange}
              aria-hidden="true"
            />
            <button
              className={styles.actionButton}
              onClick={handleRestoreClick}
              disabled={isBackupRestoring}
            >
              ⬆ Restore Backup
            </button>
            <button className={styles.actionButton} onClick={onOpenResetAllSettingsDialog}>
              🗑 Reset All Settings
            </button>
          </div>

          {isBackupRestoring && (
            <p className={styles.confirmationText}>⏳ Restoring…</p>
          )}
          {restoreError !== null && (
            <p className={styles.sectionErrorText}>{restoreError}</p>
          )}
        </>
      )}
    </section>
  )
}

// ── Hygiene Rules section ──

interface HygieneRulesSectionProps {
  hygieneRules: HygieneRules
  isHygieneSectionCollapsed: boolean
  onUpdateHygieneRule: <K extends keyof HygieneRules>(key: K, value: HygieneRules[K]) => void
  onSetCollapsed(isCollapsed: boolean): void
}

/**
 * Hygiene Rules section — configures the stale-ticket thresholds and flags that
 * the DSU Board uses to highlight hygiene issues across the PI.
 */
function HygieneRulesSection({
  hygieneRules,
  isHygieneSectionCollapsed,
  onUpdateHygieneRule,
  onSetCollapsed,
}: HygieneRulesSectionProps) {
  return (
    <section className={styles.sectionCard}>
      <div className={styles.collapsibleHeader}>
        <h2 className={styles.sectionTitle}>🧹 Hygiene Rules</h2>
        <button
          className={styles.actionButton}
          onClick={() => onSetCollapsed(!isHygieneSectionCollapsed)}
          aria-label={
            isHygieneSectionCollapsed ? 'Expand Hygiene Rules' : 'Collapse Hygiene Rules'
          }
        >
          {isHygieneSectionCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isHygieneSectionCollapsed && (
        <>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="hygiene-stale-days">
              Stale Days
            </label>
            <input
              id="hygiene-stale-days"
              type="number"
              min="1"
              max="60"
              className={styles.narrowNumberInput}
              value={hygieneRules.staleDays}
              onChange={(changeEvent) =>
                onUpdateHygieneRule('staleDays', Number(changeEvent.target.value))
              }
            />
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="hygiene-unpointed-warning-days">
              Unpointed Warning Days
            </label>
            <input
              id="hygiene-unpointed-warning-days"
              type="number"
              min="1"
              max="60"
              className={styles.narrowNumberInput}
              value={hygieneRules.unpointedWarningDays}
              onChange={(changeEvent) =>
                onUpdateHygieneRule('unpointedWarningDays', Number(changeEvent.target.value))
              }
            />
          </div>

          <div className={styles.flagRow}>
            <input
              id="hygiene-flag-missing-assignee"
              type="checkbox"
              checked={hygieneRules.hasMissingAssigneeFlag}
              onChange={(changeEvent) =>
                onUpdateHygieneRule('hasMissingAssigneeFlag', changeEvent.target.checked)
              }
              aria-label="Flag Missing Assignees"
            />
            <label htmlFor="hygiene-flag-missing-assignee" className={styles.fieldLabel}>
              Flag Missing Assignees
            </label>
          </div>
        </>
      )}
    </section>
  )
}

// ── Update Management section ──

interface UpdateManagementSectionProps {
  updateCheckResult: UpdateCheckResult | null
  updateCheckError: string | null
  isCheckingUpdate: boolean
  isInstallingUpdate: boolean
  updateInstallPhaseMessage: string | null
  updateInstallProgressPercent: number
  updateInstallError: string | null
  isUpdateSectionCollapsed: boolean
  availableReleases: ReleaseSummary[] | null
  isLoadingReleases: boolean
  releasesError: string | null
  currentVersion: string
  onCheckForUpdates(): void
  onInstallUpdate(): void
  onLoadReleases(): void
  onRollback(version: string): void
  onSetCollapsed(isCollapsed: boolean): void
}

/**
 * Update Management section — checks the server for the latest version and
 * displays release notes so the operator knows when to upgrade.
 * When an update is available, shows an Install button that triggers the
 * server-side update process and waits for the new version to restart.
 */
function UpdateManagementSection({
  updateCheckResult,
  updateCheckError,
  isCheckingUpdate,
  isInstallingUpdate,
  updateInstallPhaseMessage,
  updateInstallProgressPercent,
  updateInstallError,
  isUpdateSectionCollapsed,
  availableReleases,
  isLoadingReleases,
  releasesError,
  currentVersion,
  onCheckForUpdates,
  onInstallUpdate,
  onLoadReleases,
  onRollback,
  onSetCollapsed,
}: UpdateManagementSectionProps) {
  const hasAvailableUpdate = updateCheckResult?.hasUpdate === true;
  const [selectedRollbackVersion, setSelectedRollbackVersion] = useState('');
  // Offer every listed release except the one currently running.
  const rollbackChoices = (availableReleases ?? []).filter((release) => release.version !== currentVersion);

  return (
    <section className={styles.sectionCard}>
      <div className={styles.collapsibleHeader}>
        <h2 className={styles.sectionTitle}>🚀 Update Management</h2>
        <button
          className={styles.actionButton}
          onClick={() => onSetCollapsed(!isUpdateSectionCollapsed)}
          aria-label={
            isUpdateSectionCollapsed
              ? 'Expand Update Management'
              : 'Collapse Update Management'
          }
        >
          {isUpdateSectionCollapsed ? '▶' : '▼'}
        </button>
      </div>

      {!isUpdateSectionCollapsed && (
        <>
          <div className={styles.devUtilitiesRow}>
            <button
              className={styles.actionButton}
              onClick={onCheckForUpdates}
              disabled={isCheckingUpdate || isInstallingUpdate}
            >
              {isCheckingUpdate ? '⏳ Checking…' : '🔍 Check for Updates'}
            </button>

            {hasAvailableUpdate && (
              <button
                className={`${styles.actionButton} ${styles.saveButton}`}
                onClick={onInstallUpdate}
                disabled={isInstallingUpdate}
              >
                {isInstallingUpdate ? '⏳ Installing and restarting…' : '🔄 Install Update'}
              </button>
            )}
          </div>

          {updateCheckError !== null && (
            <p className={styles.updateStatusError} role="alert">
              ⚠️ {updateCheckError}
            </p>
          )}

          {updateInstallError !== null && (
            <p className={styles.updateStatusError} role="alert">
              ⚠️ {updateInstallError}
            </p>
          )}

          {isInstallingUpdate && updateInstallPhaseMessage !== null && (
            <div aria-live="polite" className={styles.updateProgressCard}>
              <div className={styles.updateProgressHeader}>
                <span className={styles.updateStatusAvailable}>{updateInstallPhaseMessage}</span>
                <span className={styles.updateProgressPercent}>{updateInstallProgressPercent}%</span>
              </div>
              <div
                aria-label="Update install progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={updateInstallProgressPercent}
                className={styles.updateProgressTrack}
                role="progressbar"
              >
                <div
                  className={styles.updateProgressFill}
                  style={{ width: `${updateInstallProgressPercent}%` }}
                />
              </div>
            </div>
          )}

          {updateCheckResult !== null && (
            <>
              <div className={styles.updateVersionRow}>
                <span className={styles.fieldLabel}>
                  Current: <strong>v{updateCheckResult.currentVersion}</strong>
                </span>
                <span className={styles.fieldLabel}>
                  Latest: <strong>v{updateCheckResult.latestVersion}</strong>
                </span>
              </div>

              {hasAvailableUpdate ? (
                <p className={styles.updateStatusAvailable}>
                  🆕 Update available: v{updateCheckResult.latestVersion}
                </p>
              ) : (
                <p className={styles.updateStatusSuccess}>✅ Up to date</p>
              )}

              {updateCheckResult.releaseNotes !== '' && (
                <div className={styles.fieldRow}>
                  <label className={styles.fieldLabel} htmlFor="release-notes">
                    Release Notes
                  </label>
                  <textarea
                    id="release-notes"
                    className={styles.releaseNotesTextarea}
                    readOnly
                    value={updateCheckResult.releaseNotes}
                    rows={4}
                  />
                </div>
              )}
            </>
          )}

          {/* Roll back to an earlier release — downloads that version and restarts, same as an update. */}
          <div className={styles.fieldRow} style={{ marginTop: 12, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
            <span className={styles.fieldLabel}>↩️ Roll back to a previous version</span>
            {availableReleases === null ? (
              <button className={styles.actionButton} onClick={onLoadReleases} disabled={isLoadingReleases || isInstallingUpdate}>
                {isLoadingReleases ? '⏳ Loading…' : 'Show previous releases'}
              </button>
            ) : (
              <div className={styles.devUtilitiesRow}>
                <select
                  aria-label="Previous version"
                  value={selectedRollbackVersion}
                  onChange={(changeEvent) => setSelectedRollbackVersion(changeEvent.target.value)}
                  disabled={isInstallingUpdate}
                >
                  <option value="">Select a version…</option>
                  {rollbackChoices.map((release) => (
                    <option key={release.version} value={release.version}>
                      v{release.version}{release.publishedAt !== '' ? ` — ${release.publishedAt.slice(0, 10)}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.actionButton}
                  disabled={selectedRollbackVersion === '' || isInstallingUpdate}
                  onClick={() => {
                    if (window.confirm(`Roll back to v${selectedRollbackVersion}? The app will download that version and restart. Note: plans or settings created in a newer version may not load correctly.`)) {
                      onRollback(selectedRollbackVersion)
                    }
                  }}
                >
                  ↩️ Roll back
                </button>
              </div>
            )}
            {releasesError !== null && (
              <p className={styles.updateStatusError} role="alert">⚠️ {releasesError}</p>
            )}
            {availableReleases !== null && rollbackChoices.length === 0 && releasesError === null && (
              <p className={styles.fieldLabel}>No other releases available.</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

// ── Service Connectivity section ──

interface ServiceConnectivitySectionProps {
  connectivityConfig: ConnectivityConfigResult | null
  isConnectivityConfigLoading: boolean
  connectivityConfigError: string | null
  connectivitySaveStatus: string | null
  snowTestResult: ConnectionProbeResult | null
  isSnowTesting: boolean
  githubTestResult: ConnectionProbeResult | null
  isGitHubTesting: boolean
  confluenceTestResult: ConnectionProbeResult | null
  isConfluenceTesting: boolean
  isAdminUnlocked: boolean
  onLoad(): void
  onSaveSnow(snow: { baseUrl: string; username: string; password: string }): void
  onSaveGitHub(github: { baseUrl: string; pat: string }): void
  onSaveGitHubApp(appCredentials: { appId: string; installationId: string; appPrivateKey: string }): Promise<void>
  onSaveConfluence(confluence: { baseUrl: string; username: string; apiToken: string }): void
  onTestSnow(): void
  onTestGitHub(): void
  onTestConfluence(): void
}

/**
 * Translates a per-repo probe HTTP status and GitHub error message into a human-readable
 * diagnosis. Distinguishes IP allow list blocks (common in SAML orgs) from scope errors,
 * auth failures, and path errors so the operator knows exactly what to fix.
 */
function interpretRepoProbeFailure(httpStatus: number | null, githubMessage: string | null): string {
  if (httpStatus === null) return 'Network error — GitHub unreachable'
  if (httpStatus >= 200 && httpStatus < 300) return '✅ Connected'
  const lowerMessage = (githubMessage ?? '').toLowerCase()
  if (httpStatus === 403) {
    if (lowerMessage.includes('ip') || lowerMessage.includes('allow')) {
      return '❌ IP not on org allow list — contact your GitHub org admin to add your IP, or get the GitHub App installation approved'
    }
    if (lowerMessage.includes('saml')) {
      return '❌ SAML SSO not authorized — go to github.com/settings/tokens → Configure SSO → Authorize your org'
    }
    return '❌ 403 Access denied — org may have IP allow list or SAML enforcement; check PAT has repo scope'
  }
  if (httpStatus === 401) return '❌ 401 — PAT invalid or expired'
  if (httpStatus === 404) return '❌ 404 — Repo not found; verify path uses org/repo format (e.g. zilvertonz/my-repo)'
  return `❌ HTTP ${httpStatus}${githubMessage ? ` — ${githubMessage}` : ''}`
}

/**
 * Service Connectivity section — edits the server-side Snow and GitHub config
 * stored in toolbox-proxy.json. Requires admin unlock to prevent accidental changes.
 * Password and PAT fields show a masked placeholder when credentials are already stored;
 * leave blank to keep the existing value, type a new value to replace it.
 */
function ServiceConnectivitySection({
  connectivityConfig,
  isConnectivityConfigLoading,
  connectivityConfigError,
  connectivitySaveStatus,
  snowTestResult,
  isSnowTesting,
  githubTestResult,
  isGitHubTesting,
  confluenceTestResult,
  isConfluenceTesting,
  isAdminUnlocked,
  onLoad,
  onSaveSnow,
  onSaveGitHub,
  onSaveGitHubApp,
  onSaveConfluence,
  onTestSnow,
  onTestGitHub,
  onTestConfluence,
}: ServiceConnectivitySectionProps) {
  const connectivityConfigKey = connectivityConfig === null
    ? 'connectivity-empty'
    : `${connectivityConfig.snow.baseUrl}|${connectivityConfig.github.baseUrl}|${connectivityConfig.confluence.baseUrl}`

  return (
    <ServiceConnectivitySectionContent
      key={connectivityConfigKey}
      connectivityConfig={connectivityConfig}
      connectivityConfigError={connectivityConfigError}
      connectivitySaveStatus={connectivitySaveStatus}
      confluenceTestResult={confluenceTestResult}
      githubTestResult={githubTestResult}
      isAdminUnlocked={isAdminUnlocked}
      isConfluenceTesting={isConfluenceTesting}
      isConnectivityConfigLoading={isConnectivityConfigLoading}
      isGitHubTesting={isGitHubTesting}
      isSnowTesting={isSnowTesting}
      onLoad={onLoad}
      onSaveConfluence={onSaveConfluence}
      onSaveGitHub={onSaveGitHub}
      onSaveGitHubApp={onSaveGitHubApp}
      onSaveSnow={onSaveSnow}
      onTestConfluence={onTestConfluence}
      onTestGitHub={onTestGitHub}
      onTestSnow={onTestSnow}
      snowTestResult={snowTestResult}
    />
  )
}

/**
 * ServiceConnectivitySectionContent owns the local draft fields for one loaded connectivity snapshot.
 * Remounting this keyed component resets the form only when the saved server config changes.
 */
function ServiceConnectivitySectionContent({
  connectivityConfig,
  isConnectivityConfigLoading,
  connectivityConfigError,
  connectivitySaveStatus,
  snowTestResult,
  isSnowTesting,
  githubTestResult,
  isGitHubTesting,
  confluenceTestResult,
  isConfluenceTesting,
  isAdminUnlocked,
  onLoad,
  onSaveSnow,
  onSaveGitHub,
  onSaveGitHubApp,
  onSaveConfluence,
  onTestSnow,
  onTestGitHub,
  onTestConfluence,
}: ServiceConnectivitySectionProps) {
  const CREDENTIAL_PLACEHOLDER = '••••••••'

  const [snowBaseUrl, setSnowBaseUrl] = useState(connectivityConfig?.snow.baseUrl ?? '')
  const [snowUsername, setSnowUsername] = useState('')
  const [snowPassword, setSnowPassword] = useState('')
  const [githubBaseUrl, setGithubBaseUrl] = useState(connectivityConfig?.github.baseUrl ?? '')
  const [githubPat, setGithubPat] = useState('')
  // State for GitHub App credential fields
  const [githubAppId, setGithubAppId] = useState('')
  const [githubInstallationId, setGithubInstallationId] = useState('')
  const [githubAppPrivateKey, setGithubAppPrivateKey] = useState('')
  // Controls whether the PEM textarea shows its content or is blurred for security.
  const [isPemVisible, setIsPemVisible] = useState(false)
  const pemFileInputRef = useRef<HTMLInputElement>(null)
  // Installation ID lookup diagnostic — populated by "Find my Installation ID" button.
  const [isInstallationsLoading, setIsInstallationsLoading] = useState(false)
  const [foundInstallations, setFoundInstallations] = useState<GitHubAppInstallation[] | null>(null)
  const [installationsError, setInstallationsError] = useState<string | null>(null)
  // Repo-level access probe — validates each configured scheduler repo, not just /user auth.
  const [isValidatingRepoAccess, setIsValidatingRepoAccess] = useState(false)
  const [repoAccessResults, setRepoAccessResults] = useState<SchedulerValidationRepoResult[] | null>(null)
  const [repoAccessError, setRepoAccessError] = useState<string | null>(null)
  const [confluenceBaseUrl, setConfluenceBaseUrl] = useState(connectivityConfig?.confluence.baseUrl ?? '')
  const [confluenceUsername, setConfluenceUsername] = useState('')
  const [confluenceApiToken, setConfluenceApiToken] = useState('')

  // Load config from server when admin unlocks (lazy load on first open).
  useEffect(() => {
    if (isAdminUnlocked && connectivityConfig === null && !isConnectivityConfigLoading) {
      onLoad()
    }
  }, [isAdminUnlocked, connectivityConfig, isConnectivityConfigLoading, onLoad])

  /** Submits the Snow config form and clears credential inputs after save. */
  function handleSaveSnow() {
    onSaveSnow({ baseUrl: snowBaseUrl, username: snowUsername, password: snowPassword })
    // Clear credential inputs after save so the user sees the placeholder again.
    setSnowUsername('')
    setSnowPassword('')
  }

  /** Submits the GitHub config form and clears the PAT input after save. */
  function handleSaveGitHub() {
    onSaveGitHub({ baseUrl: githubBaseUrl, pat: githubPat })
    setGithubPat('')
  }

  /** Submits the GitHub App credentials and clears all three fields after save. */
  async function handleSaveGitHubApp() {
    await onSaveGitHubApp({
      appId: githubAppId,
      installationId: githubInstallationId,
      appPrivateKey: githubAppPrivateKey,
    })
    setGithubAppId('')
    setGithubInstallationId('')
    setGithubAppPrivateKey('')
    setIsPemVisible(false)
  }

  /** Reads a .pem file selected via the hidden file input and populates the PEM field. */
  function handlePemFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const pemText = loadEvent.target?.result as string
      if (pemText) setGithubAppPrivateKey(pemText.trim())
    }
    reader.readAsText(file)
    // Reset the file input so the same file can be re-selected if needed
    event.target.value = ''
  }

  /**
   * Queries the server for all installations of the configured GitHub App.
   * Populates foundInstallations so the user can identify the correct Installation ID.
   * Requires App ID (or Client ID) and Private Key to be saved already.
   */
  async function handleFindInstallations() {
    setIsInstallationsLoading(true)
    setFoundInstallations(null)
    setInstallationsError(null)
    try {
      const hasDraftLookupInputs = githubAppId.trim() !== '' && githubAppPrivateKey.trim() !== ''
      if (hasDraftLookupInputs) {
        await onSaveGitHubApp({
          appId: githubAppId,
          installationId: githubInstallationId,
          appPrivateKey: githubAppPrivateKey,
        })
      }

      const result = await listGitHubAppInstallations()
      if (result.ok) {
        setFoundInstallations(result.installations)
        if (result.installations.length === 0) {
          setInstallationsError('No installations found. The app may not be installed on any org yet. Go to your GitHub App settings → Install App tab → click Install.')
        } else if (result.installations.length === 1) {
          setGithubInstallationId(String(result.installations[0].id))
        }
      } else {
        setInstallationsError(result.message ?? 'Failed to list installations.')
      }
    } catch (listError) {
      setInstallationsError(listError instanceof Error ? listError.message : 'Unknown error')
    } finally {
      setIsInstallationsLoading(false)
    }
  }

  /**
   * Runs the per-repo connectivity probe (branches + PRs endpoints) and surfaces results
   * with human-readable diagnoses. Separate from Test Connection which only probes /user.
   */
  async function handleValidateRepoAccess() {
    setIsValidatingRepoAccess(true)
    setRepoAccessResults(null)
    setRepoAccessError(null)
    try {
      const validation = await fetchSchedulerValidation()
      const repos = validation.repoMonitor.repos
      if (repos.length === 0) {
        setRepoAccessError('No repos configured in the Scheduler section. Add at least one repo there first.')
      } else {
        setRepoAccessResults(repos)
      }
    } catch (validationError) {
      setRepoAccessError(validationError instanceof Error ? validationError.message : 'Repo access check failed')
    } finally {
      setIsValidatingRepoAccess(false)
    }
  }

  /** Submits the Confluence config form and clears credential inputs after save. */
  function handleSaveConfluence() {
    onSaveConfluence({ baseUrl: confluenceBaseUrl, username: confluenceUsername, apiToken: confluenceApiToken })
    setConfluenceUsername('')
    setConfluenceApiToken('')
  }

  const hasDraftGitHubAppLookupInputs = githubAppId.trim() !== '' && githubAppPrivateKey.trim() !== ''
  const hasSavedGitHubAppLookupInputs = !!connectivityConfig?.github.hasAppLookupReady
  const canFindGitHubAppInstallations = hasDraftGitHubAppLookupInputs || hasSavedGitHubAppLookupInputs

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔌 Service Connectivity</h2>
      <p className={styles.adminDescription}>
        Server-side credentials stored in <code>toolbox-proxy.json</code> (AppData).
        Leave password/token blank to keep the current value.
      </p>

      {!isAdminUnlocked && (
        <p className={styles.adminDescription}>🔒 Unlock Admin Access to edit service credentials.</p>
      )}

      {isAdminUnlocked && (
        <>
          {isConnectivityConfigLoading && <p className={styles.adminDescription}>⏳ Loading…</p>}
          {connectivityConfigError !== null && (
            <p className={styles.sectionErrorText}>{connectivityConfigError}</p>
          )}

          {/* ── ServiceNow ── */}
          <h3 className={styles.sectionTitle}>ServiceNow</h3>
          {connectivityConfig !== null && (
            <p className={styles.adminDescription}>
              {connectivityConfig.snow.hasCredentials
                ? `✅ Credentials stored (user: ${connectivityConfig.snow.usernameMasked})`
                : '⚠️ No credentials configured'}
            </p>
          )}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="snow-instance-url">Instance URL</label>
            <input
              id="snow-instance-url"
              type="url"
              className={styles.textInput}
              value={snowBaseUrl}
              onChange={(e) => setSnowBaseUrl(e.target.value)}
              placeholder="https://your-instance.service-now.com"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="snow-username">Username</label>
            <input
              id="snow-username"
              type="text"
              className={styles.textInput}
              value={snowUsername}
              onChange={(e) => setSnowUsername(e.target.value)}
              placeholder={connectivityConfig?.snow.usernameMasked || 'service account username'}
              autoComplete="off"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="snow-password">Password</label>
            <input
              id="snow-password"
              type="password"
              className={styles.textInput}
              value={snowPassword}
              onChange={(e) => setSnowPassword(e.target.value)}
              placeholder={connectivityConfig?.snow.hasCredentials ? CREDENTIAL_PLACEHOLDER : 'password'}
              autoComplete="new-password"
            />
          </div>
          <div className={styles.inputRow}>
            <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={handleSaveSnow}>
              💾 Save SNow Config
            </button>
            <button
              className={styles.actionButton}
              onClick={onTestSnow}
              disabled={isSnowTesting}
            >
              {isSnowTesting ? '⏳ Testing…' : '🔍 Test Connection'}
            </button>
          </div>
          {snowTestResult !== null && (
            <p className={snowTestResult.isOk ? styles.confirmationText : styles.sectionErrorText}>
              {snowTestResult.isOk ? `✅ ${snowTestResult.message}` : `❌ ${snowTestResult.message} (HTTP ${snowTestResult.statusCode})`}
            </p>
          )}
          {connectivitySaveStatus !== null && (
            <p className={styles.confirmationText}>{connectivitySaveStatus}</p>
          )}

          <hr className={styles.sectionDivider} />

          {/* ── GitHub ── */}
          <h3 className={styles.sectionTitle}>GitHub</h3>
          {connectivityConfig !== null && (
            <p className={styles.adminDescription}>
              {connectivityConfig.github.hasAppAuth
                ? '✅ GitHub App credentials stored (preferred)'
                : connectivityConfig.github.hasPat
                  ? '✅ Personal Access Token stored'
                  : '⚠️ No GitHub credentials configured — GitHub features disabled'}
            </p>
          )}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="github-base-url">API Base URL</label>
            <input
              id="github-base-url"
              type="url"
              className={styles.textInput}
              value={githubBaseUrl}
              onChange={(e) => setGithubBaseUrl(e.target.value)}
              placeholder="https://api.github.com"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="github-pat">Personal Access Token</label>
            <input
              id="github-pat"
              type="password"
              className={styles.textInput}
              value={githubPat}
              onChange={(e) => setGithubPat(e.target.value)}
              placeholder={connectivityConfig?.github.hasPat ? CREDENTIAL_PLACEHOLDER : 'ghp_…'}
              autoComplete="new-password"
            />
          </div>
          <div className={styles.inputRow}>
            <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={handleSaveGitHub}>
              💾 Save GitHub Config
            </button>
            <button
              className={styles.actionButton}
              onClick={onTestGitHub}
              disabled={isGitHubTesting}
            >
              {isGitHubTesting ? '⏳ Testing…' : '🔍 Test Connection'}
            </button>
          </div>
          {githubTestResult !== null && (
            <p className={githubTestResult.isOk ? styles.confirmationText : styles.sectionErrorText}>
              {githubTestResult.isOk ? `✅ ${githubTestResult.message}` : `❌ ${githubTestResult.message} (HTTP ${githubTestResult.statusCode})`}
            </p>
          )}

          {/* Repo-level access probe — tests actual repo endpoints, not just /user auth.
              Surfaces IP allow list blocks, SAML enforcement, and scope errors per repo. */}
          <div className={styles.inputRow}>
            <button
              className={styles.actionButton}
              onClick={handleValidateRepoAccess}
              disabled={isValidatingRepoAccess}
            >
              {isValidatingRepoAccess ? '⏳ Checking…' : '📋 Check Repo Access'}
            </button>
          </div>
          {repoAccessError !== null && (
            <p className={styles.sectionErrorText}>{repoAccessError}</p>
          )}
          {repoAccessResults !== null && repoAccessResults.length > 0 && (
            <table className={styles.installationsTable} aria-label="Repo access probe results">
              <thead>
                <tr>
                  <th>Repo</th>
                  <th>Branches</th>
                  <th>PRs</th>
                  <th>Diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {repoAccessResults.map((repoResult) => (
                  <tr key={`repo-access-${repoResult.repo}`}>
                    <td>{repoResult.repo}</td>
                    <td>{repoResult.branchesHttpStatus ?? '—'}</td>
                    <td>{repoResult.pullsHttpStatus ?? '—'}</td>
                    <td>{interpretRepoProbeFailure(repoResult.branchesHttpStatus, repoResult.probeErrorMessage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── GitHub App (enterprise SAML bypass) ── */}
          <details className={styles.collapsibleBlock}>
            <summary className={styles.collapsibleSummary}>
              🔐 GitHub App credentials{' '}
              {connectivityConfig?.github.hasAppAuth && <span className={styles.statusBadgeGreen}>configured</span>}
            </summary>
            <p className={styles.adminDescription}>
              If a PAT returns HTTP 401 due to SAML SSO enforcement, configure a GitHub App instead.
              GitHub Apps are installed at the organisation level and their tokens bypass per-user SSO requirements.
            </p>
            <p className={styles.adminDescription}>
              <strong>App ID or Client ID</strong> — both work as the JWT <code>iss</code> claim. Find either on your
              GitHub App&apos;s settings page. The <strong>Client ID</strong> starts with <code>Iv1.</code>;
              the numeric <strong>App ID</strong> is labelled &ldquo;App ID&rdquo; above it.{' '}
              The <strong>Installation ID</strong> is a <em>separate</em> number — use the
              &ldquo;🔍 Find my Installation ID&rdquo; button below to look it up once the App ID and Private Key are saved.
            </p>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="github-app-id">App ID or Client ID</label>
              <input
                id="github-app-id"
                type="text"
                className={styles.textInput}
                value={githubAppId}
                onChange={(e) => setGithubAppId(e.target.value)}
                placeholder={connectivityConfig?.github.hasAppAuth ? CREDENTIAL_PLACEHOLDER : '123456'}
                autoComplete="off"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="github-installation-id">Installation ID</label>
              <input
                id="github-installation-id"
                type="text"
                className={styles.textInput}
                value={githubInstallationId}
                onChange={(e) => setGithubInstallationId(e.target.value)}
                placeholder={connectivityConfig?.github.hasAppAuth ? CREDENTIAL_PLACEHOLDER : 'use 🔍 below to find this'}
                autoComplete="off"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor="github-app-private-key">Private Key (PEM)</label>
              {/* Hidden file input — triggered by the Upload button below */}
              <input
                ref={pemFileInputRef}
                type="file"
                accept=".pem,.key,.txt"
                style={{ display: 'none' }}
                onChange={handlePemFileChange}
              />
              <textarea
                id="github-app-private-key"
                className={styles.textInput}
                rows={6}
                value={githubAppPrivateKey}
                onChange={(e) => setGithubAppPrivateKey(e.target.value)}
                placeholder={connectivityConfig?.github.hasAppAuth ? CREDENTIAL_PLACEHOLDER : '-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----'}
                autoComplete="off"
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  resize: 'vertical',
                  // Blur the content unless the user explicitly toggles visibility.
                  filter: isPemVisible ? 'none' : 'blur(4px)',
                  transition: 'filter 0.15s ease',
                }}
              />
              <div className={styles.pemControls}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => pemFileInputRef.current?.click()}
                  title="Load PEM from file instead of copy-pasting"
                >
                  📂 Upload .pem file
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => setIsPemVisible((prev) => !prev)}
                  title={isPemVisible ? 'Hide private key content' : 'Reveal private key content'}
                >
                  {isPemVisible ? '🙈 Hide' : '👁 Show'}
                </button>
              </div>
            </div>
            <div className={styles.inputRow}>
              <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={handleSaveGitHubApp}>
                💾 Save GitHub App Config
              </button>
              <button
                className={styles.actionButton}
                onClick={onTestGitHub}
                disabled={isGitHubTesting}
                title="Test GitHub connectivity using App credentials (or PAT if App not configured)"
              >
                {isGitHubTesting ? '⏳ Testing…' : '🔌 Test Connection'}
              </button>
            </div>
          </details>

          {/* ── Installation ID lookup diagnostic ── */}
          <details className={styles.collapsibleBlock}>
            <summary className={styles.collapsibleSummary}>🔍 Find my Installation ID</summary>
            <p className={styles.adminDescription}>
              <strong>Not sure of your Installation ID?</strong> Save your App ID (or Client ID) and Private Key first
              using the form above, then click below to list every place the app is installed.
              A 404 error on Test Connection almost always means the Installation ID is wrong, or the app
              has been <em>created</em> but not yet <em>installed</em> on your org.
              To install: GitHub App settings → &ldquo;Install App&rdquo; tab → Install.
            </p>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => void handleFindInstallations()}
              disabled={isInstallationsLoading || !canFindGitHubAppInstallations}
              title={canFindGitHubAppInstallations
                ? 'Query GitHub for all installations of this app'
                : 'Enter or save the App ID and Private Key first'}
            >
              {isInstallationsLoading ? '⏳ Looking up…' : '🔍 Find my Installation ID'}
            </button>

            {installationsError !== null && (
              <p className={styles.sectionErrorText}>❌ {installationsError}</p>
            )}

            {foundInstallations !== null && foundInstallations.length > 0 && (
              <table className={styles.installationsTable}>
                <thead>
                  <tr>
                    <th>Installation ID</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {foundInstallations.map((installation) => (
                    <tr key={installation.id}>
                      <td><code>{installation.id}</code></td>
                      <td>{installation.account}</td>
                      <td>{installation.accountType}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => setGithubInstallationId(String(installation.id))}
                          title="Copy this Installation ID into the field above"
                        >
                          ✅ Use this ID
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>

          <hr className={styles.sectionDivider} />

          {/* ── Confluence ── */}
          <h3 className={styles.sectionTitle}>Confluence</h3>
          {connectivityConfig !== null && (
            <p className={styles.adminDescription}>
              {connectivityConfig.confluence.hasCredentials
                ? `✅ Credentials stored (user: ${connectivityConfig.confluence.usernameMasked})`
                : '⚠️ No credentials configured — Confluence features disabled'}
            </p>
          )}
          <p className={styles.adminDescription}>
            Confluence Cloud uses <strong>Basic Auth</strong> with your Atlassian email and a
            Cloud API token — <em>not</em> the same as a Jira on-prem PAT. Generate one at{' '}
            <code>id.atlassian.com → Security → API tokens</code>.
          </p>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="confluence-base-url">Base URL</label>
            <input
              id="confluence-base-url"
              type="url"
              className={styles.textInput}
              value={confluenceBaseUrl}
              onChange={(e) => setConfluenceBaseUrl(e.target.value)}
              placeholder="https://yoursite.atlassian.net"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="confluence-username">Atlassian Email</label>
            <input
              id="confluence-username"
              type="text"
              className={styles.textInput}
              value={confluenceUsername}
              onChange={(e) => setConfluenceUsername(e.target.value)}
              placeholder={connectivityConfig?.confluence.usernameMasked || 'you@example.com'}
              autoComplete="off"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="confluence-api-token">Cloud API Token</label>
            <input
              id="confluence-api-token"
              type="password"
              className={styles.textInput}
              value={confluenceApiToken}
              onChange={(e) => setConfluenceApiToken(e.target.value)}
              placeholder={connectivityConfig?.confluence.hasCredentials ? CREDENTIAL_PLACEHOLDER : 'Atlassian API token'}
              autoComplete="new-password"
            />
          </div>
          <div className={styles.inputRow}>
            <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={handleSaveConfluence}>
              💾 Save Confluence Config
            </button>
            <button
              className={styles.actionButton}
              onClick={onTestConfluence}
              disabled={isConfluenceTesting}
            >
              {isConfluenceTesting ? '⏳ Testing…' : '🔍 Test Connection'}
            </button>
          </div>
          {confluenceTestResult !== null && (
            <p className={confluenceTestResult.isOk ? styles.confirmationText : styles.sectionErrorText}>
              {confluenceTestResult.isOk
                ? `✅ ${confluenceTestResult.message}`
                : `❌ ${confluenceTestResult.message} (HTTP ${confluenceTestResult.statusCode})`}
            </p>
          )}
        </>
      )}
    </section>
  )
}

// ── Relay Activation section ──

/** Relay Activation section — bookmarklet generator for the SNow relay bridge. */
function RelayActivationSection() {
  const relayBridgeStatus = useConnectionStore((storeState) => storeState.relayBridgeStatus)
  const isRelayActive = relayBridgeStatus?.isConnected ?? false

  function handleBookmarkletClick(clickEvent: ReactMouseEvent<HTMLAnchorElement>) {
    clickEvent.preventDefault()
    window.alert(
      'Drag "NodeToolbox SNow Relay" to your browser bookmarks bar first. ' +
      'After ServiceNow opens, click that bookmark from the ServiceNow tab.',
    )
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔗 Relay Activation</h2>

      <div className={styles.adminAccessUnlocked}>
        <span className={isRelayActive ? styles.adminUnlockedLabel : styles.adminDescription}>
          {isRelayActive ? '🟢 SNow Relay: active' : '🔴 SNow Relay: inactive'}
        </span>
      </div>

      <p className={styles.adminDescription}>
        SNow uses Okta authentication, which blocks direct API calls from NodeToolbox.
        The relay bookmarklet runs inside your authenticated SNow browser tab and
        forwards API calls through that tab, matching the original ToolBox flow.
      </p>

      <h3 className={styles.sectionTitle}>How to activate</h3>
      <ol className={styles.relayInstructions}>
        <li>Drag the button below to your browser bookmarks bar.</li>
        <li>Open any ServiceNow page while logged in.</li>
        <li>Click the <strong>NodeToolbox SNow Relay</strong> bookmark.</li>
        <li>The relay indicator above will turn green automatically.</li>
      </ol>

      <div className={styles.devUtilitiesRow}>
        <BookmarkletInstallLink
          bookmarkletCode={SNOW_RELAY_BOOKMARKLET_CODE}
          className={`${styles.actionButton} ${styles.bookmarkletLink}`}
          title="Drag this to your bookmarks bar to install the relay"
          onClick={handleBookmarkletClick}
        >
          🔖 Drag to bookmarks: NodeToolbox SNow Relay
        </BookmarkletInstallLink>
      </div>

      <p className={styles.adminDescription}>
        ⚠ Bookmark bar must be visible (Ctrl+Shift+B in Chrome/Edge). Do not click the bookmarklet here.
        The relay resets when you close the SNow tab or restart the server.
      </p>
    </section>
  )
}

// ── Feature request section ──

/** The GitHub repository URL used to build the new-issue link. */
const GITHUB_REPO_URL = 'https://github.com/mikejsmith1985/NodeToolbox'

/**
 * Feature Request section — lets the user draft a title and optional description,
 * then either open a pre-filled GitHub new-issue page or copy the request as plain
 * text for users who don't have a GitHub account.
 *
 * Since NodeToolbox runs locally on each machine there is no central collection
 * server.  Both submission paths are purely client-side.
 */
function FeatureRequestSection() {
  const [requestTitle, setRequestTitle] = useState('')
  const [requestDescription, setRequestDescription] = useState('')
  const [hasSentToGitHub, setHasSentToGitHub] = useState(false)
  const [hasCopiedToClipboard, setHasCopiedToClipboard] = useState(false)

  // A single derived flag keeps all the button disabled checks consistent.
  const isFormEmpty = requestTitle.trim() === ''

  /** Returns the request formatted as plain text, suitable for email or chat. */
  function buildPlainTextRequest(): string {
    const descriptionText = requestDescription.trim() !== ''
      ? requestDescription.trim()
      : 'No additional details provided.'

    return [
      `Feature Request: ${requestTitle.trim()}`,
      '',
      descriptionText,
      '',
      '-- Submitted from NodeToolbox AdminHub',
    ].join('\n')
  }

  /** Builds a pre-filled GitHub new-issue URL and opens it in a new browser tab. */
  function handleOpenGitHubIssue() {
    if (isFormEmpty) return

    const encodedTitle = encodeURIComponent(requestTitle.trim())

    // Provide a sensible default body so the issue template looks professional
    // even when the user leaves the description blank.
    const bodyText = requestDescription.trim() !== ''
      ? requestDescription.trim()
      : '_No additional details provided._'

    const encodedBody = encodeURIComponent(
      `## Feature Request\n\n${bodyText}\n\n---\n_Submitted from NodeToolbox AdminHub_`
    )

    const issueUrl =
      `${GITHUB_REPO_URL}/issues/new?labels=enhancement&title=${encodedTitle}&body=${encodedBody}`

    // noopener prevents the new tab from accessing window.opener, which is a
    // security best-practice for links that open external sites.
    window.open(issueUrl, '_blank', 'noopener,noreferrer')

    setRequestTitle('')
    setRequestDescription('')
    setHasSentToGitHub(true)
    setHasCopiedToClipboard(false)

    // Clear the confirmation message after 5 seconds.
    setTimeout(() => setHasSentToGitHub(false), 5000)
  }

  /**
   * Copies the formatted request as plain text to the clipboard.
   * This path requires no GitHub account — the user can paste the text
   * into an email, Teams message, Slack, or anything that reaches the maintainer.
   */
  async function handleCopyToClipboard() {
    if (isFormEmpty) return

    await navigator.clipboard.writeText(buildPlainTextRequest())

    setHasCopiedToClipboard(true)
    setHasSentToGitHub(false)

    setTimeout(() => setHasCopiedToClipboard(false), 5000)
  }

  // Only one confirmation message shows at a time; GitHub open takes priority.
  const confirmationMessage = hasSentToGitHub
    ? '✅ Browser tab opened — complete the issue there to submit!'
    : hasCopiedToClipboard
      ? '✅ Copied! Paste into an email, Teams message, or wherever reaches your admin.'
      : null

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>💡 Request a Feature</h2>

      <p className={styles.adminDescription}>
        Have an idea for NodeToolbox? Fill in a title below. If you have a GitHub account,
        open a GitHub issue directly. No account? Copy the request as plain text and send
        it via email or Teams.
      </p>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="feature-request-title">
          Feature title
        </label>
        <input
          id="feature-request-title"
          type="text"
          className={styles.textInput}
          value={requestTitle}
          onChange={(e) => setRequestTitle(e.target.value)}
          placeholder="e.g. Add dark-mode toggle to settings"
          maxLength={200}
        />
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="feature-request-description">
          Description{' '}
          <span className={styles.optionalLabel}>(optional)</span>
        </label>
        <textarea
          id="feature-request-description"
          className={styles.featureRequestTextarea}
          value={requestDescription}
          onChange={(e) => setRequestDescription(e.target.value)}
          placeholder="Describe what you'd like and why it would be useful…"
          rows={4}
          maxLength={2000}
        />
      </div>

      <div className={styles.inputRow}>
        {/* Primary path — opens a pre-filled GitHub issue in the browser */}
        <button
          className={`${styles.actionButton} ${styles.saveButton}`}
          onClick={handleOpenGitHubIssue}
          disabled={isFormEmpty}
          title="Requires a GitHub account"
        >
          🚀 Open GitHub Issue
        </button>

        {/* Fallback path — copies formatted text for email / Teams / Slack */}
        <button
          className={styles.actionButton}
          onClick={() => void handleCopyToClipboard()}
          disabled={isFormEmpty}
          title="No GitHub account? Copy the request and send it via email or Teams"
        >
          📋 Copy Request
        </button>

        {confirmationMessage !== null && (
          <span className={styles.confirmationText}>{confirmationMessage}</span>
        )}
      </div>
    </section>
  )
}

// ── Root component ──

// ── Notifications section ──

interface NotificationsSectionProps {
  teamConfigs: NotificationTeamConfig[]
  artRollup: NotificationArtRollupConfig
  saveStatus: string | null
  teamRunStatuses: (string | null)[]
  isTeamRunning: boolean[]
  isRollupRunning: boolean
  rollupRunStatus: string | null
  deliveryStatuses: Record<string, DeliveryOutcome>
  onMount(): void
  onUpdateTeam(index: number, field: string, value: string | boolean): void
  onUpdateRollup(field: string, value: string | boolean): void
  onSave(): void
  onRunTeam(index: number): void
  onRunRollup(): void
  onTestWebhook(triggerUrl: string, triggerSecret?: string): Promise<{ ok: boolean; message: string }>
}

/** Notifications section — configures per-team daily Scope Change delivery to Confluence. */
function NotificationsSection({
  teamConfigs,
  artRollup,
  saveStatus,
  teamRunStatuses,
  isTeamRunning,
  isRollupRunning,
  rollupRunStatus,
  deliveryStatuses,
  onMount,
  onUpdateTeam,
  onUpdateRollup,
  onSave,
  onRunTeam,
  onRunRollup,
  onTestWebhook,
}: NotificationsSectionProps) {
  // Capture onMount in a ref so the effect only fires once on initial render,
  // not every time the parent re-renders and creates a new inline function reference.
  const onMountRef = useRef(onMount)
  const [webhookTestStatuses, setWebhookTestStatuses] = useState<(string | null)[]>([])
  const [webhookTestStatusRollup, setWebhookTestStatusRollup] = useState<string | null>(null)

  const handleTestWebhook = useCallback(async (triggerUrl: string, triggerSecret: string, index: number | 'rollup') => {
    if (!triggerUrl) return
    const result = await onTestWebhook(triggerUrl, triggerSecret || undefined)
    if (index === 'rollup') {
      setWebhookTestStatusRollup(result.message)
      setTimeout(() => setWebhookTestStatusRollup(null), 4000)
    } else {
      setWebhookTestStatuses((prev) => {
        const next = [...prev]
        next[index] = result.message
        return next
      })
      setTimeout(() => setWebhookTestStatuses((prev) => { const next = [...prev]; next[index] = null; return next }), 4000)
    }
  }, [onTestWebhook])
  useEffect(() => { void onMountRef.current() }, [])

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🔔 Notifications</h2>
      <p className={styles.adminDescription}>
        Daily Scope Change reports delivered to Confluence. Each ART team can have its own destination
        and schedule. The ART Rollup delivers a combined cross-team report for the RTE.
        Teams are sourced from ART View Settings.
      </p>

      {teamConfigs.length === 0 && (
        <p className={styles.adminDescription}>
          ⚠️ No ART teams with project keys found. Configure teams in ART View → Settings first.
        </p>
      )}

      {teamConfigs.map((team, index) => (
        <div key={team.projectKey} className={styles.notificationTeamRow}>
          <div className={styles.notificationTeamHeader}>
            <strong>{team.teamName}</strong>
            <code className={styles.projectKeyBadge}>{team.projectKey}</code>
            <input
              type="checkbox"
              id={'team-enabled-' + index}
              checked={team.isEnabled}
              onChange={(e) => onUpdateTeam(index, 'isEnabled', e.target.checked)}
              aria-label={'Enable notifications for ' + team.teamName}
            />
            <label htmlFor={'team-enabled-' + index} className={styles.fieldLabel}>Enabled</label>
          </div>
          <div className={styles.notificationTeamFields}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'team-space-' + index}>Space Key</label>
              <input
                id={'team-space-' + index}
                type="text"
                className={styles.textInput}
                value={team.confluenceSpaceKey}
                onChange={(e) => onUpdateTeam(index, 'confluenceSpaceKey', e.target.value)}
                placeholder="e.g. TEAM"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'team-time-' + index}>Schedule</label>
              <input
                id={'team-time-' + index}
                type="time"
                className={styles.timeInput}
                value={team.scheduleTime}
                onChange={(e) => onUpdateTeam(index, 'scheduleTime', e.target.value)}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'team-url-' + index}>Target Blog URL</label>
              <input
                id={'team-url-' + index}
                type="url"
                className={styles.textInput}
                value={team.targetBlogUrl}
                onChange={(e) => onUpdateTeam(index, 'targetBlogUrl', e.target.value)}
                placeholder="Paste Confluence blog URL to update existing page (optional)"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'team-trigger-' + index}>Automation Trigger URL</label>
              <input
                id={'team-trigger-' + index}
                type="url"
                className={styles.textInput}
                value={team.triggerUrl}
                onChange={(e) => onUpdateTeam(index, 'triggerUrl', e.target.value)}
                placeholder="Confluence Automation incoming webhook URL (optional)"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'team-trigger-secret-' + index}>Webhook Secret</label>
              <input
                id={'team-trigger-secret-' + index}
                type="password"
                className={styles.textInput}
                value={team.triggerSecret}
                onChange={(e) => onUpdateTeam(index, 'triggerSecret', e.target.value)}
                placeholder="Secret shown in Confluence Automation rule (optional)"
              />
              <button
                type="button"
                className={styles.actionButton}
                disabled={!team.triggerUrl}
                onClick={() => void handleTestWebhook(team.triggerUrl, team.triggerSecret, index)}
                title="Send a test POST to this webhook URL"
              >Test</button>
              {(webhookTestStatuses[index] ?? null) !== null && (
                <span className={styles.saveStatus}>{webhookTestStatuses[index]}</span>
              )}
            </div>
          </div>
          <div className={styles.actionRow}>
            <button
              className={styles.actionButton}
              disabled={isTeamRunning[index] || team.confluenceSpaceKey.trim() === ''}
              onClick={() => onRunTeam(index)}
              type="button"
              title="Run this team's report now"
            >
              {isTeamRunning[index] ? 'Running…' : 'Run Now'}
            </button>
            {teamRunStatuses[index] !== null && (
              <span className={styles.saveStatus}>{teamRunStatuses[index]}</span>
            )}
          </div>
          <span className={styles.deliveryStatusLine}>
            {formatLastDelivery(deliveryStatuses[`team-${index}-${team.projectKey}`])}
          </span>
        </div>
      ))}

      <hr className={styles.sectionDivider} />

      <h3 className={styles.sectionTitle}>📊 ART Rollup Report</h3>
      <p className={styles.adminDescription}>
        Combines all team project keys into one report for the RTE.
        {artRollup.projectKeys.length > 0 && (
          <span> Teams: <strong>{artRollup.projectKeys.join(', ')}</strong></span>
        )}
      </p>
      <div className={styles.notificationTeamFields}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="rollup-space-key">Space Key</label>
          <input
            id="rollup-space-key"
            type="text"
            className={styles.textInput}
            value={artRollup.confluenceSpaceKey}
            onChange={(e) => onUpdateRollup('confluenceSpaceKey', e.target.value)}
            placeholder="e.g. ART"
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="rollup-schedule">Schedule</label>
          <input
            id="rollup-schedule"
            type="time"
            className={styles.timeInput}
            value={artRollup.scheduleTime}
            onChange={(e) => onUpdateRollup('scheduleTime', e.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="rollup-url">Target Blog URL</label>
          <input
            id="rollup-url"
            type="url"
            className={styles.textInput}
            value={artRollup.targetBlogUrl}
            onChange={(e) => onUpdateRollup('targetBlogUrl', e.target.value)}
            placeholder="Paste Confluence blog URL to update existing page (optional)"
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="rollup-trigger">Automation Trigger URL</label>
          <input
            id="rollup-trigger"
            type="url"
            className={styles.textInput}
            value={artRollup.triggerUrl}
            onChange={(e) => onUpdateRollup('triggerUrl', e.target.value)}
            placeholder="Confluence Automation incoming webhook URL (optional)"
          />
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel} htmlFor="rollup-trigger-secret">Webhook Secret</label>
          <input
            id="rollup-trigger-secret"
            type="password"
            className={styles.textInput}
            value={artRollup.triggerSecret}
            onChange={(e) => onUpdateRollup('triggerSecret', e.target.value)}
            placeholder="Secret shown in Confluence Automation rule (optional)"
          />
          <button
            type="button"
            className={styles.actionButton}
            disabled={!artRollup.triggerUrl}
            onClick={() => void handleTestWebhook(artRollup.triggerUrl, artRollup.triggerSecret, 'rollup')}
            title="Send a test POST to this webhook URL"
          >Test</button>
          {webhookTestStatusRollup !== null && (
            <span className={styles.saveStatus}>{webhookTestStatusRollup}</span>
          )}
        </div>
        <div className={styles.flagRow}>
          <input
            id="rollup-enabled"
            type="checkbox"
            checked={artRollup.isEnabled}
            onChange={(e) => onUpdateRollup('isEnabled', e.target.checked)}
          />
          <label htmlFor="rollup-enabled" className={styles.fieldLabel}>Enable daily schedule</label>
        </div>
      </div>
      <div className={styles.actionRow}>
        <button
          className={styles.actionButton}
          disabled={isRollupRunning || artRollup.projectKeys.length === 0 || artRollup.confluenceSpaceKey.trim() === ''}
          onClick={onRunRollup}
          type="button"
          title="Run the ART rollup report now"
        >
          {isRollupRunning ? 'Running…' : 'Run Rollup Now'}
        </button>
        {rollupRunStatus !== null && <span className={styles.saveStatus}>{rollupRunStatus}</span>}
        <span className={styles.deliveryStatusLine}>{formatLastDelivery(deliveryStatuses.artRollup)}</span>
      </div>

      <hr className={styles.sectionDivider} />

      <div className={styles.actionRow}>
        <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={onSave} type="button">
          Save All
        </button>
        {saveStatus !== null && <span className={styles.saveStatus}>{saveStatus}</span>}
      </div>
    </section>
  )
}

// ── Feature Change section ──

interface FeatureChangeSectionProps {
  featureConfigs: FeatureChangeReportConfig[]
  artRollup: FeatureChangeArtRollupConfig
  saveStatus: string | null
  featureRunStatuses: (string | null)[]
  isFeatureRunning: boolean[]
  isFeatureRollupRunning: boolean
  featureRollupRunStatus: string | null
  deliveryStatuses: Record<string, DeliveryOutcome>
  onMount(): void
  onUpdate(index: number, field: keyof FeatureChangeReportConfig, value: string | boolean): void
  onUpdateArtRollup(field: keyof FeatureChangeArtRollupConfig, value: string | boolean): void
  onSave(): void
  onRunNow(index: number): void
  onRunRollupNow(): void
  onTestWebhook(triggerUrl: string, triggerSecret?: string): Promise<{ ok: boolean; message: string }>
}

/** Feature Change section — configures per-project daily Feature Change delivery to Confluence. */
function FeatureChangeSection({
  featureConfigs,
  artRollup,
  saveStatus,
  featureRunStatuses,
  isFeatureRunning,
  isFeatureRollupRunning,
  featureRollupRunStatus,
  deliveryStatuses,
  onMount,
  onUpdate,
  onUpdateArtRollup,
  onSave,
  onRunNow,
  onRunRollupNow,
  onTestWebhook,
}: FeatureChangeSectionProps) {
  const onMountRef = useRef(onMount)
  const [webhookTestStatuses, setWebhookTestStatuses] = useState<(string | null)[]>([])
  const [webhookTestStatusRollup, setWebhookTestStatusRollup] = useState<string | null>(null)

  const handleTestWebhook = useCallback(async (triggerUrl: string, triggerSecret: string, index: number | 'rollup') => {
    if (!triggerUrl) return
    const result = await onTestWebhook(triggerUrl, triggerSecret || undefined)
    if (index === 'rollup') {
      setWebhookTestStatusRollup(result.message)
      setTimeout(() => setWebhookTestStatusRollup(null), 4000)
    } else {
      setWebhookTestStatuses((prev) => {
        const next = [...prev]
        next[index] = result.message
        return next
      })
      setTimeout(() => setWebhookTestStatuses((prev) => { const next = [...prev]; next[index] = null; return next }), 4000)
    }
  }, [onTestWebhook])

  useEffect(() => { void onMountRef.current() }, [])

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🎯 Feature Change Reports</h2>
      <p className={styles.adminDescription}>
        Daily Feature Change reports monitor Epic-level issues for changes to fix version, status,
        Target Start, Target End, and Due Date. Each project delivers its own report to Confluence.
        Projects are sourced from ART View Settings.
      </p>

      {featureConfigs.length === 0 && (
        <p className={styles.adminDescription}>
          ⚠️ No ART teams with project keys found. Configure teams in ART View → Settings first.
        </p>
      )}

      {featureConfigs.map((featureConfig, index) => (
        <div key={featureConfig.projectKey} className={styles.notificationTeamRow}>
          <div className={styles.notificationTeamHeader}>
            <strong>{featureConfig.teamName}</strong>
            <code className={styles.projectKeyBadge}>{featureConfig.projectKey}</code>
            <input
              type="checkbox"
              id={'feature-enabled-' + index}
              checked={featureConfig.isEnabled}
              onChange={(changeEvent) => onUpdate(index, 'isEnabled', changeEvent.target.checked)}
              aria-label={'Enable feature change reports for ' + featureConfig.teamName}
            />
            <label htmlFor={'feature-enabled-' + index} className={styles.fieldLabel}>Enabled</label>
          </div>
          <div className={styles.notificationTeamFields}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'feature-space-' + index}>Space Key</label>
              <input
                id={'feature-space-' + index}
                type="text"
                className={styles.textInput}
                value={featureConfig.confluenceSpaceKey}
                onChange={(changeEvent) => onUpdate(index, 'confluenceSpaceKey', changeEvent.target.value)}
                placeholder="e.g. TEAM"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'feature-time-' + index}>Schedule</label>
              <input
                id={'feature-time-' + index}
                type="time"
                className={styles.timeInput}
                value={featureConfig.scheduleTime}
                onChange={(changeEvent) => onUpdate(index, 'scheduleTime', changeEvent.target.value)}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'feature-url-' + index}>Target Blog URL</label>
              <input
                id={'feature-url-' + index}
                type="url"
                className={styles.textInput}
                value={featureConfig.targetBlogUrl}
                onChange={(changeEvent) => onUpdate(index, 'targetBlogUrl', changeEvent.target.value)}
                placeholder="Paste Confluence blog URL to update existing page (optional)"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'feature-trigger-' + index}>Automation Trigger URL</label>
              <input
                id={'feature-trigger-' + index}
                type="url"
                className={styles.textInput}
                value={featureConfig.triggerUrl}
                onChange={(changeEvent) => onUpdate(index, 'triggerUrl', changeEvent.target.value)}
                placeholder="Confluence Automation incoming webhook URL (optional)"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel} htmlFor={'feature-trigger-secret-' + index}>Webhook Secret</label>
              <input
                id={'feature-trigger-secret-' + index}
                type="password"
                className={styles.textInput}
                value={featureConfig.triggerSecret}
                onChange={(changeEvent) => onUpdate(index, 'triggerSecret', changeEvent.target.value)}
                placeholder="Secret shown in Confluence Automation rule (optional)"
              />
              <button
                type="button"
                className={styles.actionButton}
                disabled={!featureConfig.triggerUrl}
                onClick={() => void handleTestWebhook(featureConfig.triggerUrl, featureConfig.triggerSecret, index)}
                title="Send a test POST to this webhook URL"
              >Test</button>
              {(webhookTestStatuses[index] ?? null) !== null && (
                <span className={styles.saveStatus}>{webhookTestStatuses[index]}</span>
              )}
            </div>
          </div>
          <div className={styles.actionRow}>
            <button
              className={styles.actionButton}
              disabled={isFeatureRunning[index] || featureConfig.confluenceSpaceKey.trim() === ''}
              onClick={() => onRunNow(index)}
              type="button"
              title="Run this project's feature change report now"
            >
              {isFeatureRunning[index] ? 'Running…' : 'Run Now'}
            </button>
            {featureRunStatuses[index] !== null && (
              <span className={styles.saveStatus}>{featureRunStatuses[index]}</span>
            )}
          </div>
          <span className={styles.deliveryStatusLine}>
            {formatLastDelivery(deliveryStatuses[`feature-${index}-${featureConfig.jiraLabel || featureConfig.projectKey}`])}
          </span>
        </div>
      ))}

      <hr className={styles.sectionDivider} />

      {/* ART Rollup — combined delivery covering all configured team labels */}
      <div className={styles.notificationTeamRow}>
        <div className={styles.notificationTeamHeader}>
          <strong>All Teams — ART Rollup</strong>
          <span className={styles.projectKeyBadge}>Combined</span>
          <input
            type="checkbox"
            id="feature-rollup-enabled"
            checked={artRollup.isEnabled}
            onChange={(changeEvent) => onUpdateArtRollup('isEnabled', changeEvent.target.checked)}
            aria-label="Enable Feature Change ART Rollup delivery"
          />
          <label htmlFor="feature-rollup-enabled" className={styles.fieldLabel}>Enabled</label>
        </div>
        <p className={styles.adminDescription}>
          Delivers a single combined Feature Change report covering all teams. Team labels are
          sourced automatically from the per-team configurations above.
        </p>
        <div className={styles.notificationTeamFields}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="feature-rollup-space">Space Key</label>
            <input
              id="feature-rollup-space"
              type="text"
              className={styles.textInput}
              value={artRollup.confluenceSpaceKey}
              onChange={(changeEvent) => onUpdateArtRollup('confluenceSpaceKey', changeEvent.target.value)}
              placeholder="e.g. ART"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="feature-rollup-time">Schedule</label>
            <input
              id="feature-rollup-time"
              type="time"
              className={styles.timeInput}
              value={artRollup.scheduleTime}
              onChange={(changeEvent) => onUpdateArtRollup('scheduleTime', changeEvent.target.value)}
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="feature-rollup-url">Target Page URL</label>
            <input
              id="feature-rollup-url"
              type="url"
              className={styles.textInput}
              value={artRollup.targetBlogUrl}
              onChange={(changeEvent) => onUpdateArtRollup('targetBlogUrl', changeEvent.target.value)}
              placeholder="Paste Confluence page or blog URL to update (optional)"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="feature-rollup-trigger">Automation Trigger URL</label>
            <input
              id="feature-rollup-trigger"
              type="url"
              className={styles.textInput}
              value={artRollup.triggerUrl}
              onChange={(changeEvent) => onUpdateArtRollup('triggerUrl', changeEvent.target.value)}
              placeholder="Confluence Automation incoming webhook URL (optional)"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="feature-rollup-secret">Webhook Secret</label>
            <input
              id="feature-rollup-secret"
              type="password"
              className={styles.textInput}
              value={artRollup.triggerSecret}
              onChange={(changeEvent) => onUpdateArtRollup('triggerSecret', changeEvent.target.value)}
              placeholder="Secret shown in Confluence Automation rule (optional)"
            />
            <button
              type="button"
              className={styles.actionButton}
              disabled={!artRollup.triggerUrl}
              onClick={() => void handleTestWebhook(artRollup.triggerUrl, artRollup.triggerSecret, 'rollup')}
              title="Send a test POST to this webhook URL"
            >Test</button>
            {webhookTestStatusRollup !== null && (
              <span className={styles.saveStatus}>{webhookTestStatusRollup}</span>
            )}
          </div>
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.actionButton}
            disabled={isFeatureRollupRunning || artRollup.confluenceSpaceKey.trim() === ''}
            onClick={onRunRollupNow}
            type="button"
            title="Run the ART Feature Change Rollup report now"
          >
            {isFeatureRollupRunning ? 'Running…' : 'Run Now'}
          </button>
          {featureRollupRunStatus !== null && (
            <span className={styles.saveStatus}>{featureRollupRunStatus}</span>
          )}
          <span className={styles.deliveryStatusLine}>{formatLastDelivery(deliveryStatuses['feature-art-rollup'])}</span>
        </div>
      </div>

      <hr className={styles.sectionDivider} />

      <div className={styles.actionRow}>
        <button className={`${styles.actionButton} ${styles.saveButton}`} onClick={onSave} type="button">
          Save All
        </button>
        {saveStatus !== null && <span className={styles.saveStatus}>{saveStatus}</span>}
      </div>
    </section>
  )
}

// ── Reports Config tab ──

interface ReportsConfigContentProps {
  state: AdminHubState
  actions: AdminHubActions
}

/**
 * Reports Config tab content — sub-tabbed container for Scope Change and Feature Change
 * report configuration. Mirrors the DevPanel sub-tab pattern.
 */
function ReportsConfigContent({ state, actions }: ReportsConfigContentProps) {
  const [activeReportsSubTab, setActiveReportsSubTab] = useState<ReportsConfigSubTab>('scope-change')

  return (
    <>
      <PrimaryTabs
        ariaLabel="Reports Config sub-tabs"
        idPrefix="admin-hub-reports"
        tabs={REPORTS_CONFIG_SUB_TAB_OPTIONS}
        activeTab={activeReportsSubTab}
        onChange={setActiveReportsSubTab}
      />

      {activeReportsSubTab === 'scope-change' && (
        <section
          id="admin-hub-reports-scope-change-panel"
          role="tabpanel"
          aria-labelledby="admin-hub-reports-scope-change-tab"
        >
          <NotificationsSection
            teamConfigs={state.notificationTeamConfigs}
            artRollup={state.notificationArtRollup}
            saveStatus={state.notificationsSaveStatus}
            teamRunStatuses={state.teamRunStatuses}
            isTeamRunning={state.isTeamRunning}
            isRollupRunning={state.isRollupRunning}
            rollupRunStatus={state.rollupRunStatus}
            deliveryStatuses={state.deliveryStatuses.scopeChange ?? {}}
            onMount={() => { void actions.loadNotificationConfigs() }}
            onUpdateTeam={(index, field, value) => actions.updateTeamConfig(index, field as never, value as never)}
            onUpdateRollup={(field, value) => actions.updateArtRollup(field as never, value as never)}
            onSave={() => { void actions.saveNotificationsConfig() }}
            onRunTeam={(index) => { void actions.runTeamNow(index) }}
            onRunRollup={() => { void actions.runRollupNow() }}
            onTestWebhook={actions.testWebhook}
          />
        </section>
      )}

      {activeReportsSubTab === 'feature-change' && (
        <section
          id="admin-hub-reports-feature-change-panel"
          role="tabpanel"
          aria-labelledby="admin-hub-reports-feature-change-tab"
        >
          <FeatureChangeSection
            featureConfigs={state.featureChangeConfigs}
            artRollup={state.featureChangeArtRollup}
            saveStatus={state.featureChangeSaveStatus}
            featureRunStatuses={state.featureRunStatuses}
            isFeatureRunning={state.isFeatureRunning}
            isFeatureRollupRunning={state.isFeatureRollupRunning}
            featureRollupRunStatus={state.featureRollupRunStatus}
            deliveryStatuses={state.deliveryStatuses.featureChange ?? {}}
            onMount={() => { void actions.loadFeatureChangeConfigs() }}
            onUpdate={(index, field, value) => actions.updateFeatureChangeConfig(index, field, value)}
            onUpdateArtRollup={(field, value) => actions.updateFeatureChangeArtRollup(field, value)}
            onSave={() => { void actions.saveFeatureChangeConfigs() }}
            onRunNow={(index) => { void actions.runFeatureNow(index) }}
            onRunRollupNow={() => { void actions.runFeatureArtRollupNow() }}
            onTestWebhook={actions.testWebhook}
          />
        </section>
      )}

      {activeReportsSubTab === 'hygiene-monitor' && (
        <section
          id="admin-hub-reports-hygiene-monitor-panel"
          role="tabpanel"
          aria-labelledby="admin-hub-reports-hygiene-monitor-tab"
        >
          <HygieneMonitorPanel />
        </section>
      )}
    </>
  )
}

interface AdminHubMainContentProps {
  state: AdminHubState
  actions: AdminHubActions
}

/** Renders the existing Admin Hub configuration surface inside the Config tab. */
function AdminHubMainContent({ state, actions }: AdminHubMainContentProps) {
  return (
    <>
      {/*
       * AdminAccessSection is intentionally rendered FIRST so the unlock form
       * is always visible at the top of the page. Sections below (Proxy,
       * ServiceConnectivity) rely on isAdminUnlocked — if AdminAccess were
       * placed after them the user would see a locked message with no obvious
       * way to unlock it without scrolling past the locked content.
       */}
      <AdminAccessSection
        isAdminUnlocked={state.isAdminUnlocked}
        adminUsername={state.adminUsername}
        adminPinInput={state.adminPinInput}
        adminUnlockError={state.adminUnlockError}
        isSnowIntegrationEnabled={state.featureFlags.isSnowIntegrationEnabled}
        onUsernameChange={actions.setAdminUsername}
        onPinInputChange={actions.setAdminPinInput}
        onTryUnlock={actions.tryUnlock}
        onLock={actions.lock}
        onToggleFeatureFlag={actions.toggleFeatureFlag}
      />

      <UpdateManagementSection
        updateCheckResult={state.updateCheckResult}
        updateCheckError={state.updateCheckError}
        isCheckingUpdate={state.isCheckingUpdate}
        isInstallingUpdate={state.isInstallingUpdate}
        updateInstallPhaseMessage={state.updateInstallPhaseMessage}
        updateInstallProgressPercent={state.updateInstallProgressPercent}
        updateInstallError={state.updateInstallError}
        isUpdateSectionCollapsed={state.isUpdateSectionCollapsed}
        availableReleases={state.availableReleases}
        isLoadingReleases={state.isLoadingReleases}
        releasesError={state.releasesError}
        currentVersion={state.currentAppVersion}
        onCheckForUpdates={actions.checkForUpdates}
        onInstallUpdate={actions.installUpdate}
        onLoadReleases={actions.loadReleases}
        onRollback={actions.rollbackToVersion}
        onSetCollapsed={actions.setUpdateSectionCollapsed}
      />

      <ProxySection
        jiraProxyUrl={state.proxyUrls.jiraProxyUrl}
        snowProxyUrl={state.proxyUrls.snowProxyUrl}
        githubProxyUrl={state.proxyUrls.githubProxyUrl}
        isAdminUnlocked={state.isAdminUnlocked}
        proxySaveStatus={state.proxySaveStatus}
        onSetProxyUrl={actions.setProxyUrl}
        onSave={actions.saveProxyUrls}
      />

      <ServiceConnectivitySection
        connectivityConfig={state.connectivityConfig}
        isConnectivityConfigLoading={state.isConnectivityConfigLoading}
        connectivityConfigError={state.connectivityConfigError}
        connectivitySaveStatus={state.connectivitySaveStatus}
        snowTestResult={state.snowTestResult}
        isSnowTesting={state.isSnowTesting}
        githubTestResult={state.githubTestResult}
        isGitHubTesting={state.isGitHubTesting}
        confluenceTestResult={state.confluenceTestResult}
        isConfluenceTesting={state.isConfluenceTesting}
        isAdminUnlocked={state.isAdminUnlocked}
        onLoad={() => void actions.loadConnectivityConfig()}
        onSaveSnow={(snow) => void actions.saveSnowConfig(snow)}
        onSaveGitHub={(github) => void actions.saveGitHubConfig(github)}
        onSaveGitHubApp={(appCredentials) => actions.saveGitHubAppConfig(appCredentials)}
        onSaveConfluence={(confluence) => void actions.saveConfluenceConfig(confluence)}
        onTestSnow={() => void actions.testSnowConfig()}
        onTestGitHub={() => void actions.testGitHubConfig()}
        onTestConfluence={() => void actions.testConfluenceConfig()}
      />

      <ArtSettingsSection
        artSettings={state.artSettings}
        artSaveStatus={state.artSaveStatus}
        onSetArtField={actions.setArtField}
        onSave={actions.saveArtSettings}
      />

      <RelayActivationSection />

      <EnterpriseStandardsPanel />
      <CredentialManagementSection />

      <HygieneRulesSection
        hygieneRules={state.hygieneRules}
        isHygieneSectionCollapsed={state.isHygieneSectionCollapsed}
        onUpdateHygieneRule={actions.updateHygieneRule}
        onSetCollapsed={actions.setHygieneSectionCollapsed}
      />

      <FeatureRequestSection />
    </>
  )
}

/** Admin Hub — configuration and developer tools for NodeToolbox administrators. */
export default function AdminHubView() {
  const { state, actions } = useAdminHubState()
  const [activeAdminTab, setActiveAdminTab] = useState<AdminHubTab>('main')
  const adminHubRootRef = useRef<HTMLDivElement | null>(null)

  // The hidden AI Assist capability is unlocked app-wide by <AiAssistUnlockGate> (Ctrl+Alt+Z from
  // any screen). Admin Hub only reads the shared unlock state to decide whether to offer its
  // ⚡ AI Assist config tab — it no longer owns the shortcut or the passphrase prompt.
  const { isUnlocked: isAiAssistUnlocked } = useAiAssist()

  // The 🛰️ Dev Panel tab is offered only while Admin Access is unlocked; the ⚡ AI Assist tab only
  // while the passphrase capability is unlocked.
  const adminHubTabs = [
    ...ADMIN_HUB_TAB_OPTIONS,
    ...(state.isAdminUnlocked ? [DEV_PANEL_ADMIN_TAB] : []),
    ...(isAiAssistUnlocked ? [AI_ASSIST_ADMIN_TAB] : []),
  ]

  // If a gated tab is active but its capability locks, fall back to Config. Done during render
  // (React's endorsed "adjust state when state changes" pattern) rather than in an effect, so it
  // does not trip react-hooks/set-state-in-effect and applies immediately.
  if (!state.isAdminUnlocked && activeAdminTab === 'dev-panel') {
    setActiveAdminTab('main')
  } else if (!isAiAssistUnlocked && activeAdminTab === 'ai-assist') {
    setActiveAdminTab('main')
  }

  useEffect(() => {
    const scrollContainer = adminHubRootRef.current?.closest('main')
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTop = 0
    }

    if (typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
  }, [activeAdminTab])

  return (
    <ViewFrame
      bodyClassName={styles.adminHubBody}
      className={styles.adminHubView}
      ref={adminHubRootRef}
      title={VIEW_TITLE}
      subtitle={VIEW_SUBTITLE}
      width="full"
    >
      {state.isResetAllSettingsConfirmOpen && (
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Reset Settings"
          isDangerous
          message="Reset all toolbox settings? This cannot be undone."
          onCancel={actions.closeResetAllSettingsDialog}
          onConfirm={actions.resetAllSettings}
        />
      )}

      <PrimaryTabs
        ariaLabel="Admin Hub tabs"
        idPrefix="admin-hub"
        tabs={adminHubTabs}
        activeTab={activeAdminTab}
        onChange={setActiveAdminTab}
      />


      {activeAdminTab === 'main' && (
        <section id="admin-hub-main-panel" role="tabpanel" aria-labelledby="admin-hub-main-tab">
          <AdminHubMainContent actions={actions} state={state} />
        </section>
      )}

      {activeAdminTab === 'reports-config' && (
        <section id="admin-hub-reports-config-panel" role="tabpanel" aria-labelledby="admin-hub-reports-config-tab">
          <ReportsConfigContent state={state} actions={actions} />
        </section>
      )}

      {activeAdminTab === 'dev-panel' && state.isAdminUnlocked && (
        <section id="admin-hub-dev-panel-panel" role="tabpanel" aria-labelledby="admin-hub-dev-panel-tab">
          <DevPanelView />
          <section className={styles.sectionCard}>
            <h2 className={styles.sectionTitle}>🧭 Diagnostics Toolkit Guide</h2>
            <p className={styles.adminDescription}>
              <strong>Repo Monitor Validation</strong> reads scheduler config, status, and result
              events directly from server APIs so you can confirm monitoring is actually connected
              and processing repo activity.
            </p>
            <p className={styles.adminDescription}>
              <strong>CRG Submission Debug</strong> captures the exact request/response JSON from
              the last CRG submission and compares fields so mapping problems are visible immediately.
            </p>
            <p className={styles.adminDescription}>
              <strong>Diagnostics</strong> calls the server health endpoint and returns runtime
              details (version, uptime, platform, relay and integration state) as raw JSON for
              precise troubleshooting.
            </p>
            <p className={styles.adminDescription}>
              <strong>Backup &amp; Restore</strong> exports or restores local settings snapshots by
              reading and writing browser storage keys, which allows recoverable configuration changes.
            </p>
            <p className={styles.adminDescription}>
              <strong>Client Diagnostics</strong> gives a read-only browser/settings snapshot, and
              <strong> Tool Visibility</strong> explains and controls which home cards are shown.
            </p>
          </section>
          <CrgSubmissionDebugSection />
          <DiagnosticsSection
            isDiagnosticsRunning={state.isDiagnosticsRunning}
            diagnosticsResult={state.diagnosticsResult}
            diagnosticsError={state.diagnosticsError}
            isDiagnosticsSectionCollapsed={state.isDiagnosticsSectionCollapsed}
            onRunDiagnostics={actions.runDiagnostics}
            onSetCollapsed={actions.setDiagnosticsSectionCollapsed}
          />
          <BackupSection
            isBackupRestoring={state.isBackupRestoring}
            restoreError={state.restoreError}
            isBackupSectionCollapsed={state.isBackupSectionCollapsed}
            onDownloadBackup={actions.downloadBackup}
            onTriggerRestoreBackup={actions.triggerRestoreBackup}
            onOpenResetAllSettingsDialog={actions.openResetAllSettingsDialog}
            onSetCollapsed={actions.setBackupSectionCollapsed}
          />
          <ClientDiagnosticsPanel />
          <SharePointRelayDiagnosticsPanel />
          <TbxBackupRestoreSection />
          <ToolVisibilitySection />
        </section>
      )}

      {activeAdminTab === 'repo-monitor' && (
        <section id="admin-hub-repo-monitor-panel" role="tabpanel" aria-labelledby="admin-hub-repo-monitor-tab">
          <RepoMonitorPanel />
        </section>
      )}

      {activeAdminTab === 'standup-briefing' && (
        <section id="admin-hub-standup-briefing-panel" role="tabpanel" aria-labelledby="admin-hub-standup-briefing-tab">
          <StandupBriefingPanel />
        </section>
      )}

      {activeAdminTab === 'pi-review-scheduler' && (
        <section id="admin-hub-pi-review-scheduler-panel" role="tabpanel" aria-labelledby="admin-hub-pi-review-scheduler-tab">
          <PiReviewSchedulerPanel />
        </section>
      )}

      {activeAdminTab === 'monthly-delivery' && (
        <section id="admin-hub-monthly-delivery-panel" role="tabpanel" aria-labelledby="admin-hub-monthly-delivery-tab">
          <MonthlyDeliveryPanel />
        </section>
      )}

      {activeAdminTab === 'sprint-release' && (
        <section id="admin-hub-sprint-release-panel" role="tabpanel" aria-labelledby="admin-hub-sprint-release-tab">
          <SprintReleasePanel />
        </section>
      )}

      {activeAdminTab === 'ai-assist' && isAiAssistUnlocked && (
        <section id="admin-hub-ai-assist-panel" role="tabpanel" aria-labelledby="admin-hub-ai-assist-tab">
          <AiAssistAutomationPanel />
        </section>
      )}
    </ViewFrame>
  )
}
