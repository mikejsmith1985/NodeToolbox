// useAdminHubState.ts — State management hook for the Admin Hub configuration view.
//
// Manages proxy URLs, ART field settings, feature flags, and admin PIN unlock
// with session-persistent unlock state stored in sessionStorage.

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

const SAVE_STATUS_SUCCESS = '✓ Saved'
const SAVE_STATUS_CLEAR_DELAY_MS = 2000

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

/** All reactive state fields managed by this hook. */
export interface AdminHubState {
  proxyUrls: ProxyUrlConfig
  artSettings: ArtSettingsConfig
  featureFlags: FeatureFlags
  isAdminUnlocked: boolean
  adminPinInput: string
  proxySaveStatus: string | null
  artSaveStatus: string | null
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

// ── Hook ──

/** Provides all reactive state and action callbacks for the Admin Hub view. */
export function useAdminHubState(): { state: AdminHubState; actions: AdminHubActions } {
  const [proxyUrls, setProxyUrls] = useState<ProxyUrlConfig>(buildInitialProxyUrls)
  const [artSettings, setArtSettings] = useState<ArtSettingsConfig>(buildInitialArtSettings)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(buildInitialFeatureFlags)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(readIsAdminUnlocked)
  const [adminPinInput, setAdminPinInput] = useState('')
  const [proxySaveStatus, setProxySaveStatus] = useState<string | null>(null)
  const [artSaveStatus, setArtSaveStatus] = useState<string | null>(null)

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
  }

  return { state, actions }
}
