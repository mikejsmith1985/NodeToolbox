// useDevWorkspaceState.ts — State management hook for the Dev Workspace view.

import { useCallback, useState } from 'react';
import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const MAX_SYNC_LOG_ENTRIES = 100;
const JIRA_KEY_REGEX = /([A-Z][A-Z0-9]+-\d+)/;
const ISSUE_DETAIL_PATH_PREFIX = '/rest/api/2/issue/';
const ISSUE_SUMMARY_FIELDS = '?fields=summary';
const ISSUE_COMMENT_PATH_SUFFIX = '/comment';
const ISSUE_SEARCH_FAILURE_MESSAGE = 'Failed to find issue. Check the key and try again.';
const MANUAL_POST_KEY_NOT_FOUND = 'No Jira issue key found in the input text.';
const MANUAL_POST_SUCCESS_PREFIX = 'Comment posted to ';
const DEFAULT_COMMENT_BODY = 'Update posted from NodeToolbox.';

export type DevWorkspaceTab = 'time' | 'gitsync' | 'monitor' | 'settings';
export type WorkLogTab = 'timers' | 'today' | 'history';
export type GitSyncSubTab = 'sync' | 'manual' | 'hooks';

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
  gitSyncSubTab: GitSyncSubTab;
  issueTimers: IssueTimer[];
  workLogEntries: WorkLogEntry[];
  issueSearchKey: string;
  isSearchingIssue: boolean;
  issueSearchError: string | null;
  isSyncRunning: boolean;
  syncLog: string[];
  lastSyncAt: string | null;
  manualPostInput: string;
  manualPostComment: string;
  manualPostResult: string | null;
  isManualPosting: boolean;
}

export interface DevWorkspaceActions {
  setActiveTab: (tab: DevWorkspaceTab) => void;
  setWorkLogTab: (tab: WorkLogTab) => void;
  setGitSyncSubTab: (tab: GitSyncSubTab) => void;
  setIssueSearchKey: (key: string) => void;
  searchAndAddIssue: () => Promise<void>;
  startTimer: (issueKey: string) => void;
  stopTimer: (issueKey: string) => void;
  tickAllRunningTimers: () => void;
  removeTimer: (issueKey: string) => void;
  toggleSync: () => void;
  appendSyncLog: (entry: string) => void;
  clearSyncLog: () => void;
  setManualPostInput: (value: string) => void;
  setManualPostComment: (value: string) => void;
  postManualComment: () => Promise<void>;
  resetManualPost: () => void;
  logWorkEntry: (entry: WorkLogEntry) => void;
}

/** Hook providing all state and actions for the Dev Workspace view. */
export function useDevWorkspaceState(): { state: DevWorkspaceState; actions: DevWorkspaceActions } {
  const [activeTab, setActiveTabState] = useState<DevWorkspaceTab>('time');
  const [workLogTab, setWorkLogTabState] = useState<WorkLogTab>('timers');
  const [gitSyncSubTab, setGitSyncSubTabState] = useState<GitSyncSubTab>('sync');
  const [issueTimers, setIssueTimers] = useState<IssueTimer[]>([]);
  const [workLogEntries, setWorkLogEntries] = useState<WorkLogEntry[]>([]);
  const [issueSearchKey, setIssueSearchKeyState] = useState('');
  const [isSearchingIssue, setIsSearchingIssue] = useState(false);
  const [issueSearchError, setIssueSearchError] = useState<string | null>(null);
  const [isSyncRunning, setIsSyncRunning] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [manualPostInput, setManualPostInputState] = useState('');
  const [manualPostComment, setManualPostCommentState] = useState('');
  const [manualPostResult, setManualPostResult] = useState<string | null>(null);
  const [isManualPosting, setIsManualPosting] = useState(false);

  const setActiveTab = useCallback((tab: DevWorkspaceTab) => {
    setActiveTabState(tab);
  }, []);

  const setWorkLogTab = useCallback((tab: WorkLogTab) => {
    setWorkLogTabState(tab);
  }, []);

  const setGitSyncSubTab = useCallback((tab: GitSyncSubTab) => {
    setGitSyncSubTabState(tab);
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

  const setManualPostInput = useCallback((value: string) => {
    setManualPostInputState(value);
    setManualPostResult(null);
  }, []);

  const setManualPostComment = useCallback((value: string) => {
    setManualPostCommentState(value);
  }, []);

  const postManualComment = useCallback(async () => {
    const keyMatch = manualPostInput.match(JIRA_KEY_REGEX);
    if (!keyMatch) {
      setManualPostResult(MANUAL_POST_KEY_NOT_FOUND);
      return;
    }

    const extractedKey = keyMatch[1];
    setIsManualPosting(true);
    setManualPostResult(null);

    try {
      await jiraPost(
        `${ISSUE_DETAIL_PATH_PREFIX}${extractedKey}${ISSUE_COMMENT_PATH_SUFFIX}`,
        { body: manualPostComment || DEFAULT_COMMENT_BODY },
      );
      setManualPostResult(`${MANUAL_POST_SUCCESS_PREFIX}${extractedKey}.`);
    } catch {
      setManualPostResult(`Failed to post comment to ${extractedKey}.`);
    } finally {
      setIsManualPosting(false);
    }
  }, [manualPostInput, manualPostComment]);

  const resetManualPost = useCallback(() => {
    setManualPostInputState('');
    setManualPostCommentState('');
    setManualPostResult(null);
  }, []);

  const logWorkEntry = useCallback((entry: WorkLogEntry) => {
    setWorkLogEntries((previous) => [entry, ...previous]);
  }, []);

  return {
    state: {
      activeTab,
      workLogTab,
      gitSyncSubTab,
      issueTimers,
      workLogEntries,
      issueSearchKey,
      isSearchingIssue,
      issueSearchError,
      isSyncRunning,
      syncLog,
      lastSyncAt,
      manualPostInput,
      manualPostComment,
      manualPostResult,
      isManualPosting,
    },
    actions: {
      setActiveTab,
      setWorkLogTab,
      setGitSyncSubTab,
      setIssueSearchKey,
      searchAndAddIssue,
      startTimer,
      stopTimer,
      tickAllRunningTimers,
      removeTimer,
      toggleSync,
      appendSyncLog,
      clearSyncLog,
      setManualPostInput,
      setManualPostComment,
      postManualComment,
      resetManualPost,
      logWorkEntry,
    },
  };
}
