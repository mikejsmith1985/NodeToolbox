// AdminHubView.tsx — Tabbed administration centre for configuration, controls, and embedded diagnostics.
//
// The Config tab keeps the existing proxy, ART, access-control, hygiene, update, and backup sections.
// The Dev Panel tab embeds the live API diagnostics view so leadership and support workflows stay in one hub.

import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react'

import { BookmarkletInstallLink } from '../../components/BookmarkletInstallLink/index.tsx'
import ConfirmDialog from '../../components/ConfirmDialog/index.tsx'
import PromptDialog from '../../components/PromptDialog/index.tsx'
import { useToast } from '../../components/Toast/ToastProvider.tsx'
import { SNOW_RELAY_BOOKMARKLET_CODE } from '../../services/browserRelay.ts'
import { useConnectionStore } from '../../store/connectionStore'
import DevPanelView from '../DevPanel/DevPanelView.tsx'
import { useAdminHubState } from './hooks/useAdminHubState.ts'
import type {
  AdminHubActions,
  AdminHubState,
  ArtSettingsConfig,
  DiagnosticsResult,
  HygieneRules,
  UpdateCheckResult,
} from './hooks/useAdminHubState.ts'
import type { ConnectivityConfigResult, ConnectionProbeResult } from '../../types/config.ts'
import ClientDiagnosticsPanel from './ClientDiagnosticsPanel'
import CredentialManagementSection from './CredentialManagementSection'
import EnterpriseStandardsPanel from './EnterpriseStandardsPanel'
import TbxBackupRestoreSection from './TbxBackupRestoreSection'
import ToolVisibilitySection from './ToolVisibilitySection'
import styles from './AdminHubView.module.css'

// ── Named constants ──

const VIEW_TITLE = '⚙️ Admin Hub'
const VIEW_SUBTITLE = 'Proxy configuration, PI field mappings, feature flags, and developer tools.'

const TERMINAL_COMMAND = 'python "%USERPROFILE%\\Downloads\\toolbox-server.py"'

type AdminHubTab = 'main' | 'dev-panel'

const ADMIN_HUB_TAB_OPTIONS: { key: AdminHubTab; label: string }[] = [
  { key: 'main', label: '⚙️ Config' },
  { key: 'dev-panel', label: '🛰️ Dev Panel' },
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
  isAiEnabled: boolean
  onUsernameChange(value: string): void
  onPinInputChange(value: string): void
  onTryUnlock(): void
  onLock(): void
  onToggleFeatureFlag(flagKey: 'isSnowIntegrationEnabled' | 'isAiEnabled'): void
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
  isAiEnabled,
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
          <div className={styles.flagRow}>
            <input
              id="flag-ai-features"
              type="checkbox"
              checked={isAiEnabled}
              onChange={() => onToggleFeatureFlag('isAiEnabled')}
              aria-label="AI Features"
            />
            <label htmlFor="flag-ai-features" className={styles.fieldLabel}>
              AI Features
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
  updateInstallError: string | null
  isUpdateSectionCollapsed: boolean
  onCheckForUpdates(): void
  onInstallUpdate(): void
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
  updateInstallError,
  isUpdateSectionCollapsed,
  onCheckForUpdates,
  onInstallUpdate,
  onSetCollapsed,
}: UpdateManagementSectionProps) {
  const hasAvailableUpdate = updateCheckResult?.hasUpdate === true;

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
  onSaveConfluence(confluence: { baseUrl: string; username: string; apiToken: string }): void
  onTestSnow(): void
  onTestGitHub(): void
  onTestConfluence(): void
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
  const [confluenceBaseUrl, setConfluenceBaseUrl] = useState(connectivityConfig?.confluence.baseUrl ?? '')
  const [confluenceUsername, setConfluenceUsername] = useState('')
  const [confluenceApiToken, setConfluenceApiToken] = useState('')

  // Sync local URL fields when the server config loads for the first time.
  useEffect(() => {
    if (connectivityConfig !== null) {
      setSnowBaseUrl(connectivityConfig.snow.baseUrl)
      setGithubBaseUrl(connectivityConfig.github.baseUrl)
      setConfluenceBaseUrl(connectivityConfig.confluence.baseUrl)
    }
  }, [connectivityConfig])

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

  /** Submits the Confluence config form and clears credential inputs after save. */
  function handleSaveConfluence() {
    onSaveConfluence({ baseUrl: confluenceBaseUrl, username: confluenceUsername, apiToken: confluenceApiToken })
    setConfluenceUsername('')
    setConfluenceApiToken('')
  }

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
              {connectivityConfig.github.hasPat
                ? '✅ Personal Access Token stored'
                : '⚠️ No PAT configured — GitHub features disabled'}
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
        isAiEnabled={state.featureFlags.isAiEnabled}
        onUsernameChange={actions.setAdminUsername}
        onPinInputChange={actions.setAdminPinInput}
        onTryUnlock={actions.tryUnlock}
        onLock={actions.lock}
        onToggleFeatureFlag={actions.toggleFeatureFlag}
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

      <HygieneRulesSection
        hygieneRules={state.hygieneRules}
        isHygieneSectionCollapsed={state.isHygieneSectionCollapsed}
        onUpdateHygieneRule={actions.updateHygieneRule}
        onSetCollapsed={actions.setHygieneSectionCollapsed}
      />

      <UpdateManagementSection
        updateCheckResult={state.updateCheckResult}
        updateCheckError={state.updateCheckError}
        isCheckingUpdate={state.isCheckingUpdate}
        isInstallingUpdate={state.isInstallingUpdate}
        updateInstallError={state.updateInstallError}
        isUpdateSectionCollapsed={state.isUpdateSectionCollapsed}
        onCheckForUpdates={actions.checkForUpdates}
        onInstallUpdate={actions.installUpdate}
        onSetCollapsed={actions.setUpdateSectionCollapsed}
      />

      <FeatureRequestSection />

      {state.isAdvancedUnlocked ? (
        <>
          <ToolVisibilitySection />
          <ClientDiagnosticsPanel />
          <TbxBackupRestoreSection />
        </>
      ) : (
        <p className={styles.lockedSectionsPlaceholder}>
          🔒 Unlock Advanced to access Tool Visibility, Client Diagnostics, and Backup/Restore.
        </p>
      )}
    </>
  )
}

