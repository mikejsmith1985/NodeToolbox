// useGitHubPollingEngine.ts — Drives periodic GitHub → Jira commit synchronisation.
//
// Polls GitHub commits on a configurable interval, extracts Jira issue keys from commit
// messages using a regex pattern, then posts a comment or worklog entry to each matching
// Jira issue. Exposes a live countdown (nextRunInSeconds) for UI display.
//
// Uses server-side proxy routes for both GitHub reads and Jira writes so browser clients
// can operate in restricted enterprise environments where direct outbound calls are blocked.

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Named constants ──

const SECONDS_PER_MINUTE = 60
const COUNTDOWN_TICK_INTERVAL_MS = 1000
const DEFAULT_GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_PROXY_BASE = '/github-proxy'
const JIRA_PROXY_BASE = '/jira-proxy/rest/api/2/issue'
const DEFAULT_INTERVAL_MINUTES = 15
const DEFAULT_WORKLOG_SECONDS = 60

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
  monitoredReposText?: string
  jiraProjectKey: string
  intervalMinutes: number
  maxCommits: number
  keyPattern: string
  commitTemplate: string
  strategy: 'comment' | 'worklog'
  mode?: 'sync' | 'monitor'
  shouldLogMissingJiraKeys?: boolean
  shouldLogHealthyRuns?: boolean
  onLogEntry?: (entry: string) => void
  onCycleComplete?: (summary: PollingCycleSummary) => void
}

export interface PollingCycleSummary {
  repoCount: number
  commitCount: number
  commitsWithJiraKey: number
  commitsWithoutJiraKey: number
  jiraUpdatesPosted: number
  completedAt: string
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

  const fetchCommitsForRepo = useCallback(async (repoFullName: string): Promise<GitHubCommit[]> => {
    const currentOptions = optionsRef.current
    const authHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (currentOptions.githubPat) {
      authHeaders['Authorization'] = `Bearer ${currentOptions.githubPat}`
    }
    if (!repoFullName.trim()) return []

    const perPage = currentOptions.maxCommits
    const githubApiBase = currentOptions.githubPat ? DEFAULT_GITHUB_API_BASE : GITHUB_PROXY_BASE
    const githubCommitsUrl = `${githubApiBase}/repos/${repoFullName}/commits?per_page=${perPage}`
    const commitsResponse = await fetch(githubCommitsUrl, { headers: authHeaders })
    if (!commitsResponse.ok) {
      throw new Error(`GitHub commits request failed: ${commitsResponse.status}`)
    }
    return (await commitsResponse.json()) as GitHubCommit[]
  }, [])

  const postCommitToJira = useCallback(
    async (issueKey: string, commentBody: string): Promise<void> => {
      const isWorklogStrategy = optionsRef.current.strategy === 'worklog'
      const endpoint = isWorklogStrategy
        ? `${JIRA_PROXY_BASE}/${issueKey}/worklog`
        : `${JIRA_PROXY_BASE}/${issueKey}/comment`
      const payload = isWorklogStrategy
        ? { comment: commentBody, timeSpentSeconds: DEFAULT_WORKLOG_SECONDS }
        : { body: commentBody }

      const jiraResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!jiraResponse.ok) {
        throw new Error(`Jira post failed for ${issueKey}: ${jiraResponse.status}`)
      }
    },
    [],
  )

  const runSyncCycle = useCallback(async (): Promise<void> => {
    const currentOptions = optionsRef.current
    const logSyncEntry = currentOptions.onLogEntry
    const mode = currentOptions.mode ?? 'sync'

    const monitoredRepos = currentOptions.monitoredReposText?.trim()
      ? currentOptions.monitoredReposText
        .split(/[,\n]/)
        .map((repoName) => repoName.trim())
        .filter(Boolean)
      : [currentOptions.repoFullName.trim()].filter(Boolean)

    if (monitoredRepos.length === 0) {
      logSyncEntry?.(mode === 'monitor' ? 'Monitor skipped: no repositories configured.' : 'Sync skipped: repository is not configured.')
      return
    }

    setLastRunAt(new Date().toISOString())
    logSyncEntry?.(mode === 'monitor'
      ? `Monitor started for ${monitoredRepos.length} repo(s).`
      : `Sync started for ${monitoredRepos.length} repo(s).`)

    let totalCommitCount = 0
    let totalCommitsWithJiraKey = 0
    let totalCommitsWithoutJiraKey = 0
    let totalIssuesPosted = 0

    for (const repoFullName of monitoredRepos) {
      let repoCommits: GitHubCommit[]
      try {
        repoCommits = await fetchCommitsForRepo(repoFullName)
      } catch (caughtError) {
        const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError)
        logSyncEntry?.(`${mode === 'monitor' ? 'Monitor' : 'Sync'} failed for ${repoFullName}: ${errorMessage}`)
        continue
      }

      totalCommitCount += repoCommits.length

      if (repoCommits.length === 0) {
        if (currentOptions.shouldLogHealthyRuns !== false) {
          logSyncEntry?.(`${repoFullName}: no commits returned in this cycle.`)
        }
        continue
      }

      for (const commit of repoCommits) {
        const commitMessage = commit.commit?.message ?? ''
        const extractedKeys = extractJiraKeys(commitMessage, currentOptions.keyPattern)
        if (extractedKeys.length === 0) {
          totalCommitsWithoutJiraKey += 1
          continue
        }

        totalCommitsWithJiraKey += 1
        if (mode === 'monitor') continue

        const summaryLine = commitMessage.split('\n')[0]
        const shortSha = commit.sha?.slice(0, 7) ?? ''
        for (const jiraKey of extractedKeys) {
          const commentBody = buildCommentBody(
            currentOptions.commitTemplate, jiraKey, summaryLine, shortSha,
          )
          try {
            await postCommitToJira(jiraKey, commentBody)
            totalIssuesPosted += 1
          } catch (caughtError) {
            const errorMessage = caughtError instanceof Error ? caughtError.message : String(caughtError)
            logSyncEntry?.(`Failed to post ${jiraKey}: ${errorMessage}`)
          }
        }
      }
    }

    if (mode === 'monitor' && currentOptions.shouldLogMissingJiraKeys !== false) {
      logSyncEntry?.(`Monitor result: ${totalCommitsWithoutJiraKey} commit(s) missing Jira keys across ${monitoredRepos.length} repo(s).`)
    }

    if (mode === 'sync') {
      logSyncEntry?.(`Sync completed: ${totalCommitCount} commits scanned, ${totalIssuesPosted} Jira updates posted.`)
    } else if (currentOptions.shouldLogHealthyRuns !== false) {
      logSyncEntry?.(`Monitor completed: ${totalCommitCount} commits scanned, ${totalCommitsWithJiraKey} with Jira keys.`)
    }

    currentOptions.onCycleComplete?.({
      repoCount: monitoredRepos.length,
      commitCount: totalCommitCount,
      commitsWithJiraKey: totalCommitsWithJiraKey,
      commitsWithoutJiraKey: totalCommitsWithoutJiraKey,
      jiraUpdatesPosted: totalIssuesPosted,
      completedAt: new Date().toISOString(),
    })
  }, [fetchCommitsForRepo, postCommitToJira])

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
