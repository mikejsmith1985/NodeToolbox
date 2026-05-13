// useRepoMonitorEngine.ts — Drives the Dev Workspace Repo Monitor panel.
//
// Loads enterprise standards rules from Admin Hub's localStorage config, fetches active
// Jira issues for the configured project, runs hygiene predicates, and appends timestamped
// pass/fail log entries for each enabled rule.  The engine also provides startMonitor /
// stopMonitor for periodic polling and a clearMonitorLog helper.

import { useCallback, useEffect, useRef, useState } from 'react'

import { jiraGet } from '../../../services/jiraApi.ts'
import type { EnterpriseRule } from '../../AdminHub/EnterpriseStandardsPanel.tsx'
import { DEFAULT_ENTERPRISE_RULES } from '../../AdminHub/EnterpriseStandardsPanel.tsx'
import type {
  HygieneCheckId,
  JiraIssue,
} from '../../Hygiene/checks/hygieneChecks.ts'
import { evaluateHygieneIssue } from '../../Hygiene/checks/hygieneChecks.ts'

// ── Constants ──

const ENTERPRISE_STANDARDS_STORAGE_KEY = 'tbxEnterpriseStandards'

/** Maximum Jira issues to fetch per check run — keeps requests fast and predictable. */
const MAX_ISSUES_PER_RUN = 100

/** Default polling interval in minutes when startMonitor is called without an argument. */
const DEFAULT_POLL_INTERVAL_MINUTES = 15

const MILLISECONDS_PER_MINUTE = 60 * 1000

/**
 * Maps each enterprise rule ID to the hygiene check that detects the same violation.
 * Rules not listed here have no direct automated check available.
 */
const RULE_TO_CHECK_ID: Partial<Record<string, HygieneCheckId>> = {
  'rule-missing-assignee': 'no-assignee',
  'rule-unpointed-story': 'missing-sp',
  'rule-stale-ticket': 'stale',
}

// ── Types ──

/** Severity level for a single monitor log entry. */
export type MonitorLogLevel = 'info' | 'pass' | 'fail' | 'error'

/** A single line in the monitor activity log. */
export interface MonitorLogEntry {
  timestamp: string
  level: MonitorLogLevel
  message: string
}

export interface UseRepoMonitorEngineOptions {
  jiraProjectKey: string
}

export interface UseRepoMonitorEngineResult {
  /** Whether the periodic polling interval is active. */
  isRunning: boolean
  /** Whether a manual or automatic check is currently in flight. */
  isChecking: boolean
  /** Ordered list of log entries produced by check runs. */
  monitorLog: MonitorLogEntry[]
  /** The enabled enterprise rules that will be evaluated on each run. */
  enabledRules: EnterpriseRule[]
  /** Runs a single check cycle immediately. */
  checkNow: () => Promise<void>
  /** Starts periodic polling at the given interval (defaults to 15 min). */
  startMonitor: (intervalMinutes?: number) => void
  /** Stops the polling interval without clearing the log. */
  stopMonitor: () => void
  /** Removes all entries from the monitor log. */
  clearMonitorLog: () => void
}

// ── Helpers ──