/** Admin Hub — configuration and developer tools for NodeToolbox administrators. */
export default function AdminHubView() {
  const { state, actions } = useAdminHubState()
  const { showToast } = useToast()
  const [activeAdminTab, setActiveAdminTab] = useState<AdminHubTab>('main')

  useEffect(() => {
    if (state.advancedUnlockError === null) {
      return
    }

    showToast(state.advancedUnlockError, 'error')
    actions.clearAdvancedUnlockError()
  }, [actions, showToast, state.advancedUnlockError])

  return (
    <div className={styles.adminHubView}>
      <header>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
        <div className={styles.headerActions}>
          {state.isAdvancedUnlocked ? (
            <button
              className={styles.advancedLockButton}
              onClick={actions.advancedLock}
              aria-label="Lock advanced sections"
            >
              🔓 Lock Advanced
            </button>
          ) : (
            <button
              className={styles.advancedLockButton}
              onClick={actions.tryAdvancedUnlock}
              aria-label="Unlock advanced sections"
            >
              🔒 Advanced
            </button>
          )}
        </div>
      </header>

      {state.isAdvancedUnlockDialogOpen && (
        <PromptDialog
          inputLabel="Admin passphrase"
          isPassword
          message={state.advancedUnlockPromptMessage}
          onCancel={actions.closeAdvancedUnlockDialog}
          onConfirm={actions.submitAdvancedUnlock}
          placeholder="Enter passphrase"
        />
      )}

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

      <div aria-label="Admin Hub tabs" className={styles.tabList} role="tablist">
        {ADMIN_HUB_TAB_OPTIONS.map((tabOption) => {
          const isActiveTab = tabOption.key === activeAdminTab
          return (
            <button
              aria-controls={`${tabOption.key}-panel`}
              aria-selected={isActiveTab}
              className={`${styles.tabButton} ${isActiveTab ? styles.activeTab : ''}`}
              id={`${tabOption.key}-tab`}
              key={tabOption.key}
              onClick={() => setActiveAdminTab(tabOption.key)}
              role="tab"
              type="button"
            >
              {tabOption.label}
            </button>
          )
        })}
      </div>

      {activeAdminTab === 'main' && (
        <section id="main-panel" role="tabpanel" aria-labelledby="main-tab">
          <AdminHubMainContent actions={actions} state={state} />
        </section>
      )}

      {activeAdminTab === 'dev-panel' && (
        <section id="dev-panel-panel" role="tabpanel" aria-labelledby="dev-panel-tab">
          <DevPanelView />
        </section>
      )}
    </div>
  )
}
