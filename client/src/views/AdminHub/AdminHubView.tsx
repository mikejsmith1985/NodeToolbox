// AdminHubView.tsx — Configuration centre for proxy URLs, ART field mappings, and feature flags.
//
// Four always-visible sections: Proxy & Server Setup, ART Settings, Admin Access (PIN unlock),
// and (when unlocked) Advanced Feature Controls + Developer Utilities.

import { useState } from 'react'

import { useConnectionStore } from '../../store/connectionStore'
import { useAdminHubState } from './hooks/useAdminHubState.ts'
import type { ArtSettingsConfig } from './hooks/useAdminHubState.ts'
import styles from './AdminHubView.module.css'

// ── Named constants ──

const VIEW_TITLE = '⚙️ Admin Hub'
const VIEW_SUBTITLE = 'Proxy configuration, PI field mappings, feature flags, and developer tools.'

const TERMINAL_COMMAND = 'python "%USERPROFILE%\\Downloads\\toolbox-server.py"'

const DOWNLOAD_ITEMS = [
  { label: '⬇️ server.py' },
  { label: '⬇️ server.js' },
  { label: '⬇️ Silent Launcher (.vbs)' },
  { label: '⬇️ Launcher (.bat)' },
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

      {/* Download buttons — disabled in React; legacy dashboard required */}
      <div className={styles.downloadButtonsRow}>
        {DOWNLOAD_ITEMS.map((downloadItem) => (
          <button key={downloadItem.label} className={styles.downloadButton} disabled>
            {downloadItem.label}
          </button>
        ))}
      </div>
      <p className={styles.downloadTooltip}>
        Download from the legacy dashboard while migration is finalised.
      </p>

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

/** Admin Hub — configuration and developer tools for NodeToolbox administrators. */
export default function AdminHubView() {
  const { state, actions } = useAdminHubState()

  return (
    <div className={styles.adminHubView}>
      <header>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

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
    </div>
  )
}