/** Reads and parses the enterprise rules from localStorage, falling back to defaults. */
function loadEnterpriseRules(): EnterpriseRule[] {
  try {
    const raw = localStorage.getItem(ENTERPRISE_STANDARDS_STORAGE_KEY)
    if (!raw) return DEFAULT_ENTERPRISE_RULES
    const parsed = JSON.parse(raw) as EnterpriseRule[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_ENTERPRISE_RULES
  } catch {
    return DEFAULT_ENTERPRISE_RULES
  }
}

/** Formats `Date.now()` as a HH:MM:SS timestamp string for log entries. */
function formatTimestamp(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', { hour12: false })
}

/** Builds a log entry with the current timestamp. */
function buildLogEntry(level: MonitorLogLevel, message: string): MonitorLogEntry {
  return { timestamp: formatTimestamp(), level, message }
}

// ── Hook ──

/**
 * Engine for the Dev Workspace Repo Monitor panel.
 *
 * Reads enterprise rules, fetches open Jira issues, runs hygiene checks, and surfaces
 * pass/fail results per rule so the user can see the health of their project at a glance.
 */
export function useRepoMonitorEngine({
  jiraProjectKey,
}: UseRepoMonitorEngineOptions): UseRepoMonitorEngineResult {
  const [isRunning, setIsRunning] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [monitorLog, setMonitorLog] = useState<MonitorLogEntry[]>([])
  const [enabledRules, setEnabledRules] = useState<EnterpriseRule[]>(() =>
    loadEnterpriseRules().filter((rule) => rule.isEnabled),
  )

  // Interval handle — stored in a ref so it survives re-renders without recreating callbacks.
  const intervalHandleRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Appends one entry to the log without replacing the entire array. */
  const appendLogEntry = useCallback((level: MonitorLogLevel, message: string): void => {
    setMonitorLog((previous) => [...previous, buildLogEntry(level, message)])
  }, [])

  /**
   * Runs a full hygiene check cycle:
   * 1. Validates preconditions (project key, enabled rules).
   * 2. Fetches open issues from Jira.
   * 3. Evaluates every enabled enterprise rule and logs pass/fail.
   */
  const checkNow = useCallback(async (): Promise<void> => {
    // Reload rules on every run so Admin Hub changes are picked up immediately.
    const currentRules = loadEnterpriseRules().filter((rule) => rule.isEnabled)
    setEnabledRules(currentRules)

    if (!jiraProjectKey) {
      appendLogEntry(
        'info',
        'No Jira project key configured — go to Dev Workspace Settings to add one.',
      )
      return
    }

    if (currentRules.length === 0) {
      appendLogEntry(
        'info',
        'No enterprise rules are enabled — visit Admin Hub → Enterprise Standards to enable rules.',
      )
      return
    }

    setIsChecking(true)
    appendLogEntry('info', `Checking ${jiraProjectKey} against ${currentRules.length} rule(s)…`)

    try {
      const jql = encodeURIComponent(
        `project = "${jiraProjectKey}" AND statusCategory in (new, indeterminate) ORDER BY updated DESC`,
      )
      const url = `/rest/api/2/search?jql=${jql}&maxResults=${MAX_ISSUES_PER_RUN}&fields=summary,status,assignee,issuetype,priority,created,updated,description,customfield_10028,customfield_10016,customfield_10020`

      const response = await jiraGet<{ issues: JiraIssue[] }>(url)
      const issues: JiraIssue[] = response.issues ?? []

      appendLogEntry('info', `Fetched ${issues.length} open issue(s).`)

      // Build a lookup: checkId → array of issue keys that failed that check.
      const failingKeysByCheck: Partial<Record<HygieneCheckId, string[]>> = {}
      issues.forEach((issue) => {
        evaluateHygieneIssue(issue).forEach((flag) => {
          if (!failingKeysByCheck[flag.checkId]) {
            failingKeysByCheck[flag.checkId] = []
          }
          failingKeysByCheck[flag.checkId]!.push(issue.key)
        })
      })

      // Log a pass/fail line for each enabled enterprise rule.
      let totalFailures = 0
      currentRules.forEach((rule) => {
        const checkId = RULE_TO_CHECK_ID[rule.id]

        if (!checkId) {
          // Rule has no automated check — report as informational.
          appendLogEntry('info', `⚠ ${rule.name}: no automated check available yet.`)
          return
        }

        const failingKeys = failingKeysByCheck[checkId] ?? []
        if (failingKeys.length === 0) {
          appendLogEntry('pass', `✓ ${rule.name}: all ${issues.length} issue(s) pass.`)
        } else {
          totalFailures += failingKeys.length
          const keyList = failingKeys.slice(0, 5).join(', ')
          const moreCount = failingKeys.length > 5 ? ` (+${failingKeys.length - 5} more)` : ''
          appendLogEntry(
            'fail',
            `✗ ${rule.name}: ${failingKeys.length} violation(s) — ${keyList}${moreCount}`,
          )
        }
      })

      if (totalFailures === 0) {
        appendLogEntry('pass', `✓ All rules pass for ${jiraProjectKey}.`)
      } else {
        appendLogEntry('fail', `✗ ${totalFailures} total violation(s) found in ${jiraProjectKey}.`)
      }
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : String(caught)
      appendLogEntry('error', `Error fetching issues: ${errorMessage}`)
    } finally {
      setIsChecking(false)
    }
  }, [jiraProjectKey, appendLogEntry])

  /** Starts periodic monitoring at the given interval (minutes). */
  const startMonitor = useCallback(
    (intervalMinutes: number = DEFAULT_POLL_INTERVAL_MINUTES): void => {
      if (intervalHandleRef.current !== null) return // already running

      appendLogEntry('info', `Monitor started — checking every ${intervalMinutes} minute(s).`)
      setIsRunning(true)
      void checkNow()

      intervalHandleRef.current = setInterval(() => {
        void checkNow()
      }, intervalMinutes * MILLISECONDS_PER_MINUTE)
    },
    [checkNow, appendLogEntry],
  )

  /** Stops the periodic polling interval. */
  const stopMonitor = useCallback((): void => {
    if (intervalHandleRef.current !== null) {
      clearInterval(intervalHandleRef.current)
      intervalHandleRef.current = null
    }
    setIsRunning(false)
    appendLogEntry('info', 'Monitor stopped.')
  }, [appendLogEntry])

  /** Removes all log entries. */
  const clearMonitorLog = useCallback((): void => {
    setMonitorLog([])
  }, [])

  // Clean up the polling interval when the component using this hook unmounts.
  useEffect(() => {
    return () => {
      if (intervalHandleRef.current !== null) {
        clearInterval(intervalHandleRef.current)
      }
    }
  }, [])

  return {
    isRunning,
    isChecking,
    monitorLog,
    enabledRules,
    checkNow,
    startMonitor,
    stopMonitor,
    clearMonitorLog,
  }
}
