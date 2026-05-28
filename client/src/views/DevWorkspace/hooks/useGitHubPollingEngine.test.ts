// useGitHubPollingEngine.test.ts — Tests for the GitHub → Jira commit polling engine hook.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGitHubPollingEngine } from './useGitHubPollingEngine.ts'
import type { PollingEngineOptions } from './useGitHubPollingEngine.ts'

const DEFAULT_TEST_OPTIONS: PollingEngineOptions = {
  githubPat: 'ghp_testtoken',
  repoFullName: 'org/my-repo',
  jiraProjectKey: 'TBX',
  intervalMinutes: 5,
  maxCommits: 10,
  keyPattern: '[A-Z]+-\\d+',
  commitTemplate: '🔧 {key}: {summary} ({branch})',
  strategy: 'comment',
}

describe('useGitHubPollingEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: all fetch calls fail (no network in tests)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('initialises with isRunning=false, lastRunAt=null, nextRunInSeconds=0', () => {
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.lastRunAt).toBeNull()
    expect(result.current.nextRunInSeconds).toBe(0)
  })

  it('sets isRunning=true after startPolling is called', async () => {
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { result.current.startPolling() })
    expect(result.current.isRunning).toBe(true)
  })

  it('sets isRunning=false after stopPolling is called', async () => {
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { result.current.startPolling() })
    act(() => { result.current.stopPolling() })
    expect(result.current.isRunning).toBe(false)
  })

  it('sets nextRunInSeconds to intervalMinutes × 60 after startPolling', async () => {
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { result.current.startPolling() })
    // 5 minutes × 60 = 300 seconds
    expect(result.current.nextRunInSeconds).toBe(300)
  })

  it('resets nextRunInSeconds to 0 when stopPolling is called', async () => {
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { result.current.startPolling() })
    act(() => { result.current.stopPolling() })
    expect(result.current.nextRunInSeconds).toBe(0)
  })

  it('records lastRunAt after syncNow completes', async () => {
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { await result.current.syncNow() })
    expect(result.current.lastRunAt).not.toBeNull()
  })

  it('calling startPolling a second time does not create a duplicate interval', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { result.current.startPolling() })
    await act(async () => { result.current.startPolling() })
    // 2 setIntervals: one for polling, one for countdown — not 4
    expect(setIntervalSpy.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('calls fetch when syncNow is invoked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))
    await act(async () => { await result.current.syncNow() })
    expect(fetchMock).toHaveBeenCalled()
  })

  it('posts only Jira keys that match the configured Jira project key', async () => {
    const fetchMock = vi.fn().mockImplementation(async (requestUrl: string) => {
      if (requestUrl.includes('/commits?')) {
        return {
          ok: true,
          json: async () => ([
            {
              sha: 'abcdef123456',
              commit: {
                message: 'TBX-100 and ABC-200 touched in one commit',
                author: { name: 'Dev', date: '2026-05-28T00:00:00.000Z' },
              },
              html_url: 'https://github.com/org/my-repo/commit/abcdef123456',
            },
          ]),
        }
      }

      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGitHubPollingEngine(DEFAULT_TEST_OPTIONS))

    await act(async () => { await result.current.syncNow() })

    const jiraPostCalls = fetchMock.mock.calls.filter(([requestUrl]) =>
      typeof requestUrl === 'string' && requestUrl.includes('/jira-proxy/rest/api/2/issue/'),
    )
    expect(jiraPostCalls).toHaveLength(1)
    expect(jiraPostCalls[0]?.[0]).toContain('/jira-proxy/rest/api/2/issue/TBX-100/comment')
  })

  it('uses a stripped branch label for the {branch} template variable when merge messages include prefixed branch names', async () => {
    const fetchMock = vi.fn().mockImplementation(async (requestUrl: string, requestOptions?: RequestInit) => {
      if (requestUrl.includes('/commits?')) {
        return {
          ok: true,
          json: async () => ([
            {
              sha: '1234567abcdef',
              commit: {
                message: 'Merge pull request #42 from mikejsmith1985/feature/TBX-999-awesome-change',
                author: { name: 'Dev', date: '2026-05-28T00:00:00.000Z' },
              },
              html_url: 'https://github.com/org/my-repo/commit/1234567abcdef',
            },
          ]),
        }
      }

      if (requestUrl.includes('/jira-proxy/rest/api/2/issue/TBX-999/comment')) {
        return { ok: true, json: async () => ({ echoedBody: requestOptions?.body ?? null }) }
      }

      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useGitHubPollingEngine({
      ...DEFAULT_TEST_OPTIONS,
      branchPrefixesToStrip: 'feature/,bugfix/',
    }))

    await act(async () => { await result.current.syncNow() })

    const jiraPostCall = fetchMock.mock.calls.find(([requestUrl]) =>
      typeof requestUrl === 'string' && requestUrl.includes('/jira-proxy/rest/api/2/issue/TBX-999/comment'),
    )
    const jiraPostBody = JSON.parse(String(jiraPostCall?.[1]?.body ?? '{}')) as { body?: string }
    expect(jiraPostBody.body).toContain('(TBX-999-awesome-change)')
  })
})
