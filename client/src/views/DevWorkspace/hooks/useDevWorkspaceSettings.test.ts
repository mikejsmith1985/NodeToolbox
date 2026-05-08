// useDevWorkspaceSettings.test.ts — Tests for the Dev Workspace full settings hook.

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useDevWorkspaceSettings } from './useDevWorkspaceSettings.ts'

const SETTINGS_STORAGE_KEY = 'tbxDevWorkspaceConfig'

describe('useDevWorkspaceSettings', () => {
  afterEach(() => { localStorage.clear() })

  it('initialises with default values when localStorage is empty', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    expect(result.current.settings.githubPat).toBe('')
    expect(result.current.settings.syncIntervalMinutes).toBe(15)
    expect(result.current.settings.maxCommitsPerSync).toBe(50)
    expect(result.current.settings.commitKeyPattern).toBe('[A-Z]+-\\d+')
    expect(result.current.settings.postingStrategy).toBe('comment')
    expect(result.current.settings.branchPrefixesToStrip).toBe('feature/,bugfix/,fix/,hotfix/,release/')
  })

  it('PAT is hidden (isPatVisible=false) by default', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    expect(result.current.isPatVisible).toBe(false)
  })

  it('persists updates to localStorage on updateSettings', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    act(() => { result.current.updateSettings({ githubPat: 'ghp_token123' }) })
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(stored.githubPat).toBe('ghp_token123')
  })

  it('loads settings from localStorage on mount', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ syncIntervalMinutes: 30, postingStrategy: 'worklog', maxCommitsPerSync: 100 }),
    )
    const { result } = renderHook(() => useDevWorkspaceSettings())
    expect(result.current.settings.syncIntervalMinutes).toBe(30)
    expect(result.current.settings.postingStrategy).toBe('worklog')
    expect(result.current.settings.maxCommitsPerSync).toBe(100)
  })

  it('merges partial updates without erasing unrelated fields', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    act(() => { result.current.updateSettings({ maxCommitsPerSync: 75 }) })
    act(() => { result.current.updateSettings({ postingStrategy: 'worklog' }) })
    expect(result.current.settings.maxCommitsPerSync).toBe(75)
    expect(result.current.settings.postingStrategy).toBe('worklog')
    expect(result.current.settings.syncIntervalMinutes).toBe(15) // untouched default
  })

  it('clearGithubPat sets githubPat to empty string', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    act(() => { result.current.updateSettings({ githubPat: 'secret' }) })
    act(() => { result.current.clearGithubPat() })
    expect(result.current.settings.githubPat).toBe('')
  })

  it('togglePatVisibility flips isPatVisible on each call', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    act(() => { result.current.togglePatVisibility() })
    expect(result.current.isPatVisible).toBe(true)
    act(() => { result.current.togglePatVisibility() })
    expect(result.current.isPatVisible).toBe(false)
  })

  it('falls back to defaults when localStorage contains malformed JSON', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{invalid json')
    const { result } = renderHook(() => useDevWorkspaceSettings())
    expect(result.current.settings.syncIntervalMinutes).toBe(15)
    expect(result.current.settings.postingStrategy).toBe('comment')
  })

  it('repoFullName and jiraProjectKey default to empty strings', () => {
    const { result } = renderHook(() => useDevWorkspaceSettings())
    expect(result.current.settings.repoFullName).toBe('')
    expect(result.current.settings.jiraProjectKey).toBe('')
  })
})
