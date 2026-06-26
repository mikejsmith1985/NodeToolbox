// useAdminHubState.ts — State management hook for the Admin Hub configuration view.
//
// Manages proxy URLs, ART field settings, feature flags, and admin PIN unlock
// with session-persistent unlock state stored in sessionStorage.
// Also provides Diagnostics, Backup/Reset, Hygiene Rules, and Update Management.
//
// Advanced unlock (isAdvancedUnlocked) is a separate gate for the Feature Flags,
// Client Diagnostics, and Backup/Restore sections. It uses a passphrase stored in
// localStorage (tbxAdminPassphrase). When no passphrase is stored, any input unlocks.

import { useCallback, useRef, useState } from 'react'

import { useAdminStore } from '../../../store/adminStore.ts'
import type { ConnectivityConfigResult, ConnectionProbeResult } from '../../../types/config.ts'
import {
  fetchConnectivityConfig,
  saveConnectivityConfig,
  testSnowConnectivity,
  testGitHubConnectivity,
  testConfluenceConnectivity,
} from '../../../services/connectivityConfigApi.ts'

// ── Named constants ──

const JIRA_PROXY_URL_KEY = 'tbxJiraProxyUrl'
const SNOW_PROXY_URL_KEY = 'tbxSnowProxyUrl'
const GITHUB_PROXY_URL_KEY = 'tbxGithubProxyUrl'
const ART_SETTINGS_KEY = 'tbxARTSettings'
const FEATURE_SNOW_KEY = 'tbxFeatureSnowVisible'
const FEATURE_AI_KEY = 'tbxFeatureAIVisible'
/** Stored in sessionStorage so the unlock clears on browser close. */
const ADMIN_UNLOCK_SESSION_KEY = 'tbxAdminUnlocked'
/** Default credentials used when no credentialHash is configured in toolbox-proxy.json. */
const DEFAULT_ADMIN_USERNAME = 'admin'
const DEFAULT_ADMIN_PASSWORD = 'toolbox'
/** Error message shown in the Admin Hub lock form when the server rejects credentials. */
const ADMIN_UNLOCK_ERROR_MESSAGE = 'Incorrect credentials.'
const ADMIN_UNLOCK_NETWORK_ERROR_MESSAGE = 'Connection error — check that the server is running.'

/** sessionStorage key for the advanced section gate (Feature Flags, Diagnostics, Backup). */
const ADVANCED_UNLOCK_SESSION_KEY = 'tbxAdvancedUnlocked'
/** localStorage key where an optional admin passphrase is stored for the advanced gate. */
const ADVANCED_PASSPHRASE_STORAGE_KEY = 'tbxAdminPassphrase'

const SAVE_STATUS_SUCCESS = '✓ Saved'
const SAVE_STATUS_CLEAR_DELAY_MS = 2000
const UPDATE_REQUEST_TIMEOUT_MS = 600_000
const UPDATE_SHUTDOWN_TIMEOUT_MS = 30_000
const UPDATE_RESTART_TIMEOUT_MS = 180_000
const UPDATE_STATUS_POLL_INTERVAL_MS = 500
const UPDATE_STATUS_REQUEST_TIMEOUT_MS = 2_000
const UPDATE_INSTALL_PROGRESS_PREPARING = 15
const UPDATE_INSTALL_PROGRESS_WAITING_FOR_SHUTDOWN = 45
const UPDATE_INSTALL_PROGRESS_WAITING_FOR_STARTUP = 80
const UPDATE_INSTALL_PROGRESS_RELOADING = 100
const ADVANCED_UNLOCK_INCORRECT_PASSPHRASE_MESSAGE = 'Incorrect passphrase.'
const ADVANCED_UNLOCK_EXISTING_PROMPT_MESSAGE = 'Enter the admin passphrase to unlock advanced settings:'
const ADVANCED_UNLOCK_NEW_PROMPT_MESSAGE = 'Enter the admin passphrase to unlock advanced settings:'

/** localStorage key prefix used by all Hygiene Rules settings. */
const HYGIENE_STALE_DAYS_KEY = 'toolbox-hygiene-stale-days'
const HYGIENE_UNPOINTED_WARNING_DAYS_KEY = 'toolbox-hygiene-unpointed-warning-days'
const HYGIENE_FLAG_MISSING_ASSIGNEE_KEY = 'toolbox-hygiene-flag-missing-assignee'

/** localStorage key for ART teams (written by ART View, read here to build notification team list). */
const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams'

/** Prefix used to identify all Toolbox backup/settings keys in localStorage. */
const TOOLBOX_BACKUP_PREFIX = 'toolbox-'

/** Default number of days before a ticket is considered stale. */
export const DEFAULT_STALE_DAYS = 5

/** Default number of days before an unpointed ticket triggers a warning. */
export const DEFAULT_UNPOINTED_WARNING_DAYS = 7

// ── Type definitions ──

/** Proxy URL configuration for all supported backend services. */
export interface ProxyUrlConfig {
  jiraProxyUrl: string
  snowProxyUrl: string
  githubProxyUrl: string
}

/** ART-specific field IDs and current PI metadata. */
export interface ArtSettingsConfig {
  piFieldId: string
  sprintPointsFieldId: string
  featureLinkField: string
  piName: string
  piStartDate: string
  piEndDate: string
}

/** Feature flag toggles for optional integrations. */
export interface FeatureFlags {
  isSnowIntegrationEnabled: boolean
  isAiEnabled: boolean
}

/** Shape of the response from GET /api/diagnostics. */
export interface DiagnosticsResult {
  version: string
  nodeVersion: string
  uptime: number
  timestamp: string
  isPkgExe?: boolean
  platform?: string
  snow?: {
    baseUrl: string | null
    hasCredentials: boolean
    usernameMasked: string
    sessionActive: boolean
    sessionExpiresAt: string | null
  }
  relay?: {
    snowActive: boolean
    jiraActive: boolean
    snowLastRegisteredAt: number | null
    snowLastPolledAt: number | null
  }
  github?: {
    baseUrl: string
    hasPat: boolean
  }
}

/**
 * Threshold and flag settings that control how the DSU Board highlights hygiene issues.
 * Each field auto-saves to localStorage on change.
 */
export interface HygieneRules {
  staleDays: number
  unpointedWarningDays: number
  hasMissingAssigneeFlag: boolean
}

export interface NotificationTeamConfig {
  teamName: string
  projectKey: string
  confluenceSpaceKey: string
  targetBlogUrl: string
  triggerUrl: string
  triggerSecret: string
  scheduleTime: string
  isEnabled: boolean
}

/** Per-project configuration for the Feature Change (Epic-level) scheduled report. */
export interface FeatureChangeReportConfig {
  teamName: string
  projectKey: string
  /** Jira label used to identify this team's features: type = Feature AND labels in (jiraLabel). */
  jiraLabel: string
  confluenceSpaceKey: string
  targetBlogUrl: string
  triggerUrl: string
  triggerSecret: string
  scheduleTime: string
  isEnabled: boolean
}

/** Configuration for the ART-wide Feature Change Rollup — one combined report for all teams. */
export interface FeatureChangeArtRollupConfig {
  confluenceSpaceKey: string
  targetBlogUrl: string
  triggerUrl: string
  triggerSecret: string
  scheduleTime: string
  isEnabled: boolean
}

export interface NotificationArtRollupConfig {
  projectKeys: string[]
  teamNames: string[]
  confluenceSpaceKey: string
  targetBlogUrl: string
  triggerUrl: string
  triggerSecret: string
  scheduleTime: string
  isEnabled: boolean
}

