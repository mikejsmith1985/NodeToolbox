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

// ── Named constants ──

const JIRA_PROXY_URL_KEY = 'tbxJiraProxyUrl'
const SNOW_PROXY_URL_KEY = 'tbxSnowProxyUrl'
const GITHUB_PROXY_URL_KEY = 'tbxGithubProxyUrl'
const ART_SETTINGS_KEY = 'tbxARTSettings'
const FEATURE_SNOW_KEY = 'tbxFeatureSnowVisible'
const FEATURE_AI_KEY = 'tbxFeatureAIVisible'
/** Stored in sessionStorage so the unlock clears on browser close. */
const ADMIN_UNLOCK_SESSION_KEY = 'tbxAdminUnlocked'
/** The hardcoded admin PIN. In production, replace with server-side validation. */
const ADMIN_PIN = '1234'

/** sessionStorage key for the advanced section gate (Feature Flags, Diagnostics, Backup). */
const ADVANCED_UNLOCK_SESSION_KEY = 'tbxAdvancedUnlocked'
/** localStorage key where an optional admin passphrase is stored for the advanced gate. */
const ADVANCED_PASSPHRASE_STORAGE_KEY = 'tbxAdminPassphrase'

const SAVE_STATUS_SUCCESS = '✓ Saved'
const SAVE_STATUS_CLEAR_DELAY_MS = 2000

/** localStorage key prefix used by all Hygiene Rules settings. */
const HYGIENE_STALE_DAYS_KEY = 'toolbox-hygiene-stale-days'
const HYGIENE_UNPOINTED_WARNING_DAYS_KEY = 'toolbox-hygiene-unpointed-warning-days'
const HYGIENE_FLAG_MISSING_ASSIGNEE_KEY = 'toolbox-hygiene-flag-missing-assignee'

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
  adminPinInput: string
  proxySaveStatus: string | null
  artSaveStatus: string | null
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
  isCheckingUpdate: boolean
  isUpdateSectionCollapsed: boolean
  // ── Advanced unlock (Feature Flags, Client Diagnostics, Backup/Restore) ──
  isAdvancedUnlocked: boolean
}

/** All action callbacks returned by this hook. */
export interface AdminHubActions {
  setProxyUrl(service: 'jira' | 'snow' | 'github', url: string): void
  saveProxyUrls(): void
  setArtField(field: keyof ArtSettingsConfig, value: string): void
  saveArtSettings(): void
  toggleFeatureFlag(flagKey: keyof FeatureFlags): void
  setAdminPinInput(value: string): void
  tryUnlock(): void
  lock(): void
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
  setUpdateSectionCollapsed(isCollapsed: boolean): void
  // ── Advanced unlock ──
  tryAdvancedUnlock(): void
  advancedLock(): void
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

// ── Hook ──

/** Provides all reactive state and action callbacks for the Admin Hub view. */
export function useAdminHubState(): { state: AdminHubState; actions: AdminHubActions } {
  const [proxyUrls, setProxyUrls] = useState<ProxyUrlConfig>(buildInitialProxyUrls)
  const [artSettings, setArtSettings] = useState<ArtSettingsConfig>(buildInitialArtSettings)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(buildInitialFeatureFlags)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(readIsAdminUnlocked)
  const [isAdvancedUnlocked, setIsAdvancedUnlocked] = useState<boolean>(readIsAdvancedUnlocked)
  const [adminPinInput, setAdminPinInput] = useState('')
  const [proxySaveStatus, setProxySaveStatus] = useState<string | null>(null)
  const [artSaveStatus, setArtSaveStatus] = useState<string | null>(null)

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
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isUpdateSectionCollapsed, setIsUpdateSectionCollapsed] = useState(false)

  // Refs give callbacks synchronous access to latest state values even within
  // the same React batched-update cycle (e.g. setX then readX in one act() call).
  const proxyUrlsRef = useRef(proxyUrls)
  const adminPinInputRef = useRef(adminPinInput)

  const state: AdminHubState = {
    proxyUrls,
    artSettings,
    featureFlags,
    isAdminUnlocked,
    adminPinInput,
    proxySaveStatus,
    artSaveStatus,
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
    isCheckingUpdate,
    isUpdateSectionCollapsed,
    isAdvancedUnlocked,
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

  const tryUnlock = useCallback(() => {
    // Read from ref to get the most current PIN value — avoids stale closure
    // when tryUnlock is called in the same React batch as setAdminPinInput.
    if (adminPinInputRef.current === ADMIN_PIN) {
      setIsAdminUnlocked(true)
      try {
        sessionStorage.setItem(ADMIN_UNLOCK_SESSION_KEY, '1')
      } catch {
        // Non-fatal storage error.
      }
    }
    // Intentionally do nothing on wrong PIN — no error flash to avoid brute-force hints.
  }, [])

  const lock = useCallback(() => {
    setIsAdminUnlocked(false)
    try {
      sessionStorage.removeItem(ADMIN_UNLOCK_SESSION_KEY)
    } catch {
      // Non-fatal storage error.
    }
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
  const resetAllSettings = useCallback(() => {
    const isUserConfirmed = window.confirm(
      'Reset all toolbox settings? This cannot be undone.',
    )
    if (!isUserConfirmed) return
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
    try {
      const response = await fetch('/api/version-check')
      if (!response.ok) throw new Error(`Server returned ${response.status}`)
      const data = (await response.json()) as UpdateCheckResult
      setUpdateCheckResult(data)
    } catch (fetchError) {
      // Log the failure — a future enhancement could surface this as a UI error.
      console.error('Version check failed:', fetchError)
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [])

  /**
   * Prompts the user for the admin passphrase to unlock the advanced sections.
   * If no passphrase is stored in localStorage, any non-null response unlocks.
   */
  const tryAdvancedUnlock = useCallback(() => {
    const storedPassphrase = localStorage.getItem(ADVANCED_PASSPHRASE_STORAGE_KEY)
    const userInput = window.prompt(
      storedPassphrase
        ? 'Enter the admin passphrase to unlock advanced settings:'
        : 'Set an admin passphrase (or leave blank to unlock without one):',
    )
    // User cancelled the prompt — do not unlock.
    if (userInput === null) return

    if (storedPassphrase === null || userInput === storedPassphrase) {
      sessionStorage.setItem(ADVANCED_UNLOCK_SESSION_KEY, '1')
      setIsAdvancedUnlocked(true)
    } else {
      alert('Incorrect passphrase.')
    }
  }, [])

  /** Clears the advanced unlock session state. */
  const advancedLock = useCallback(() => {
    sessionStorage.removeItem(ADVANCED_UNLOCK_SESSION_KEY)
    setIsAdvancedUnlocked(false)
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
    tryUnlock,
    lock,
    runDiagnostics,
    setDiagnosticsSectionCollapsed: setIsDiagnosticsSectionCollapsed,
    downloadBackup,
    triggerRestoreBackup,
    resetAllSettings,
    setBackupSectionCollapsed: setIsBackupSectionCollapsed,
    updateHygieneRule,
    setHygieneSectionCollapsed: setIsHygieneSectionCollapsed,
    checkForUpdates,
    setUpdateSectionCollapsed: setIsUpdateSectionCollapsed,
    tryAdvancedUnlock,
    advancedLock,
  }

  return { state, actions }
}
