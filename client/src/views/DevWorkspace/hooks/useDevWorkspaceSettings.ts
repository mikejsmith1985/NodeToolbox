// useDevWorkspaceSettings.ts — Manages the Dev Workspace integration configuration.
//
// Every field persists to localStorage under `tbxDevWorkspaceConfig` and survives page reloads.
// Covers polling interval, commit key extraction, Jira posting strategy, and branch prefix
// stripping — matching the full settings surface from the legacy ToolBox app.
//
// NOTE: The GitHub PAT is NOT stored here. It is managed by the shared settingsStore
// (key: `tbxGithubPat`) so that Admin Hub and Dev Workspace always reflect the same value.

import { useCallback, useState } from 'react'

// ── Named constants ──

const WORKSPACE_CONFIG_STORAGE_KEY = 'tbxDevWorkspaceConfig'
const DEFAULT_SYNC_INTERVAL_MINUTES = 15
const DEFAULT_MAX_COMMITS_PER_SYNC = 50
const DEFAULT_COMMIT_KEY_PATTERN = '[A-Z]+-\\d+'
const DEFAULT_COMMIT_MESSAGE_TEMPLATE =
  '🔧 *Git Commit — [Toolbox Dev Integrations]*\n\nBranch: {branch}\nKey: {key}\nSummary: {summary}'
const DEFAULT_BRANCH_PREFIXES = 'feature/,bugfix/,fix/,hotfix/,release/'

// ── Types ──

export type PostingStrategy = 'comment' | 'worklog'

/** Full configuration shape for Dev Workspace persisted settings. */
export interface DevWorkspaceSettings {
  repoFullName: string
  jiraProjectKey: string
  jiraBaseUrl: string
  syncIntervalMinutes: number
  maxCommitsPerSync: number
  commitKeyPattern: string
  commitMessageTemplate: string
  postingStrategy: PostingStrategy
  branchPrefixesToStrip: string
}

// ── Helpers ──

function buildDefaultSettings(): DevWorkspaceSettings {
  return {
    repoFullName: '',
    jiraProjectKey: '',
    jiraBaseUrl: '',
    syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
    maxCommitsPerSync: DEFAULT_MAX_COMMITS_PER_SYNC,
    commitKeyPattern: DEFAULT_COMMIT_KEY_PATTERN,
    commitMessageTemplate: DEFAULT_COMMIT_MESSAGE_TEMPLATE,
    postingStrategy: 'comment',
    branchPrefixesToStrip: DEFAULT_BRANCH_PREFIXES,
  }
}

function loadSettingsFromStorage(): DevWorkspaceSettings {
  try {
    const raw = localStorage.getItem(WORKSPACE_CONFIG_STORAGE_KEY)
    if (raw === null) return buildDefaultSettings()
    const parsed = JSON.parse(raw) as Partial<DevWorkspaceSettings>
    const defaults = buildDefaultSettings()
    return {
      repoFullName: parsed.repoFullName ?? defaults.repoFullName,
      jiraProjectKey: parsed.jiraProjectKey ?? defaults.jiraProjectKey,
      jiraBaseUrl: parsed.jiraBaseUrl ?? defaults.jiraBaseUrl,
      syncIntervalMinutes: parsed.syncIntervalMinutes ?? defaults.syncIntervalMinutes,
      maxCommitsPerSync: parsed.maxCommitsPerSync ?? defaults.maxCommitsPerSync,
      commitKeyPattern: parsed.commitKeyPattern ?? defaults.commitKeyPattern,
      commitMessageTemplate: parsed.commitMessageTemplate ?? defaults.commitMessageTemplate,
      postingStrategy: parsed.postingStrategy ?? defaults.postingStrategy,
      branchPrefixesToStrip: parsed.branchPrefixesToStrip ?? defaults.branchPrefixesToStrip,
    }
  } catch {
    return buildDefaultSettings()
  }
}

function persistSettings(settings: DevWorkspaceSettings): void {
  localStorage.setItem(WORKSPACE_CONFIG_STORAGE_KEY, JSON.stringify(settings))
}

// ── Hook ──

/**
 * Hook that manages the Dev Workspace settings surface (excluding GitHub PAT).
 * All fields persist to localStorage key `tbxDevWorkspaceConfig`.
 * The GitHub PAT is managed by the shared settingsStore (`tbxGithubPat`) so both
 * Admin Hub and Dev Workspace always show the same token.
 */
export function useDevWorkspaceSettings() {
  const [settings, setSettings] = useState<DevWorkspaceSettings>(loadSettingsFromStorage)

  /** Applies a partial settings update and immediately persists the merged result. */
  const updateSettings = useCallback((partial: Partial<DevWorkspaceSettings>): void => {
    setSettings((previous) => {
      const updated = { ...previous, ...partial }
      persistSettings(updated)
      return updated
    })
  }, [])

  return { settings, updateSettings }
}