/** One report's last delivery outcome, as persisted server-side and returned by the status endpoint. */
export interface DeliveryOutcome {
  status: 'delivered' | 'skipped' | 'error'
  message: string
  postUrl: string
  label: string
  trigger: string
  ranAt: string
}

/** Delivery outcomes grouped by scheduler name, then by report key (e.g. "team-0-ENFCT"). */
export interface DeliveryStatusMap {
  scopeChange?: Record<string, DeliveryOutcome>
  featureChange?: Record<string, DeliveryOutcome>
}

/** Shape of the response from GET /api/version-check. */
export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseNotes: string
}

/** All reactive state fields managed by this hook. */
export interface AdminHubState {
  proxyUrls: ProxyUrlConfig
  artSettings: ArtSettingsConfig
  featureFlags: FeatureFlags
  isAdminUnlocked: boolean
  adminUsername: string
  adminPinInput: string
  adminUnlockError: string | null
  proxySaveStatus: string | null
  artSaveStatus: string | null
  isAdvancedUnlockDialogOpen: boolean
  advancedUnlockPromptMessage: string
  advancedUnlockError: string | null
  isResetAllSettingsConfirmOpen: boolean
  // ── Diagnostics ──
  isDiagnosticsRunning: boolean
  diagnosticsResult: DiagnosticsResult | null
  diagnosticsError: string | null
  isDiagnosticsSectionCollapsed: boolean
  // ── Backup & Reset ──
  isBackupRestoring: boolean
  restoreError: string | null
  isBackupSectionCollapsed: boolean
  // ── Hygiene Rules ──
  hygieneRules: HygieneRules
  isHygieneSectionCollapsed: boolean
  // ── Update Management ──
  updateCheckResult: UpdateCheckResult | null
  updateCheckError: string | null
  isCheckingUpdate: boolean
  isInstallingUpdate: boolean
  updateInstallPhaseMessage: string | null
  updateInstallProgressPercent: number
  updateInstallError: string | null
  isUpdateSectionCollapsed: boolean
  // ── Advanced unlock (Feature Flags, Client Diagnostics, Backup/Restore) ──
  isAdvancedUnlocked: boolean
  // ── Service Connectivity ──
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
  // ── Notifications ──
  notificationTeamConfigs: NotificationTeamConfig[]
  notificationArtRollup: NotificationArtRollupConfig
  notificationsSaveStatus: string | null
  teamRunStatuses: (string | null)[]
  isTeamRunning: boolean[]
  isRollupRunning: boolean
  rollupRunStatus: string | null
  deliveryStatuses: DeliveryStatusMap
  // ── Feature Change Reports ──
  featureChangeConfigs: FeatureChangeReportConfig[]
  featureChangeSaveStatus: string | null
  featureRunStatuses: (string | null)[]
  isFeatureRunning: boolean[]
  // ── Feature Change ART Rollup ──
  featureChangeArtRollup: FeatureChangeArtRollupConfig
  isFeatureRollupRunning: boolean
  featureRollupRunStatus: string | null
}

/** All action callbacks returned by this hook. */
export interface AdminHubActions {
  setProxyUrl(service: 'jira' | 'snow' | 'github', url: string): void
  saveProxyUrls(): void
  setArtField(field: keyof ArtSettingsConfig, value: string): void
  saveArtSettings(): void
  toggleFeatureFlag(flagKey: keyof FeatureFlags): void
  setAdminPinInput(value: string): void
  setAdminUsername(value: string): void
  tryUnlock(): void
  lock(): void
  tryAdvancedUnlock(): void
  closeAdvancedUnlockDialog(): void
  submitAdvancedUnlock(passphrase: string): void
  clearAdvancedUnlockError(): void
  openResetAllSettingsDialog(): void
  closeResetAllSettingsDialog(): void
  // ── Diagnostics ──
  runDiagnostics(): Promise<void>
  setDiagnosticsSectionCollapsed(isCollapsed: boolean): void
  // ── Backup & Reset ──
  downloadBackup(): void
  triggerRestoreBackup(file: File): void
  resetAllSettings(): void
  setBackupSectionCollapsed(isCollapsed: boolean): void
  // ── Hygiene Rules ──
  updateHygieneRule<K extends keyof HygieneRules>(key: K, value: HygieneRules[K]): void
  setHygieneSectionCollapsed(isCollapsed: boolean): void
  // ── Update Management ──
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  setUpdateSectionCollapsed(isCollapsed: boolean): void
  // ── Advanced unlock ──
  advancedLock(): void
  // ── Service Connectivity ──
  loadConnectivityConfig(): Promise<void>
  saveSnowConfig(snow: { baseUrl: string; username: string; password: string }): Promise<void>
  saveGitHubConfig(github: { baseUrl: string; pat: string }): Promise<void>
  saveGitHubAppConfig(appCredentials: { appId: string; installationId: string; appPrivateKey: string }): Promise<void>
  saveConfluenceConfig(confluence: { baseUrl: string; username: string; apiToken: string }): Promise<void>
  testSnowConfig(): Promise<void>
  testGitHubConfig(): Promise<void>
  testConfluenceConfig(): Promise<void>
  // ── Notifications ──
  updateTeamConfig(index: number, field: keyof NotificationTeamConfig, value: string | boolean): void
  updateArtRollup(field: keyof NotificationArtRollupConfig, value: string | boolean | string[]): void
  loadNotificationConfigs(): Promise<void>
  saveNotificationsConfig(): Promise<void>
  runTeamNow(teamIndex: number): Promise<void>
  runRollupNow(): Promise<void>
  testWebhook(triggerUrl: string, triggerSecret?: string): Promise<{ ok: boolean; message: string }>
  // ── Feature Change Reports ──
  updateFeatureChangeConfig(index: number, field: keyof FeatureChangeReportConfig, value: string | boolean): void
  loadFeatureChangeConfigs(): Promise<void>
  saveFeatureChangeConfigs(): Promise<void>
  runFeatureNow(reportIndex: number): Promise<void>
  // ── Feature Change ART Rollup ──
  updateFeatureChangeArtRollup(field: keyof FeatureChangeArtRollupConfig, value: string | boolean): void
  runFeatureArtRollupNow(): Promise<void>
}

// ── Helper: safe localStorage reads ──

/** Reads a string from localStorage, returning the fallback on failure. */
function readLocalString(storageKey: string, fallbackValue = ''): string {
  try {
    return localStorage.getItem(storageKey) ?? fallbackValue
  } catch {
    return fallbackValue
  }
}

/** Reads a boolean flag stored as '1'/'0' from localStorage. */
function readLocalBoolFlag(storageKey: string): boolean {
  return readLocalString(storageKey, '0') === '1'
}

/** Reads and parses JSON from localStorage, returning the fallback on failure. */
function readLocalJson<ParsedType>(storageKey: string, fallbackValue: ParsedType): ParsedType {
  try {
    const rawValue = localStorage.getItem(storageKey)
    if (rawValue === null) return fallbackValue
    return JSON.parse(rawValue) as ParsedType
  } catch {
    return fallbackValue
  }
}

// ── Helper: initial state builders ──

/** Reads initial proxy URLs from localStorage. */
function buildInitialProxyUrls(): ProxyUrlConfig {
  return {
    jiraProxyUrl: readLocalString(JIRA_PROXY_URL_KEY),
    snowProxyUrl: readLocalString(SNOW_PROXY_URL_KEY),
    githubProxyUrl: readLocalString(GITHUB_PROXY_URL_KEY),
  }
}

const EMPTY_ART_SETTINGS: ArtSettingsConfig = {
  piFieldId: '',
  sprintPointsFieldId: '',
  featureLinkField: '',
  piName: '',
  piStartDate: '',
  piEndDate: '',
}

