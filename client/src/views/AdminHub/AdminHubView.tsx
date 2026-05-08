// AdminHubView.tsx — Tabbed administration centre for configuration, controls, and embedded diagnostics.
//
// The Config tab keeps the existing proxy, ART, access-control, hygiene, update, and backup sections.
// The Dev Panel tab embeds the live API diagnostics view so leadership and support workflows stay in one hub.

import { useRef, useState } from 'react'

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

/**
 * Proxy & Server Setup section — shows connection status, download buttons,
 * terminal command, and editable proxy URL fields.
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

  function handleCopyTerminalCommand() {
    navigator.clipboard.writeText(TERMINAL_COMMAND).then(() => {
      setCopyButtonLabel('✓ Copied')
      setTimeout(() => setCopyButtonLabel('Copy'), 1500)
    })
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>Proxy &amp; Server Setup</h2>

      {/* Live connection status banner */}
      {isProxyRunning ? (
        <div className={styles.statusBannerGreen}>🟢 Proxy server is running</div>
      ) : (
        <div className={styles.statusBannerMuted}>⚪ Proxy server not detected</div>
      )}

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
  adminPinInput: string
  isSnowIntegrationEnabled: boolean
  isAiEnabled: boolean
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

/** Admin Access section — PIN entry gate + unlock sections when authenticated. */
function AdminAccessSection({
  isAdminUnlocked,
  adminPinInput,
  isSnowIntegrationEnabled,
  isAiEnabled,
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
        /* Locked state */
        <>
          <p className={styles.adminDescription}>
            Enter admin PIN to access advanced controls.
          </p>
          <div className={styles.pinRow}>
            <input
              id="admin-pin-input"
              type="password"
              className={styles.pinInput}
              value={adminPinInput}
              onChange={(changeEvent) => onPinInputChange(changeEvent.target.value)}
              placeholder="Enter PIN"
              maxLength={8}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === 'Enter') onTryUnlock()
              }}
              aria-label="Admin PIN"
            />
            <button className={styles.actionButton} onClick={onTryUnlock}>
              Unlock
            </button>
          </div>
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
  onResetAllSettings(): void
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
  onResetAllSettings,
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
            <button className={styles.actionButton} onClick={onResetAllSettings}>
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
  isCheckingUpdate: boolean
  isUpdateSectionCollapsed: boolean
  onCheckForUpdates(): void
  onSetCollapsed(isCollapsed: boolean): void
}

/**
 * Update Management section — checks the server for the latest version and
 * displays release notes so the operator knows when to upgrade.
 */
function UpdateManagementSection({
  updateCheckResult,
  isCheckingUpdate,
  isUpdateSectionCollapsed,
  onCheckForUpdates,
  onSetCollapsed,
}: UpdateManagementSectionProps) {
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
              disabled={isCheckingUpdate}
            >
              {isCheckingUpdate ? '⏳ Checking…' : '🔍 Check for Updates'}
            </button>
          </div>

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

              {updateCheckResult.hasUpdate ? (
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

// ── Root component ──

interface AdminHubMainContentProps {
  state: AdminHubState
  actions: AdminHubActions
}

/** Renders the existing Admin Hub configuration surface inside the Config tab. */
function AdminHubMainContent({ state, actions }: AdminHubMainContentProps) {
  return (
    <>
      <ProxySection
        jiraProxyUrl={state.proxyUrls.jiraProxyUrl}
        snowProxyUrl={state.proxyUrls.snowProxyUrl}
        githubProxyUrl={state.proxyUrls.githubProxyUrl}
        isAdminUnlocked={state.isAdminUnlocked}
        proxySaveStatus={state.proxySaveStatus}
        onSetProxyUrl={actions.setProxyUrl}
        onSave={actions.saveProxyUrls}
      />

      <ArtSettingsSection
        artSettings={state.artSettings}
        artSaveStatus={state.artSaveStatus}
        onSetArtField={actions.setArtField}
        onSave={actions.saveArtSettings}
      />

      <AdminAccessSection
        isAdminUnlocked={state.isAdminUnlocked}
        adminPinInput={state.adminPinInput}
        isSnowIntegrationEnabled={state.featureFlags.isSnowIntegrationEnabled}
        isAiEnabled={state.featureFlags.isAiEnabled}
        onPinInputChange={actions.setAdminPinInput}
        onTryUnlock={actions.tryUnlock}
        onLock={actions.lock}
        onToggleFeatureFlag={actions.toggleFeatureFlag}
      />

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
        onResetAllSettings={actions.resetAllSettings}
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
        isCheckingUpdate={state.isCheckingUpdate}
        isUpdateSectionCollapsed={state.isUpdateSectionCollapsed}
        onCheckForUpdates={actions.checkForUpdates}
        onSetCollapsed={actions.setUpdateSectionCollapsed}
      />

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
  const [activeAdminTab, setActiveAdminTab] = useState<AdminHubTab>('main')

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
