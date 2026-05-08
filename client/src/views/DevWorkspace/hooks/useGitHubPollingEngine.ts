// useGitHubPollingEngine.ts — Drives periodic GitHub → Jira commit synchronisation.
//
// Polls GitHub commits on a configurable interval, extracts Jira issue keys from commit
// messages using a regex pattern, then posts a comment or worklog entry to each matching
// Jira issue. Exposes a live countdown (nextRunInSeconds) for UI display.
//
// Falls back gracefully: tries the local proxy first, then direct GitHub API, then no-ops
// if both are unreachable (useful when running in offline/dev mode).

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Named constants ──

const SECONDS_PER_MINUTE = 60
const COUNTDOWN_TICK_INTERVAL_MS = 1000
const GITHUB_API_BASE = 'https://api.github.com'
const PROXY_COMMITS_ENDPOINT = '/api/github/commits'
const DEFAULT_INTERVAL_MINUTES = 15

// ── Types ──

interface GitHubCommit {
  sha: string
  commit: { message: string; author: { name: string; date: string } }
  html_url: string
}

/** Configuration accepted by the polling engine. Callers pass this on every render. */
export interface PollingEngineOptions {
  githubPat: string
  repoFullName: string
  jiraProjectKey: string
  intervalMinutes: number
  maxCommits: number
  keyPattern: string
  commitTemplate: string
  strategy: 'comment' | 'worklog'
}

/** Observable state exposed to the UI for status display. */
export interface PollingEngineState {
  isRunning: boolean
  nextRunInSeconds: number
  lastRunAt: string | null
}

/** Control callbacks exposed to the UI. */
export interface PollingEngineActions {
  startPolling: () => void
  stopPolling: () => void
  syncNow: () => Promise<void>
}

// ── Pure helpers ──

/** Extracts unique Jira issue keys from a string using the supplied regex pattern. */
function extractJiraKeys(text: string, keyPattern: string): string[] {
  try {
    const regex = new RegExp(keyPattern, 'g')
    const matches = text.match(regex) ?? []
    return [...new Set(matches)]
  } catch {
    return []
  }
}

/** Fills commit template variables with concrete values from the commit. */
function buildCommentBody(
  template: string,
  issueKey: string,
  summaryLine: string,
  shortSha: string,
): string {
  return template
    .replace(/\{key\}/g, issueKey)
    .replace(/\{summary\}/g, summaryLine)
    .replace(/\{branch\}/g, shortSha)
}

// ── Hook ──

/**
 * Hook that drives periodic GitHub → Jira commit synchronisation.
 * Accepts live `options`; call `startPolling` / `stopPolling` / `syncNow` to control the cycle.
 */
export function useGitHubPollingEngine(
  options: PollingEngineOptions,
): PollingEngineState & PollingEngineActions {
  const [isRunning, setIsRunning] = useState(false)
  const [nextRunInSeconds, setNextRunInSeconds] = useState(0)
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nextRunAtMsRef = useRef<number>(0)
  // Keep a mutable ref to options so interval callbacks always read the latest config.
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options })

  const fetchCommits = useCallback(async (): Promise<GitHubCommit[]> => {
    const currentOptions = optionsRef.current
    const authHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (currentOptions.githubPat) {
      authHeaders['Authorization'] = `Bearer ${currentOptions.githubPat}`
    }
    const perPage = currentOptions.maxCommits

    // Try the server-side proxy first (avoids CORS issues)
    try {
      const proxyUrl =
        `${PROXY_COMMITS_ENDPOINT}?repo=${encodeURIComponent(currentOptions.repoFullName)}&per_page=${perPage}`
      const proxyResponse = await fetch(proxyUrl, { headers: authHeaders })
      if (proxyResponse.ok) return (await proxyResponse.json()) as GitHubCommit[]
    } catch { /* fall through to direct call */ }

    // Fall back to direct GitHub API
    try {
      const directUrl =
        `${GITHUB_API_BASE}/repos/${currentOptions.repoFullName}/commits?per_page=${perPage}`
      const directResponse = await fetch(directUrl, { headers: authHeaders })
      if (directResponse.ok) return (await directResponse.json()) as GitHubCommit[]
    } catch { /* fall through to empty result */ }

    return []
  }, [])

  const postCommitToJira = useCallback(
    async (issueKey: string, commentBody: string): Promise<void> => {
      const endpoint =
        optionsRef.current.strategy === 'worklog'
          ? `/api/jira/issue/${issueKey}/worklog`
          : `/api/jira/issue/${issueKey}/comment`
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody }),
      })
    },
    [],
  )

  const runSyncCycle = useCallback(async (): Promise<void> => {
    const currentOptions = optionsRef.current
    setLastRunAt(new Date().toISOString())
    const commits = await fetchCommits()
    for (const commit of commits) {
      const commitMessage = commit.commit?.message ?? ''
      const extractedKeys = extractJiraKeys(commitMessage, currentOptions.keyPattern)
      if (extractedKeys.length === 0) continue
      const summaryLine = commitMessage.split('\n')[0]
      const shortSha = commit.sha?.slice(0, 7) ?? ''
      for (const jiraKey of extractedKeys) {
        const commentBody = buildCommentBody(
          currentOptions.commitTemplate, jiraKey, summaryLine, shortSha,
        )
        // Swallow individual post failures — one issue should not halt the whole sync cycle.
        try { await postCommitToJira(jiraKey, commentBody) } catch { /* intentionally ignored */ }
      }
    }
  }, [fetchCommits, postCommitToJira])

  const stopPolling = useCallback((): void => {
    if (pollingIntervalRef.current !== null) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setIsRunning(false)
    setNextRunInSeconds(0)
  }, [])

  const startPolling = useCallback((): void => {
    // Guard against creating duplicate intervals
    if (pollingIntervalRef.current !== null) return
    const intervalMinutes = optionsRef.current.intervalMinutes || DEFAULT_INTERVAL_MINUTES
    const intervalMs = intervalMinutes * SECONDS_PER_MINUTE * COUNTDOWN_TICK_INTERVAL_MS
    nextRunAtMsRef.current = Date.now() + intervalMs
    void runSyncCycle()

    pollingIntervalRef.current = setInterval((): void => {
      nextRunAtMsRef.current = Date.now() + intervalMs
      void runSyncCycle()
    }, intervalMs)

    countdownIntervalRef.current = setInterval((): void => {
      const remainingMs = Math.max(0, nextRunAtMsRef.current - Date.now())
      setNextRunInSeconds(Math.round(remainingMs / COUNTDOWN_TICK_INTERVAL_MS))
    }, COUNTDOWN_TICK_INTERVAL_MS)

    setIsRunning(true)
    setNextRunInSeconds(Math.round(intervalMs / COUNTDOWN_TICK_INTERVAL_MS))
  }, [runSyncCycle])

  const syncNow = useCallback(async (): Promise<void> => {
    await runSyncCycle()
  }, [runSyncCycle])

  // Stop all timers on unmount to prevent memory leaks and dangling state updates.
  useEffect(() => () => { stopPolling() }, [stopPolling])

  return { isRunning, nextRunInSeconds, lastRunAt, startPolling, stopPolling, syncNow }
}