/** Reads initial ART settings from localStorage. */
function buildInitialArtSettings(): ArtSettingsConfig {
  const storedSettings = readLocalJson<Partial<ArtSettingsConfig>>(ART_SETTINGS_KEY, {})
  return { ...EMPTY_ART_SETTINGS, ...storedSettings }
}

/** Reads initial feature flags from localStorage. */
function buildInitialFeatureFlags(): FeatureFlags {
  return {
    isSnowIntegrationEnabled: readLocalBoolFlag(FEATURE_SNOW_KEY),
    isAiEnabled: readLocalBoolFlag(FEATURE_AI_KEY),
  }
}

/** Returns true if the admin session is currently unlocked. */
function readIsAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_UNLOCK_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

/** Returns true if the advanced gate session is currently unlocked. */
function readIsAdvancedUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ADVANCED_UNLOCK_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

/** Reads hygiene rule thresholds and flags from localStorage. */
function buildInitialHygieneRules(): HygieneRules {
  const rawStaleDays = parseInt(
    readLocalString(HYGIENE_STALE_DAYS_KEY, String(DEFAULT_STALE_DAYS)),
    10,
  )
  const rawUnpointedDays = parseInt(
    readLocalString(HYGIENE_UNPOINTED_WARNING_DAYS_KEY, String(DEFAULT_UNPOINTED_WARNING_DAYS)),
    10,
  )
  return {
    staleDays: isNaN(rawStaleDays) ? DEFAULT_STALE_DAYS : rawStaleDays,
    unpointedWarningDays: isNaN(rawUnpointedDays) ? DEFAULT_UNPOINTED_WARNING_DAYS : rawUnpointedDays,
    // Default true — missing assignee is almost always a problem worth flagging.
    hasMissingAssigneeFlag: readLocalString(HYGIENE_FLAG_MISSING_ASSIGNEE_KEY, '1') !== '0',
  }
}

/** Maps a HygieneRules key to its localStorage storage key. */
function resolveHygieneStorageKey(key: keyof HygieneRules): string | null {
  if (key === 'staleDays') return HYGIENE_STALE_DAYS_KEY
  if (key === 'unpointedWarningDays') return HYGIENE_UNPOINTED_WARNING_DAYS_KEY
  if (key === 'hasMissingAssigneeFlag') return HYGIENE_FLAG_MISSING_ASSIGNEE_KEY
  return null
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

interface ProxyStatusSnapshot {
  isResponsive: boolean
  version: string | null
}

async function readProxyStatusSnapshot(): Promise<ProxyStatusSnapshot> {
  try {
    const statusResponse = await fetch('/api/proxy-status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(UPDATE_STATUS_REQUEST_TIMEOUT_MS),
    })
    if (!statusResponse.ok) {
      return { isResponsive: false, version: null }
    }

    const statusPayload = (await statusResponse.json()) as { version?: unknown }
    return {
      isResponsive: true,
      version: typeof statusPayload.version === 'string' ? statusPayload.version : null,
    }
  } catch {
    return { isResponsive: false, version: null }
  }
}

async function waitForServerShutdown(restartDeadlineTimestamp: number): Promise<void> {
  const shutdownDeadlineTimestamp = Math.min(
    restartDeadlineTimestamp,
    Date.now() + UPDATE_SHUTDOWN_TIMEOUT_MS,
  )

  while (Date.now() < shutdownDeadlineTimestamp) {
    const proxyStatusSnapshot = await readProxyStatusSnapshot()
    if (!proxyStatusSnapshot.isResponsive) return
    await sleepFor(UPDATE_STATUS_POLL_INTERVAL_MS)
  }

  throw new Error('Server did not shut down after the update was accepted')
}

async function waitForServerStartup(
  restartDeadlineTimestamp: number,
  expectedVersion: string,
  maxWaitMs: number,
): Promise<void> {
  while (Date.now() < restartDeadlineTimestamp) {
    const proxyStatusSnapshot = await readProxyStatusSnapshot()
    const isExpectedVersionRunning =
      proxyStatusSnapshot.isResponsive && proxyStatusSnapshot.version === expectedVersion

    if (isExpectedVersionRunning) return
    await sleepFor(UPDATE_STATUS_POLL_INTERVAL_MS)
  }

  const restartTimeoutSeconds = Math.ceil(maxWaitMs / 1000)
  throw new Error(
    `Server did not restart on version ${expectedVersion} within ${restartTimeoutSeconds} seconds`,
  )
}

/**
 * Waits for the current server to go away and then for the replacement server to return.
 * This two-phase check prevents the updater from mistaking the old process or
 * the wrong version for a successful restart.
 */
export async function pollUntilServerRestarts(options: {
  expectedVersion: string
  maxWaitMs?: number
  onWaitingForStartup?(): void
}): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? UPDATE_RESTART_TIMEOUT_MS
  const restartDeadlineTimestamp = Date.now() + maxWaitMs
  await waitForServerShutdown(restartDeadlineTimestamp)
  options.onWaitingForStartup?.()
  await waitForServerStartup(restartDeadlineTimestamp, options.expectedVersion, maxWaitMs)
}

// ── Hook ──

