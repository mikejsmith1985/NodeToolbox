// useDevWorkspaceState.ts — State management hook for the Dev Workspace view.

import { useCallback, useState } from 'react';
import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const MAX_SYNC_LOG_ENTRIES = 100;
const ISSUE_DETAIL_PATH_PREFIX = '/rest/api/2/issue/';
const ISSUE_SUMMARY_FIELDS = '?fields=summary';
const ISSUE_SEARCH_FAILURE_MESSAGE = 'Failed to find issue. Check the key and try again.';

export type DevWorkspaceTab = 'hygiene' | 'time' | 'gitsync' | 'monitor' | 'settings';
export type WorkLogTab = 'timers' | 'today' | 'history';

/** Represents a tracked Jira issue with an active or paused stopwatch timer. */
export interface IssueTimer {
  issueKey: string;
  issueSummary: string;
  isRunning: boolean;
  elapsedSeconds: number;
  sessionStartedAt: number | null;
}

/** A completed work session entry for the work log. */
export interface WorkLogEntry {
  issueKey: string;
  issueSummary: string;
  durationSeconds: number;
  loggedAt: string;
}

export interface DevWorkspaceState {
  activeTab: DevWorkspaceTab;
  workLogTab: WorkLogTab;
  issueTimers: IssueTimer[];
  workLogEntries: WorkLogEntry[];
  issueSearchKey: string;
  isSearchingIssue: boolean;
  issueSearchError: string | null;
  isSyncRunning: boolean;
  syncLog: string[];
  monitorLog: string[];
  lastSyncAt: string | null;
}

export interface DevWorkspaceActions {
  setActiveTab: (tab: DevWorkspaceTab) => void;
  setWorkLogTab: (tab: WorkLogTab) => void;
  setIssueSearchKey: (key: string) => void;
  searchAndAddIssue: () => Promise<void>;
  startTimer: (issueKey: string) => void;
  stopTimer: (issueKey: string) => void;
  tickAllRunningTimers: () => void;
  removeTimer: (issueKey: string) => void;
  toggleSync: () => void;
  appendSyncLog: (entry: string) => void;
  clearSyncLog: () => void;
  appendMonitorLog: (entry: string) => void;
  clearMonitorLog: () => void;
  logWorkEntry: (entry: WorkLogEntry) => void;
}

