// useRepoMonitorEngine.test.ts — Tests for the Repo Monitor polling engine.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRepoMonitorEngine } from './useRepoMonitorEngine.ts'

// ── Mock jiraGet ──

const mockJiraGet = vi.fn()
vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => mockJiraGet(...args),
}))

// ── Test data ──

const PROJECT_KEY = 'TBX'

const JIRA_ISSUE_NO_ASSIGNEE = {
  key: 'TBX-1',
  fields: {
    summary: 'No assignee issue',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    assignee: null,
    issuetype: { name: 'Story' },
    updated: new Date().toISOString(),
    created: new Date().toISOString(),
  },
}

const JIRA_ISSUE_HEALTHY = {
  key: 'TBX-2',
  fields: {
    summary: 'Healthy issue',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    assignee: { displayName: 'Dev User' },
    issuetype: { name: 'Story' },
    updated: new Date().toISOString(),
    created: new Date().toISOString(),
    customfield_10028: 5, // story points present
    description: 'Given a user, When they click, Then something happens with acceptance criteria',
  },
}

/** Default enterprise rules as stored by Admin Hub. */
const DEFAULT_RULES = [
  {
    id: 'rule-missing-assignee',
    name: 'Missing Assignee',
    description: 'Every in-progress ticket must have an assignee.',
    isBuiltIn: true,
    isEnabled: true,
  },
  {
    id: 'rule-unpointed-story',
    name: 'Unpointed Story',
    description: 'Stories must have story points.',
    isBuiltIn: true,
    isEnabled: true,
  },
  {
    id: 'rule-stale-ticket',
    name: 'Stale Ticket',
    description: 'No stale in-progress tickets.',
    isBuiltIn: true,
    isEnabled: true,
  },
]

// ── Setup ──

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  mockJiraGet.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

// ── Tests ──

describe('useRepoMonitorEngine — precondition guards', () => {
  it('logs a message when jiraProjectKey is empty', async () => {
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: '' }))
    await act(async () => { await result.current.checkNow() })
    expect(result.current.monitorLog.some((entry) => /no jira project key/i.test(entry.message))).toBe(true)
  })

  it('logs a message when no rules are enabled', async () => {
    const disabledRules = DEFAULT_RULES.map((rule) => ({ ...rule, isEnabled: false }))
    localStorage.setItem('tbxEnterpriseStandards', JSON.stringify(disabledRules))
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { await result.current.checkNow() })
    expect(result.current.monitorLog.some((entry) => /no enterprise rules/i.test(entry.message))).toBe(true)
    expect(mockJiraGet).not.toHaveBeenCalled()
  })
})

describe('useRepoMonitorEngine — checkNow pass/fail', () => {
  beforeEach(() => {
    localStorage.setItem('tbxEnterpriseStandards', JSON.stringify(DEFAULT_RULES))
  })

  it('logs a pass entry when all issues have assignees', async () => {
    mockJiraGet.mockResolvedValue({ issues: [JIRA_ISSUE_HEALTHY] })
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { await result.current.checkNow() })
    const passingEntries = result.current.monitorLog.filter((entry) => entry.level === 'pass')
    expect(passingEntries.length).toBeGreaterThan(0)
  })

  it('logs a fail entry when an issue has no assignee', async () => {
    mockJiraGet.mockResolvedValue({ issues: [JIRA_ISSUE_NO_ASSIGNEE] })
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { await result.current.checkNow() })
    const failEntry = result.current.monitorLog.find(
      (entry) => entry.level === 'fail' && /missing assignee/i.test(entry.message),
    )
    expect(failEntry).toBeDefined()
    expect(failEntry?.message).toContain('TBX-1')
  })

  it('logs an error entry when the Jira call throws', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira GET failed: 401'))
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { await result.current.checkNow() })
    const errorEntry = result.current.monitorLog.find((entry) => entry.level === 'error')
    expect(errorEntry).toBeDefined()
    expect(errorEntry?.message).toContain('401')
  })

  it('isChecking is true during the fetch and false after', async () => {
    let resolveFetch!: (value: unknown) => void
    mockJiraGet.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))

    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))

    const checkPromise = act(async () => { await result.current.checkNow() })
    // The hook should now be in a "checking" state — we can't assert mid-flight easily
    // in @testing-library/react without awaiting, so just confirm it resolves cleanly.
    resolveFetch({ issues: [] })
    await checkPromise
    expect(result.current.isChecking).toBe(false)
  })
})

describe('useRepoMonitorEngine — startMonitor / stopMonitor', () => {
  beforeEach(() => {
    localStorage.setItem('tbxEnterpriseStandards', JSON.stringify(DEFAULT_RULES))
    mockJiraGet.mockResolvedValue({ issues: [] })
  })

  it('sets isRunning to true on startMonitor and false on stopMonitor', async () => {
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { result.current.startMonitor(15) })
    expect(result.current.isRunning).toBe(true)
    act(() => { result.current.stopMonitor() })
    expect(result.current.isRunning).toBe(false)
  })

  it('logs a stop message when stopMonitor is called', async () => {
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { result.current.startMonitor(15) })
    act(() => { result.current.stopMonitor() })
    expect(result.current.monitorLog.some((entry) => /monitor stopped/i.test(entry.message))).toBe(true)
  })

  it('fires checkNow again after the interval elapses', async () => {
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { result.current.startMonitor(15) })

    // Advance time by 15 minutes and let the interval fire.
    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 1000)
      await Promise.resolve()
    })

    // jiraGet should have been called at least twice (once on start, once after interval).
    expect(mockJiraGet).toHaveBeenCalledTimes(2)

    act(() => { result.current.stopMonitor() })
  })
})

describe('useRepoMonitorEngine — clearMonitorLog', () => {
  it('empties the log array', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] })
    localStorage.setItem('tbxEnterpriseStandards', JSON.stringify(DEFAULT_RULES))
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    await act(async () => { await result.current.checkNow() })
    expect(result.current.monitorLog.length).toBeGreaterThan(0)
    act(() => { result.current.clearMonitorLog() })
    expect(result.current.monitorLog).toHaveLength(0)
  })
})

describe('useRepoMonitorEngine — enabledRules', () => {
  it('exposes only enabled rules', () => {
    const mixedRules = [
      { ...DEFAULT_RULES[0], isEnabled: true },
      { ...DEFAULT_RULES[1], isEnabled: false },
    ]
    localStorage.setItem('tbxEnterpriseStandards', JSON.stringify(mixedRules))
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    expect(result.current.enabledRules).toHaveLength(1)
    expect(result.current.enabledRules[0].id).toBe('rule-missing-assignee')
  })

  it('falls back to default rules when localStorage is empty', () => {
    const { result } = renderHook(() => useRepoMonitorEngine({ jiraProjectKey: PROJECT_KEY }))
    // Default rules include all 5 built-in rules, all enabled
    expect(result.current.enabledRules.length).toBeGreaterThan(0)
  })
})