/** Provides all reactive state and action callbacks for the Admin Hub view. */
export function useAdminHubState(): { state: AdminHubState; actions: AdminHubActions } {
  const [proxyUrls, setProxyUrls] = useState<ProxyUrlConfig>(buildInitialProxyUrls)
  const [artSettings, setArtSettings] = useState<ArtSettingsConfig>(buildInitialArtSettings)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(buildInitialFeatureFlags)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(readIsAdminUnlocked)
  const [isAdvancedUnlocked, setIsAdvancedUnlocked] = useState<boolean>(readIsAdvancedUnlocked)
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPinInput, setAdminPinInput] = useState('')
  const [adminUnlockError, setAdminUnlockError] = useState<string | null>(null)
  const [proxySaveStatus, setProxySaveStatus] = useState<string | null>(null)
  const [artSaveStatus, setArtSaveStatus] = useState<string | null>(null)
  const [isAdvancedUnlockDialogOpen, setIsAdvancedUnlockDialogOpen] = useState(false)
  const [advancedUnlockPromptMessage, setAdvancedUnlockPromptMessage] = useState('')
  const [advancedUnlockError, setAdvancedUnlockError] = useState<string | null>(null)
  const [isResetAllSettingsConfirmOpen, setIsResetAllSettingsConfirmOpen] = useState(false)

  // ── Diagnostics state ──
  const [isDiagnosticsRunning, setIsDiagnosticsRunning] = useState(false)
  const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosticsResult | null>(null)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [isDiagnosticsSectionCollapsed, setIsDiagnosticsSectionCollapsed] = useState(false)

  // ── Backup & Reset state ──
  const [isBackupRestoring, setIsBackupRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [isBackupSectionCollapsed, setIsBackupSectionCollapsed] = useState(false)

  // ── Hygiene Rules state ──
  const [hygieneRules, setHygieneRules] = useState<HygieneRules>(buildInitialHygieneRules)
  const [isHygieneSectionCollapsed, setIsHygieneSectionCollapsed] = useState(false)

  // ── Update Management state ──
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null)
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateInstallPhaseMessage, setUpdateInstallPhaseMessage] = useState<string | null>(null)
  const [updateInstallProgressPercent, setUpdateInstallProgressPercent] = useState(0)
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null)
  const [isUpdateSectionCollapsed, setIsUpdateSectionCollapsed] = useState(false)

  // ── Service Connectivity state ──
  const [connectivityConfig, setConnectivityConfig] = useState<ConnectivityConfigResult | null>(null)
  const [isConnectivityConfigLoading, setConnectivityConfigLoading] = useState(false)
  const [connectivityConfigError, setConnectivityConfigError] = useState<string | null>(null)
  const [connectivitySaveStatus, setConnectivitySaveStatus] = useState<string | null>(null)
  const [snowTestResult, setSnowTestResult] = useState<ConnectionProbeResult | null>(null)
  const [isSnowTesting, setSnowTesting] = useState(false)
  const [githubTestResult, setGitHubTestResult] = useState<ConnectionProbeResult | null>(null)
  const [isGitHubTesting, setGitHubTesting] = useState(false)
  const [confluenceTestResult, setConfluenceTestResult] = useState<ConnectionProbeResult | null>(null)
  const [isConfluenceTesting, setConfluenceTesting] = useState(false)

  // ── Notifications state ──
  const [notificationTeamConfigs, setNotificationTeamConfigs] = useState<NotificationTeamConfig[]>([])
  const [notificationArtRollup, setNotificationArtRollup] = useState<NotificationArtRollupConfig>({
    projectKeys: [], teamNames: [], confluenceSpaceKey: '', targetBlogUrl: '', triggerUrl: '', triggerSecret: '', scheduleTime: '09:00', isEnabled: false,
  })
  const [notificationsSaveStatus, setNotificationsSaveStatus] = useState<string | null>(null)
  const [teamRunStatuses, setTeamRunStatuses] = useState<(string | null)[]>([])
  const [isTeamRunning, setIsTeamRunning] = useState<boolean[]>([])
  const [isRollupRunning, setIsRollupRunning] = useState(false)
  const [rollupRunStatus, setRollupRunStatus] = useState<string | null>(null)
  // Last persisted delivery outcome per report (scheduled or manual), keyed by scheduler → reportKey.
  const [deliveryStatuses, setDeliveryStatuses] = useState<DeliveryStatusMap>({})

  // ── Feature Change Reports state ──
  const [featureChangeConfigs, setFeatureChangeConfigs] = useState<FeatureChangeReportConfig[]>([])
  const [featureChangeSaveStatus, setFeatureChangeSaveStatus] = useState<string | null>(null)
  const [featureRunStatuses, setFeatureRunStatuses] = useState<(string | null)[]>([])
  const [isFeatureRunning, setIsFeatureRunning] = useState<boolean[]>([])

  // ── Feature Change ART Rollup state ──
  const [featureChangeArtRollup, setFeatureChangeArtRollup] = useState<FeatureChangeArtRollupConfig>({
    confluenceSpaceKey: '', targetBlogUrl: '', triggerUrl: '', triggerSecret: '', scheduleTime: '09:00', isEnabled: false,
  })
  const [isFeatureRollupRunning, setIsFeatureRollupRunning] = useState(false)
  const [featureRollupRunStatus, setFeatureRollupRunStatus] = useState<string | null>(null)

  // Refs give callbacks synchronous access to latest state values even within
  // the same React batched-update cycle (e.g. setX then readX in one act() call).
  const proxyUrlsRef = useRef(proxyUrls)
  const adminPinInputRef = useRef(adminPinInput)
  const adminUsernameRef = useRef(adminUsername)

  const state: AdminHubState = {
    proxyUrls,
    artSettings,
    featureFlags,
    isAdminUnlocked,
    adminUsername,
    adminPinInput,
    adminUnlockError,
    proxySaveStatus,
    artSaveStatus,
    isAdvancedUnlockDialogOpen,
    advancedUnlockPromptMessage,
    advancedUnlockError,
    isResetAllSettingsConfirmOpen,
    isDiagnosticsRunning,
    diagnosticsResult,
    diagnosticsError,
    isDiagnosticsSectionCollapsed,
    isBackupRestoring,
    restoreError,
    isBackupSectionCollapsed,
    hygieneRules,
    isHygieneSectionCollapsed,
    updateCheckResult,
    updateCheckError,
    isCheckingUpdate,
    isInstallingUpdate,
    updateInstallPhaseMessage,
    updateInstallProgressPercent,
    updateInstallError,
    isUpdateSectionCollapsed,
    isAdvancedUnlocked,
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
    notificationTeamConfigs,
    notificationArtRollup,
    notificationsSaveStatus,
    teamRunStatuses,
    isTeamRunning,
    isRollupRunning,
    rollupRunStatus,
    deliveryStatuses,
    featureChangeConfigs,
    featureChangeSaveStatus,
    featureRunStatuses,
    isFeatureRunning,
    featureChangeArtRollup,
    isFeatureRollupRunning,
    featureRollupRunStatus,
  }

  const setProxyUrl = useCallback(
    (service: 'jira' | 'snow' | 'github', url: string) => {
      setProxyUrls((currentUrls) => {
        let nextUrls: ProxyUrlConfig
        if (service === 'jira') nextUrls = { ...currentUrls, jiraProxyUrl: url }
        else if (service === 'snow') nextUrls = { ...currentUrls, snowProxyUrl: url }
        else nextUrls = { ...currentUrls, githubProxyUrl: url }
        // Keep ref synchronised so saveProxyUrls can read it immediately.
        proxyUrlsRef.current = nextUrls
        return nextUrls
      })
    },
    [],
  )

  const saveProxyUrls = useCallback(() => {
    // Read from ref to get the most current value — avoids stale closure
    // when this function is called in the same React batch as setProxyUrl.
    const currentUrls = proxyUrlsRef.current
    try {
      if (currentUrls.jiraProxyUrl !== '')
        localStorage.setItem(JIRA_PROXY_URL_KEY, currentUrls.jiraProxyUrl)
      if (currentUrls.snowProxyUrl !== '')
        localStorage.setItem(SNOW_PROXY_URL_KEY, currentUrls.snowProxyUrl)
      if (currentUrls.githubProxyUrl !== '')
        localStorage.setItem(GITHUB_PROXY_URL_KEY, currentUrls.githubProxyUrl)
    } catch {
      // Storage write failure is non-fatal — UI still reflects the in-memory state.
    }
    setProxySaveStatus(SAVE_STATUS_SUCCESS)
    setTimeout(() => setProxySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
  }, [])

  const setArtField = useCallback(
    (field: keyof ArtSettingsConfig, value: string) => {
      setArtSettings((currentSettings) => ({ ...currentSettings, [field]: value }))
    },
    [],
  )

  const saveArtSettings = useCallback(() => {
    try {
      // Read existing ART settings, merge in the new values, then write back.
      const existingSettings = readLocalJson<Record<string, unknown>>(ART_SETTINGS_KEY, {})
      const mergedSettings = { ...existingSettings, ...artSettings }
      localStorage.setItem(ART_SETTINGS_KEY, JSON.stringify(mergedSettings))
    } catch {
      // Storage write failure is non-fatal.
    }
    setArtSaveStatus(SAVE_STATUS_SUCCESS)
    setTimeout(() => setArtSaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
  }, [artSettings])

  const toggleFeatureFlag = useCallback(
    (flagKey: keyof FeatureFlags) => {
      setFeatureFlags((currentFlags) => {
        const nextFlagValue = !currentFlags[flagKey]
        // Persist the new flag value to localStorage as '1' or '0'.
        const storageKey = flagKey === 'isSnowIntegrationEnabled' ? FEATURE_SNOW_KEY : FEATURE_AI_KEY
        try {
          localStorage.setItem(storageKey, nextFlagValue ? '1' : '0')
        } catch {
          // Non-fatal storage error.
        }
        return { ...currentFlags, [flagKey]: nextFlagValue }
      })
    },
    [],
  )

  /**
   * Sends the entered credentials to the server for verification.
   * On success, sets isAdminUnlocked and stores the session flag.
   * On failure, sets adminUnlockError so the UI can display a message.
   * Falls back to default credentials (admin / toolbox) when the server has
   * no credentialHash configured — covers first-time users.
   */
  const tryUnlock = useCallback(() => {
    const usernameToSubmit = adminUsernameRef.current || DEFAULT_ADMIN_USERNAME
    const passwordToSubmit = adminPinInputRef.current || DEFAULT_ADMIN_PASSWORD

    fetch('/api/admin-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameToSubmit, password: passwordToSubmit }),
    })
      .then((response) => {
        if (response.ok) {
          setIsAdminUnlocked(true)
          setAdminUnlockError(null)
          try {
            sessionStorage.setItem(ADMIN_UNLOCK_SESSION_KEY, '1')
          } catch {
            // Non-fatal storage error.
          }
          // Sync the shared store so other components (e.g. ConnectionBar) react immediately.
          useAdminStore.setState({ isAdminUnlocked: true })
        } else {
          setAdminUnlockError(ADMIN_UNLOCK_ERROR_MESSAGE)
        }
      })
      .catch(() => {
        setAdminUnlockError(ADMIN_UNLOCK_NETWORK_ERROR_MESSAGE)
      })
  }, [])

  const lock = useCallback(() => {
    setIsAdminUnlocked(false)
    try {
      sessionStorage.removeItem(ADMIN_UNLOCK_SESSION_KEY)
    } catch {
      // Non-fatal storage error.
    }
    // Sync the shared store so other components (e.g. ConnectionBar) react immediately.
    useAdminStore.setState({ isAdminUnlocked: false })
  }, [])

  // ── Diagnostics actions ──

  /** Fetches live diagnostic data from the server and stores the result in state. */
  const runDiagnostics = useCallback(async () => {
    setIsDiagnosticsRunning(true)
    setDiagnosticsError(null)
    try {
      const response = await fetch('/api/diagnostics')
      if (!response.ok) throw new Error(`Server returned ${response.status}`)
      const data = (await response.json()) as DiagnosticsResult
      setDiagnosticsResult(data)
    } catch (fetchError) {
      setDiagnosticsError(
        fetchError instanceof Error ? fetchError.message : 'Unknown error',
      )
    } finally {
      setIsDiagnosticsRunning(false)
    }
  }, [])

  // ── Backup & Reset actions ──

  /**
   * Collects all localStorage keys starting with 'toolbox-' and triggers a
   * JSON file download named toolbox-backup-YYYY-MM-DD.json.
   */
  const downloadBackup = useCallback(() => {
    const backupData: Record<string, string> = {}
    for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
      const storageKey = localStorage.key(storageIndex)
      if (storageKey !== null && storageKey.startsWith(TOOLBOX_BACKUP_PREFIX)) {
        backupData[storageKey] = localStorage.getItem(storageKey) ?? ''
      }
    }
    const jsonString = JSON.stringify(backupData, null, 2)
    const todayDate = new Date().toISOString().slice(0, 10)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const downloadUrl = URL.createObjectURL(blob)
    const anchorElement = document.createElement('a')
    anchorElement.href = downloadUrl
    anchorElement.download = `toolbox-backup-${todayDate}.json`
    anchorElement.click()
    URL.revokeObjectURL(downloadUrl)
  }, [])

  /**
   * Reads the given File as text, parses it as JSON, and writes each
   * 'toolbox-*' key back to localStorage before reloading the page.
   */
  const triggerRestoreBackup = useCallback((file: File) => {
    setIsBackupRestoring(true)
    setRestoreError(null)
    const fileReader = new FileReader()
    fileReader.onload = (loadEvent) => {
      try {
        const rawText = loadEvent.target?.result as string
        const parsedData = JSON.parse(rawText) as unknown
        if (
          typeof parsedData !== 'object' ||
          parsedData === null ||
          Array.isArray(parsedData)
        ) {
          throw new Error('Backup file must contain a plain JSON object')
        }
        for (const [restoreKey, restoreValue] of Object.entries(
          parsedData as Record<string, unknown>,
        )) {
          if (typeof restoreValue === 'string') {
            localStorage.setItem(restoreKey, restoreValue)
          }
        }
        window.location.reload()
      } catch (parseError) {
        setRestoreError(
          parseError instanceof Error ? parseError.message : 'Invalid backup file',
        )
        setIsBackupRestoring(false)
      }
    }
    fileReader.onerror = () => {
      setRestoreError('Failed to read file')
      setIsBackupRestoring(false)
    }
    fileReader.readAsText(file)
  }, [])

  /**
   * Prompts the user for confirmation, then removes every 'toolbox-' key from
   * localStorage and reloads the page to apply the reset.
   */
  const openResetAllSettingsDialog = useCallback(() => {
    setIsResetAllSettingsConfirmOpen(true)
  }, [])

  const closeResetAllSettingsDialog = useCallback(() => {
    setIsResetAllSettingsConfirmOpen(false)
  }, [])

  const resetAllSettings = useCallback(() => {
    setIsResetAllSettingsConfirmOpen(false)
    const keysToRemove: string[] = []
    for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
      const storageKey = localStorage.key(storageIndex)
      if (storageKey !== null && storageKey.startsWith(TOOLBOX_BACKUP_PREFIX)) {
        keysToRemove.push(storageKey)
      }
    }
    for (const keyToRemove of keysToRemove) {
      localStorage.removeItem(keyToRemove)
    }
    window.location.reload()
  }, [])

  // ── Hygiene Rules actions ──

  /**
   * Updates a single hygiene rule in state and persists it to localStorage.
   * Booleans are stored as '1'/'0'; numbers and strings are stored as-is.
   */
  const updateHygieneRule = useCallback(
    <K extends keyof HygieneRules>(key: K, value: HygieneRules[K]) => {
      setHygieneRules((currentRules) => {
        const nextRules = { ...currentRules, [key]: value }
        const storageKey = resolveHygieneStorageKey(key)
        if (storageKey !== null) {
          try {
            // Store booleans as '1'/'0' to match the read convention.
            const storageValue =
              typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
            localStorage.setItem(storageKey, storageValue)
          } catch {
            // Non-fatal storage error.
          }
        }
        return nextRules
      })
    },
    [],
  )

  // ── Update Management actions ──

  /** Calls the server version-check endpoint and stores the result in state. */
  const checkForUpdates = useCallback(async () => {
    setIsCheckingUpdate(true)
    setUpdateCheckError(null)
    try {
      const response = await fetch('/api/version-check')
      if (!response.ok) throw new Error(`Server returned ${response.status}`)
      const data = (await response.json()) as UpdateCheckResult
      setUpdateCheckResult(data)
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : 'Unknown error'
      setUpdateCheckError(`Could not check for updates: ${errorMessage}`)
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [])

  /**
   * Triggers the server-side update process and waits for the server to restart.
   * After the server comes back online, the page reloads to run the new version.
   */
  const installUpdate = useCallback(async () => {
    if (updateCheckResult === null || !updateCheckResult.hasUpdate) return
    setIsInstallingUpdate(true)
    setUpdateInstallError(null)
    setUpdateInstallPhaseMessage('Preparing the update package download…')
    setUpdateInstallProgressPercent(UPDATE_INSTALL_PROGRESS_PREPARING)
    try {
      const updateResponse = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: updateCheckResult.latestVersion }),
        signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
      })
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        throw new Error(`Server returned ${updateResponse.status}: ${errorText}`)
      }
      // The server shuts down during the update — poll until it comes back.
      setUpdateInstallPhaseMessage('Waiting for the current server to stop…')
      setUpdateInstallProgressPercent(UPDATE_INSTALL_PROGRESS_WAITING_FOR_SHUTDOWN)
      await pollUntilServerRestarts({
        expectedVersion: updateCheckResult.latestVersion,
        onWaitingForStartup: () => {
          setUpdateInstallPhaseMessage('Waiting for the updated server to restart…')
          setUpdateInstallProgressPercent(UPDATE_INSTALL_PROGRESS_WAITING_FOR_STARTUP)
        },
      })
      setUpdateInstallPhaseMessage('Reloading the updated app…')
      setUpdateInstallProgressPercent(UPDATE_INSTALL_PROGRESS_RELOADING)
      window.location.reload()
    } catch (installError) {
      const errorMessage = installError instanceof Error ? installError.message : 'Unknown error'
      setUpdateInstallError(
        `Update failed: ${errorMessage}. Please restart NodeToolbox manually.`,
      )
      setIsInstallingUpdate(false)
      setUpdateInstallPhaseMessage(null)
      setUpdateInstallProgressPercent(0)
    }
  }, [updateCheckResult])

  /**
   * Prompts the user for the admin passphrase to unlock the advanced sections.
   * If no passphrase is stored in localStorage, any non-null response unlocks.
   */
  const tryAdvancedUnlock = useCallback(() => {
    const storedPassphrase = localStorage.getItem(ADVANCED_PASSPHRASE_STORAGE_KEY)
    setAdvancedUnlockPromptMessage(
      storedPassphrase ? ADVANCED_UNLOCK_EXISTING_PROMPT_MESSAGE : ADVANCED_UNLOCK_NEW_PROMPT_MESSAGE,
    )
    setAdvancedUnlockError(null)
    setIsAdvancedUnlockDialogOpen(true)
  }, [])

  const closeAdvancedUnlockDialog = useCallback(() => {
    setIsAdvancedUnlockDialogOpen(false)
  }, [])

  const submitAdvancedUnlock = useCallback((passphrase: string) => {
    const storedPassphrase = localStorage.getItem(ADVANCED_PASSPHRASE_STORAGE_KEY)

    if (storedPassphrase === null || passphrase === storedPassphrase) {
      sessionStorage.setItem(ADVANCED_UNLOCK_SESSION_KEY, '1')
      setIsAdvancedUnlocked(true)
      setIsAdvancedUnlockDialogOpen(false)
      setAdvancedUnlockError(null)
      return
    }

    setAdvancedUnlockError(ADVANCED_UNLOCK_INCORRECT_PASSPHRASE_MESSAGE)
  }, [])

  const clearAdvancedUnlockError = useCallback(() => {
    setAdvancedUnlockError(null)
  }, [])

  /** Clears the advanced unlock session state. */
  const advancedLock = useCallback(() => {
    sessionStorage.removeItem(ADVANCED_UNLOCK_SESSION_KEY)
    setIsAdvancedUnlocked(false)
    setIsAdvancedUnlockDialogOpen(false)
    setAdvancedUnlockError(null)
  }, [])

  // ── Service Connectivity actions ──

  /** Fetches the current Snow and GitHub connectivity config from the server. */
  const loadConnectivityConfig = useCallback(async () => {
    setConnectivityConfigLoading(true)
    setConnectivityConfigError(null)
    try {
      const config = await fetchConnectivityConfig()
      setConnectivityConfig(config)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load config.'
      setConnectivityConfigError(message)
    } finally {
      setConnectivityConfigLoading(false)
    }
  }, [])

  /** Saves updated Snow connectivity settings and refreshes the displayed config. */
  const saveSnowConfig = useCallback(async (snow: { baseUrl: string; username: string; password: string }) => {
    try {
      const savedConfig = await saveConnectivityConfig({ snow })
      setConnectivityConfig(savedConfig)
      setConnectivitySaveStatus('✓ Saved')
      setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
    } catch {
      setConnectivitySaveStatus('❌ Save failed')
      setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
    }
  }, [])

  /** Saves updated GitHub connectivity settings and refreshes the displayed config. */
  const saveGitHubConfig = useCallback(async (github: { baseUrl: string; pat: string }) => {
    try {
      const savedConfig = await saveConnectivityConfig({ github })
      setConnectivityConfig(savedConfig)
      setConnectivitySaveStatus('✓ Saved')
      setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
    } catch {
      setConnectivitySaveStatus('❌ Save failed')
      setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
    }
  }, [])

  /** Saves GitHub App credentials (appId, installationId, appPrivateKey) and refreshes config. */
  const saveGitHubAppConfig = useCallback(
    async (appCredentials: { appId: string; installationId: string; appPrivateKey: string }) => {
      try {
        const savedConfig = await saveConnectivityConfig({ github: appCredentials })
        setConnectivityConfig(savedConfig)
        setConnectivitySaveStatus('✓ Saved')
        setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
      } catch {
        setConnectivitySaveStatus('❌ Save failed')
        setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
      }
    },
    [],
  )

  /** Runs a live connectivity probe against the configured Snow instance. */
  const testSnowConfig = useCallback(async () => {
    setSnowTesting(true)
    setSnowTestResult(null)
    try {
      const probeResult = await testSnowConnectivity()
      setSnowTestResult(probeResult)
    } catch {
      setSnowTestResult({ isOk: false, statusCode: 0, message: 'Test request failed.' })
    } finally {
      setSnowTesting(false)
    }
  }, [])

  /** Runs a live connectivity probe against the configured GitHub API. */
  const testGitHubConfig = useCallback(async () => {
    setGitHubTesting(true)
    setGitHubTestResult(null)
    try {
      const probeResult = await testGitHubConnectivity()
      setGitHubTestResult(probeResult)
    } catch {
      setGitHubTestResult({ isOk: false, statusCode: 0, message: 'Test request failed.' })
    } finally {
      setGitHubTesting(false)
    }
  }, [])

  /** Saves Confluence credentials to the server and refreshes the displayed config. */
  const saveConfluenceConfig = useCallback(async (
    confluence: { baseUrl: string; username: string; apiToken: string },
  ) => {
    try {
      const update: import('../../../types/config.ts').ConnectivityConfigUpdate = {
        confluence: {
          ...(confluence.baseUrl                  && { baseUrl:   confluence.baseUrl.trim()   }),
          ...(confluence.username.trim()           && { username:  confluence.username.trim()  }),
          ...(confluence.apiToken.trim()           && { apiToken:  confluence.apiToken.trim()  }),
        },
      }
      const savedConfig = await saveConnectivityConfig(update)
      setConnectivityConfig(savedConfig)
      setConnectivitySaveStatus('✓ Saved')
      setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
    } catch {
      setConnectivitySaveStatus('❌ Save failed')
      setTimeout(() => setConnectivitySaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
    }
  }, [])

  /** Runs a live connectivity probe against the configured Confluence Cloud instance. */
  const testConfluenceConfig = useCallback(async () => {
    setConfluenceTesting(true)
    setConfluenceTestResult(null)
    try {
      const probeResult = await testConfluenceConnectivity()
      setConfluenceTestResult(probeResult)
    } catch {
      setConfluenceTestResult({ isOk: false, statusCode: 0, message: 'Test request failed.' })
    } finally {
      setConfluenceTesting(false)
    }
  }, [])

  /** Fetches the last delivery outcome for every report so each row can show its status. */
  const refreshDeliveryStatuses = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/delivery-status')
      if (response.ok) {
        setDeliveryStatuses(await response.json() as DeliveryStatusMap)
      }
    } catch {
      // Status is best-effort — a fetch failure just leaves the rows without a "last run" line.
    }
  }, [])

  /** Loads ART teams from localStorage and merges with saved server notification config. */
  const loadNotificationConfigs = useCallback(async () => {
    // Read ART teams from localStorage
    let artTeams: Array<{ id: string; name: string; projectKey?: string }> = []
    try {
      const raw = localStorage.getItem(ART_TEAMS_STORAGE_KEY)
      if (raw) artTeams = JSON.parse(raw)
    } catch {
      // Ignore parse errors — start with empty list
    }

    const teamsWithKeys = artTeams.filter((team) => team.projectKey && team.projectKey.trim() !== '')

    // Fetch saved server config and merge per projectKey
    let savedTeamReports: NotificationTeamConfig[] = []
    let savedArtRollup: NotificationArtRollupConfig | null = null
    try {
      const response = await fetch('/api/notifications/config')
      if (response.ok) {
        const serverConfig = await response.json() as { teamReports: NotificationTeamConfig[]; artRollup: NotificationArtRollupConfig }
        savedTeamReports = serverConfig.teamReports || []
        savedArtRollup   = serverConfig.artRollup   || null
      }
    } catch {
      // Server config unavailable — use defaults
    }

    // Merge: one row per ART team, overlay saved config where projectKey matches
    const mergedTeams: NotificationTeamConfig[] = teamsWithKeys.map((artTeam) => {
      const saved = savedTeamReports.find((saved) => saved.projectKey === artTeam.projectKey)
      return {
        teamName:           artTeam.name,
        projectKey:         artTeam.projectKey!,
        confluenceSpaceKey: saved?.confluenceSpaceKey ?? '',
        targetBlogUrl:      saved?.targetBlogUrl      ?? '',
        triggerUrl:         saved?.triggerUrl         ?? '',
        triggerSecret:      saved?.triggerSecret      ?? '',
        scheduleTime:       saved?.scheduleTime       ?? '11:00',
        isEnabled:          saved?.isEnabled          ?? false,
      }
    })

    setNotificationTeamConfigs(mergedTeams)
    setTeamRunStatuses(mergedTeams.map(() => null))
    setIsTeamRunning(mergedTeams.map(() => false))

    if (savedArtRollup) {
      // Update project keys and team names from current ART teams (they may have changed)
      setNotificationArtRollup({
        ...savedArtRollup,
        projectKeys: teamsWithKeys.map((t) => t.projectKey!),
        teamNames:   teamsWithKeys.map((t) => t.name),
      })
    } else {
      setNotificationArtRollup((prev) => ({
        ...prev,
        projectKeys: teamsWithKeys.map((t) => t.projectKey!),
        teamNames:   teamsWithKeys.map((t) => t.name),
      }))
    }

    void refreshDeliveryStatuses()
  }, [refreshDeliveryStatuses])

  /** Updates a single field on a team config row. */
  const updateTeamConfig = useCallback((index: number, field: keyof NotificationTeamConfig, value: string | boolean) => {
    setNotificationTeamConfigs((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  /** Updates a single field on the ART rollup config. */
  const updateArtRollup = useCallback((field: keyof NotificationArtRollupConfig, value: string | boolean | string[]) => {
    setNotificationArtRollup((prev) => ({ ...prev, [field]: value }))
  }, [])

  /** Saves the full multi-team notification config to the server. */
  const saveNotificationsConfig = useCallback(async () => {
    try {
      await fetch('/api/notifications/config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ teamReports: notificationTeamConfigs, artRollup: notificationArtRollup }),
      })
      setNotificationsSaveStatus(SAVE_STATUS_SUCCESS)
    } catch {
      setNotificationsSaveStatus('❌ Save failed')
    }
    setTimeout(() => setNotificationsSaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
  }, [notificationTeamConfigs, notificationArtRollup])

  /** Triggers an immediate run for one team report. */
  const runTeamNow = useCallback(async (teamIndex: number) => {
    setIsTeamRunning((prev) => { const next = [...prev]; next[teamIndex] = true; return next })
    setTeamRunStatuses((prev) => { const next = [...prev]; next[teamIndex] = null; return next })
    try {
      const response = await fetch('/api/notifications/run-team', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ teamIndex }),
      })
      const data = await response.json() as { ok: boolean; skipped?: boolean; message?: string; postUrl?: string }
      if (!data.ok) {
        setTeamRunStatuses((prev) => { const next = [...prev]; next[teamIndex] = '❌ ' + (data.message ?? 'Error'); return next })
      } else if (data.skipped) {
        setTeamRunStatuses((prev) => { const next = [...prev]; next[teamIndex] = 'ℹ No changes found'; return next })
      } else {
        setTeamRunStatuses((prev) => { const next = [...prev]; next[teamIndex] = '✓ Delivered'; return next })
      }
    } catch {
      setTeamRunStatuses((prev) => { const next = [...prev]; next[teamIndex] = '❌ Network error'; return next })
    } finally {
      setIsTeamRunning((prev) => { const next = [...prev]; next[teamIndex] = false; return next })
      void refreshDeliveryStatuses()
    }
  }, [refreshDeliveryStatuses])

  /** POSTs a test payload to the given trigger URL to verify webhook plumbing. */
  const testWebhook = useCallback(async (triggerUrl: string, triggerSecret?: string): Promise<{ ok: boolean; message: string }> => {
    try {
      const response = await fetch('/api/notifications/test-webhook', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ triggerUrl, triggerSecret }),
      })
      const data = await response.json() as { ok: boolean; message?: string; httpStatus?: number; body?: string }
      if (data.ok) {
        return { ok: true, message: `✓ Webhook accepted (HTTP ${data.httpStatus ?? '2xx'})` }
      }
      const detail = data.body ? ` — ${data.body.slice(0, 120)}` : ''
      return { ok: false, message: `❌ HTTP ${data.httpStatus ?? '?'}${detail || (data.message ? ` — ${data.message}` : '')}` }
    } catch {
      return { ok: false, message: '❌ Network error — server unreachable' }
    }
  }, [])

  // ── Feature Change Reports actions ──

  /** Loads ART teams from localStorage and merges with saved feature change config. */
  const loadFeatureChangeConfigs = useCallback(async () => {
    let artTeams: Array<{ id: string; name: string; projectKey?: string; jiraLabel?: string }> = []
    try {
      const raw = localStorage.getItem(ART_TEAMS_STORAGE_KEY)
      if (raw) artTeams = JSON.parse(raw)
    } catch {
      // Ignore parse errors
    }

    // Feature Change is label-driven — only teams with a jiraLabel can generate a report.
    const teamsWithLabels = artTeams.filter((team) => team.jiraLabel && team.jiraLabel.trim() !== '')

    let savedReports: FeatureChangeReportConfig[] = []
    let savedArtRollup: Partial<FeatureChangeArtRollupConfig> = {}
    try {
      const response = await fetch('/api/notifications/feature-change-config')
      if (response.ok) {
        const serverConfig = await response.json() as { reports: FeatureChangeReportConfig[]; artRollup?: Partial<FeatureChangeArtRollupConfig> }
        savedReports   = serverConfig.reports   || []
        savedArtRollup = serverConfig.artRollup || {}
      }
    } catch {
      // Server config unavailable — use defaults
    }

    setFeatureChangeArtRollup({
      confluenceSpaceKey: savedArtRollup.confluenceSpaceKey ?? '',
      targetBlogUrl:      savedArtRollup.targetBlogUrl      ?? '',
      triggerUrl:         savedArtRollup.triggerUrl         ?? '',
      triggerSecret:      savedArtRollup.triggerSecret      ?? '',
      scheduleTime:       savedArtRollup.scheduleTime       ?? '09:00',
      isEnabled:          savedArtRollup.isEnabled          ?? false,
    })

    const mergedConfigs: FeatureChangeReportConfig[] = teamsWithLabels.map((artTeam) => {
      const trimmedLabel = artTeam.jiraLabel!.trim()
      // Match saved config by jiraLabel first; fall back to projectKey for configs saved before the label migration.
      const saved = savedReports.find((report) => report.jiraLabel === trimmedLabel)
        ?? savedReports.find((report) => report.projectKey === artTeam.projectKey)
      return {
        teamName:           artTeam.name,
        projectKey:         artTeam.projectKey ?? '',
        jiraLabel:          trimmedLabel,
        confluenceSpaceKey: saved?.confluenceSpaceKey ?? '',
        targetBlogUrl:      saved?.targetBlogUrl      ?? '',
        triggerUrl:         saved?.triggerUrl         ?? '',
        triggerSecret:      saved?.triggerSecret      ?? '',
        scheduleTime:       saved?.scheduleTime       ?? '09:00',
        isEnabled:          saved?.isEnabled          ?? false,
      }
    })

    setFeatureChangeConfigs(mergedConfigs)
    setFeatureRunStatuses(mergedConfigs.map(() => null))
    setIsFeatureRunning(mergedConfigs.map(() => false))

    void refreshDeliveryStatuses()
  }, [refreshDeliveryStatuses])

  /** Updates a single field on a feature change config row. */
  const updateFeatureChangeConfig = useCallback((
    index: number,
    field: keyof FeatureChangeReportConfig,
    value: string | boolean,
  ) => {
    setFeatureChangeConfigs((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  /** Saves the full feature change config (per-team reports + ART rollup) to the server. */
  const saveFeatureChangeConfigs = useCallback(async () => {
    try {
      await fetch('/api/notifications/feature-change-config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reports: featureChangeConfigs, artRollup: featureChangeArtRollup }),
      })
      setFeatureChangeSaveStatus(SAVE_STATUS_SUCCESS)
    } catch {
      setFeatureChangeSaveStatus('❌ Save failed')
    }
    setTimeout(() => setFeatureChangeSaveStatus(null), SAVE_STATUS_CLEAR_DELAY_MS)
  }, [featureChangeConfigs, featureChangeArtRollup])

  /** Triggers an immediate run for one feature change report. */
  const runFeatureNow = useCallback(async (reportIndex: number) => {
    setIsFeatureRunning((prev) => { const next = [...prev]; next[reportIndex] = true; return next })
    setFeatureRunStatuses((prev) => { const next = [...prev]; next[reportIndex] = null; return next })
    try {
      const response = await fetch('/api/notifications/run-feature', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reportIndex }),
      })
      const data = await response.json() as { ok: boolean; skipped?: boolean; message?: string; postUrl?: string }
      if (!data.ok) {
        setFeatureRunStatuses((prev) => { const next = [...prev]; next[reportIndex] = '❌ ' + (data.message ?? 'Error'); return next })
      } else if (data.skipped) {
        setFeatureRunStatuses((prev) => { const next = [...prev]; next[reportIndex] = 'ℹ No changes found'; return next })
      } else {
        setFeatureRunStatuses((prev) => { const next = [...prev]; next[reportIndex] = '✓ Delivered'; return next })
      }
    } catch {
      setFeatureRunStatuses((prev) => { const next = [...prev]; next[reportIndex] = '❌ Network error'; return next })
    } finally {
      setIsFeatureRunning((prev) => { const next = [...prev]; next[reportIndex] = false; return next })
      void refreshDeliveryStatuses()
    }
  }, [refreshDeliveryStatuses])

  /** Updates a single field on the Feature Change ART Rollup config. */
  const updateFeatureChangeArtRollup = useCallback((
    field: keyof FeatureChangeArtRollupConfig,
    value: string | boolean,
  ) => {
    setFeatureChangeArtRollup((prev) => ({ ...prev, [field]: value }))
  }, [])

  /** Triggers an immediate Feature Change ART Rollup delivery (all teams combined). */
  const runFeatureArtRollupNow = useCallback(async () => {
    setIsFeatureRollupRunning(true)
    setFeatureRollupRunStatus(null)
    try {
      const response = await fetch('/api/notifications/run-feature-rollup', { method: 'POST' })
      const data = await response.json() as { ok: boolean; skipped?: boolean; message?: string; postUrl?: string }
      if (!data.ok) {
        setFeatureRollupRunStatus('❌ ' + (data.message ?? 'Error'))
      } else if (data.skipped) {
        setFeatureRollupRunStatus('ℹ No changes found')
      } else {
        setFeatureRollupRunStatus('✓ Delivered')
      }
    } catch {
      setFeatureRollupRunStatus('❌ Network error')
    } finally {
      setIsFeatureRollupRunning(false)
    }
  }, [])

  /** Triggers an immediate ART rollup delivery. */
  const runRollupNow = useCallback(async () => {
    setIsRollupRunning(true)
    setRollupRunStatus(null)
    try {
      const response = await fetch('/api/notifications/run-rollup', { method: 'POST' })
      const data = await response.json() as { ok: boolean; skipped?: boolean; message?: string; postUrl?: string }
      if (!data.ok) {
        setRollupRunStatus('❌ ' + (data.message ?? 'Error'))
      } else if (data.skipped) {
        setRollupRunStatus('ℹ No changes found')
      } else {
        setRollupRunStatus('✓ Delivered')
      }
    } catch {
      setRollupRunStatus('❌ Network error')
    } finally {
      setIsRollupRunning(false)
    }
  }, [])

  const actions: AdminHubActions = {
    setProxyUrl,
    saveProxyUrls,
    setArtField,
    saveArtSettings,
    toggleFeatureFlag,
    setAdminPinInput: (value: string) => {
      // Update the ref immediately so tryUnlock can read the new value
      // even when called in the same React batched-update cycle.
      adminPinInputRef.current = value
      setAdminPinInput(value)
    },
    setAdminUsername: (value: string) => {
      adminUsernameRef.current = value
      setAdminUsername(value)
    },
    tryUnlock,
    lock,
    tryAdvancedUnlock,
    closeAdvancedUnlockDialog,
    submitAdvancedUnlock,
    clearAdvancedUnlockError,
    runDiagnostics,
    setDiagnosticsSectionCollapsed: setIsDiagnosticsSectionCollapsed,
    downloadBackup,
    triggerRestoreBackup,
    openResetAllSettingsDialog,
    closeResetAllSettingsDialog,
    resetAllSettings,
    setBackupSectionCollapsed: setIsBackupSectionCollapsed,
    updateHygieneRule,
    setHygieneSectionCollapsed: setIsHygieneSectionCollapsed,
    checkForUpdates,
    installUpdate,
    setUpdateSectionCollapsed: setIsUpdateSectionCollapsed,
    advancedLock,
    loadConnectivityConfig,
    saveSnowConfig,
    saveGitHubConfig,
    saveGitHubAppConfig,
    saveConfluenceConfig,
    testSnowConfig,
    testGitHubConfig,
    testConfluenceConfig,
    updateTeamConfig,
    updateArtRollup,
    loadNotificationConfigs,
    saveNotificationsConfig,
    runTeamNow,
    runRollupNow,
    testWebhook,
    updateFeatureChangeConfig,
    loadFeatureChangeConfigs,
    saveFeatureChangeConfigs,
    runFeatureNow,
    updateFeatureChangeArtRollup,
    runFeatureArtRollupNow,
  }

  return { state, actions }
}