/** Hook providing all state and actions for the Dev Workspace view. */
export function useDevWorkspaceState(): { state: DevWorkspaceState; actions: DevWorkspaceActions } {
  const [activeTab, setActiveTabState] = useState<DevWorkspaceTab>('hygiene');
  const [workLogTab, setWorkLogTabState] = useState<WorkLogTab>('timers');
  const [issueTimers, setIssueTimers] = useState<IssueTimer[]>([]);
  const [workLogEntries, setWorkLogEntries] = useState<WorkLogEntry[]>([]);
  const [issueSearchKey, setIssueSearchKeyState] = useState('');
  const [isSearchingIssue, setIsSearchingIssue] = useState(false);
  const [issueSearchError, setIssueSearchError] = useState<string | null>(null);
  const [isSyncRunning, setIsSyncRunning] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [monitorLog, setMonitorLog] = useState<string[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const setActiveTab = useCallback((tab: DevWorkspaceTab) => {
    setActiveTabState(tab);
  }, []);

  const setWorkLogTab = useCallback((tab: WorkLogTab) => {
    setWorkLogTabState(tab);
  }, []);

  const setIssueSearchKey = useCallback((key: string) => {
    setIssueSearchKeyState(key);
    setIssueSearchError(null);
  }, []);

  const searchAndAddIssue = useCallback(async () => {
    const trimmedKey = issueSearchKey.trim().toUpperCase();
    if (!trimmedKey) return;

    // Skip if already tracked to avoid duplicate timers
    const isAlreadyTracked = issueTimers.some((timer) => timer.issueKey === trimmedKey);
    if (isAlreadyTracked) return;

    setIsSearchingIssue(true);
    setIssueSearchError(null);

    try {
      const issueData = await jiraGet<Pick<JiraIssue, 'key' | 'fields'>>(
        `${ISSUE_DETAIL_PATH_PREFIX}${trimmedKey}${ISSUE_SUMMARY_FIELDS}`,
      );
      const newTimer: IssueTimer = {
        issueKey: issueData.key,
        issueSummary: issueData.fields.summary,
        isRunning: false,
        elapsedSeconds: 0,
        sessionStartedAt: null,
      };
      setIssueTimers((previous) => [...previous, newTimer]);
    } catch {
      setIssueSearchError(ISSUE_SEARCH_FAILURE_MESSAGE);
    } finally {
      setIsSearchingIssue(false);
    }
  }, [issueSearchKey, issueTimers]);

  const startTimer = useCallback((issueKey: string) => {
    setIssueTimers((previous) =>
      previous.map((timer) => {
        if (timer.issueKey !== issueKey) return timer;
        return { ...timer, isRunning: true, sessionStartedAt: Date.now() };
      }),
    );
  }, []);

  const stopTimer = useCallback((issueKey: string) => {
    setIssueTimers((previous) =>
      previous.map((timer) => {
        if (timer.issueKey !== issueKey) return timer;
        const sessionDuration =
          timer.sessionStartedAt !== null
            ? Math.floor((Date.now() - timer.sessionStartedAt) / 1000)
            : 0;
        const updatedTimer: IssueTimer = {
          ...timer,
          isRunning: false,
          sessionStartedAt: null,
          elapsedSeconds: timer.elapsedSeconds + sessionDuration,
        };

        // Record the work log entry for this session
        const workLogEntry: WorkLogEntry = {
          issueKey: timer.issueKey,
          issueSummary: timer.issueSummary,
          durationSeconds: sessionDuration,
          loggedAt: new Date().toISOString(),
        };
        setWorkLogEntries((previousEntries) => [workLogEntry, ...previousEntries]);

        return updatedTimer;
      }),
    );
  }, []);

  /** Increments elapsedSeconds by 1 for all currently running timers — called every second by the view's interval. */
  const tickAllRunningTimers = useCallback(() => {
    setIssueTimers((previous) =>
      previous.map((timer) => {
        if (!timer.isRunning) return timer;
        return { ...timer, elapsedSeconds: timer.elapsedSeconds + 1 };
      }),
    );
  }, []);

  const removeTimer = useCallback((issueKey: string) => {
    setIssueTimers((previous) => previous.filter((timer) => timer.issueKey !== issueKey));
  }, []);

  const toggleSync = useCallback(() => {
    setIsSyncRunning((previous) => {
      if (!previous) {
        setLastSyncAt(new Date().toISOString());
      }
      return !previous;
    });
  }, []);

  const appendSyncLog = useCallback((entry: string) => {
    setSyncLog((previous) => {
      const updatedLog = [entry, ...previous];
      // Enforce maximum log size — oldest entries are dropped from the end
      return updatedLog.slice(0, MAX_SYNC_LOG_ENTRIES);
    });
  }, []);

  const clearSyncLog = useCallback(() => {
    setSyncLog([]);
  }, []);

  const appendMonitorLog = useCallback((entry: string) => {
    setMonitorLog((previous) => {
      const updatedLog = [entry, ...previous];
      return updatedLog.slice(0, MAX_SYNC_LOG_ENTRIES);
    });
  }, []);

  const clearMonitorLog = useCallback(() => {
    setMonitorLog([]);
  }, []);

  const logWorkEntry = useCallback((entry: WorkLogEntry) => {
    setWorkLogEntries((previous) => [entry, ...previous]);
  }, []);

  return {
    state: {
      activeTab,
      workLogTab,
      issueTimers,
      workLogEntries,
      issueSearchKey,
      isSearchingIssue,
      issueSearchError,
      isSyncRunning,
      syncLog,
      monitorLog,
      lastSyncAt,
    },
    actions: {
      setActiveTab,
      setWorkLogTab,
      setIssueSearchKey,
      searchAndAddIssue,
      startTimer,
      stopTimer,
      tickAllRunningTimers,
      removeTimer,
      toggleSync,
      appendSyncLog,
      clearSyncLog,
      appendMonitorLog,
      clearMonitorLog,
      logWorkEntry,
    },
  };
}
