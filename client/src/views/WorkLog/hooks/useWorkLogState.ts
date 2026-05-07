// useWorkLogState.ts — State and Jira interactions for the Work Log timer view.
//
// The Work Log view lets a user start/pause stopwatch timers per Jira issue and
// post the accumulated time to the issue's `worklog` endpoint. Timers and posted
// log entries persist in `localStorage` so refreshing the page never loses work.
//
// Legacy behaviour ported from `15-work-log.js`:
//   • Add a timer by Jira issue key (looked up via `/rest/api/2/issue/{key}`)
//   • Start / pause the active timer with millisecond precision
//   • Post a worklog of `timeSpentSeconds` + optional comment to Jira
//   • Today's totals + dated history list rebuilt from the persisted log array

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';

// ── Persistence ───────────────────────────────────────────────────────────────

/** localStorage key used for Work Log persistence — kept stable for forward compatibility. */
const WORK_LOG_STORAGE_KEY = 'tbxWorkLogState';

/** Maximum number of history entries we retain; older entries are pruned on save. */
const MAX_HISTORY_ENTRIES = 200;

/** Tick interval for the running-timer display (1 second feels live without thrashing React). */
export const TIMER_TICK_INTERVAL_MILLISECONDS = 1000;

/** Minimum acceptable worklog duration — Jira rejects sub-minute entries. */
export const MINIMUM_WORKLOG_SECONDS = 60;

// ── Public types ─────────────────────────────────────────────────────────────

export interface WorkLogTimer {
  issueKey: string;
  summary: string;
  status: string;
  issueType: string;
  isRunning: boolean;
  startedAtMs: number | null;
  accumulatedMilliseconds: number;
}

export interface WorkLogEntry {
  issueKey: string;
  summary: string;
  postedAtIso: string;
  durationSeconds: number;
  comment: string;
}

interface WorkLogState {
  timers: WorkLogTimer[];
  history: WorkLogEntry[];
  searchKey: string;
  searchStatus: string | null;
  isPosting: boolean;
  postError: string | null;
  /** Re-render trigger so live timers update each tick without persisting state. */
  tickCounter: number;
}

interface WorkLogActions {
  setSearchKey: (searchKey: string) => void;
  addTimerByIssueKey: () => Promise<void>;
  startTimer: (issueKey: string) => void;
  pauseTimer: (issueKey: string) => void;
  removeTimer: (issueKey: string) => void;
  postWorkLog: (issueKey: string, durationSeconds: number, comment: string) => Promise<void>;
  parseTimeInput: (rawText: string) => number;
  formatDuration: (totalSeconds: number) => string;
  computeElapsedSeconds: (timer: WorkLogTimer) => number;
}

// ── Persistence helpers ──────────────────────────────────────────────────────

interface PersistedShape {
  timers: WorkLogTimer[];
  history: WorkLogEntry[];
}

function readPersistedState(): PersistedShape {
  try {
    const rawJson = window.localStorage.getItem(WORK_LOG_STORAGE_KEY);
    if (!rawJson) return { timers: [], history: [] };
    const parsedJson = JSON.parse(rawJson) as PersistedShape;
    return {
      timers: Array.isArray(parsedJson.timers) ? parsedJson.timers : [],
      history: Array.isArray(parsedJson.history) ? parsedJson.history : [],
    };
  } catch {
    return { timers: [], history: [] };
  }
}

function writePersistedState(persistedState: PersistedShape): void {
  // Cap the history array so localStorage never grows unbounded over months of use.
  const cappedHistory = persistedState.history.slice(-MAX_HISTORY_ENTRIES);
  try {
    window.localStorage.setItem(
      WORK_LOG_STORAGE_KEY,
      JSON.stringify({ timers: persistedState.timers, history: cappedHistory }),
    );
  } catch {
    // localStorage may be unavailable (e.g. quota exceeded); we silently degrade.
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Formats a duration in whole seconds as a compact human-readable string. */
export function formatDurationFromSeconds(totalSeconds: number): string {
  const flooredSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(flooredSeconds / 3600);
  const minutes = Math.floor((flooredSeconds % 3600) / 60);
  const seconds = flooredSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Returns the current elapsed seconds for a timer, including any in-progress run. */
export function computeElapsedSecondsFor(timer: WorkLogTimer): number {
  let accumulatedMs = timer.accumulatedMilliseconds;
  if (timer.isRunning && timer.startedAtMs) {
    accumulatedMs += Date.now() - timer.startedAtMs;
  }
  return Math.floor(accumulatedMs / 1000);
}

/**
 * Parses free-form time input (e.g. "1h 30m", "45m", "90") into seconds. A bare
 * number with no unit is treated as minutes — matches the legacy convention.
 */
export function parseFreeFormTimeText(rawText: string): number {
  const trimmedText = rawText.trim();
  if (!trimmedText) return 0;
  const hourMatch = trimmedText.match(/(\d+)\s*h/i);
  const minuteMatch = trimmedText.match(/(\d+)\s*m/i);
  const secondMatch = trimmedText.match(/(\d+)\s*s/i);
  if (hourMatch || minuteMatch || secondMatch) {
    const hours = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    const minutes = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;
    const seconds = secondMatch ? parseInt(secondMatch[1], 10) : 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  const bareNumber = parseInt(trimmedText, 10);
  return Number.isFinite(bareNumber) ? bareNumber * 60 : 0;
}

// ── Reducer ──────────────────────────────────────────────────────────────────

type WorkLogAction =
  | { type: 'tick' }
  | { type: 'setSearchKey'; searchKey: string }
  | { type: 'setSearchStatus'; searchStatus: string | null }
  | { type: 'addTimer'; timer: WorkLogTimer }
  | { type: 'startTimer'; issueKey: string }
  | { type: 'pauseTimer'; issueKey: string }
  | { type: 'removeTimer'; issueKey: string }
  | { type: 'beginPosting' }
  | { type: 'finishPosting'; entry: WorkLogEntry }
  | { type: 'failPosting'; postError: string };

function workLogReducer(currentState: WorkLogState, action: WorkLogAction): WorkLogState {
  switch (action.type) {
    case 'tick':
      return { ...currentState, tickCounter: currentState.tickCounter + 1 };
    case 'setSearchKey':
      return { ...currentState, searchKey: action.searchKey };
    case 'setSearchStatus':
      return { ...currentState, searchStatus: action.searchStatus };
    case 'addTimer': {
      const alreadyExists = currentState.timers.some(
        (existingTimer) => existingTimer.issueKey === action.timer.issueKey,
      );
      if (alreadyExists) return currentState;
      return { ...currentState, timers: [...currentState.timers, action.timer] };
    }
    case 'startTimer':
      return {
        ...currentState,
        timers: currentState.timers.map((existingTimer) =>
          existingTimer.issueKey === action.issueKey
            ? { ...existingTimer, isRunning: true, startedAtMs: Date.now() }
            : existingTimer,
        ),
      };
    case 'pauseTimer':
      return {
        ...currentState,
        timers: currentState.timers.map((existingTimer) => {
          if (existingTimer.issueKey !== action.issueKey || !existingTimer.isRunning) {
            return existingTimer;
          }
          const additionalMs = existingTimer.startedAtMs ? Date.now() - existingTimer.startedAtMs : 0;
          return {
            ...existingTimer,
            isRunning: false,
            startedAtMs: null,
            accumulatedMilliseconds: existingTimer.accumulatedMilliseconds + additionalMs,
          };
        }),
      };
    case 'removeTimer':
      return {
        ...currentState,
        timers: currentState.timers.filter((existingTimer) => existingTimer.issueKey !== action.issueKey),
      };
    case 'beginPosting':
      return { ...currentState, isPosting: true, postError: null };
    case 'finishPosting': {
      const updatedTimers = currentState.timers.map((existingTimer) =>
        existingTimer.issueKey === action.entry.issueKey
          ? { ...existingTimer, accumulatedMilliseconds: 0, isRunning: false, startedAtMs: null }
          : existingTimer,
      );
      return {
        ...currentState,
        timers: updatedTimers,
        history: [...currentState.history, action.entry],
        isPosting: false,
        postError: null,
      };
    }
    case 'failPosting':
      return { ...currentState, isPosting: false, postError: action.postError };
    default:
      return currentState;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

interface JiraIssueLookupResponse {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string } | null;
    issuetype?: { name?: string } | null;
  };
}

function buildInitialState(): WorkLogState {
  const persistedState = readPersistedState();
  return {
    timers: persistedState.timers,
    history: persistedState.history,
    searchKey: '',
    searchStatus: null,
    isPosting: false,
    postError: null,
    tickCounter: 0,
  };
}

/** Owns Work Log state, the running-tick interval, and Jira interactions. */
export function useWorkLogState(): WorkLogState & WorkLogActions {
  const [workLogState, dispatchAction] = useReducer(workLogReducer, undefined, buildInitialState);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist after every change to timers or history. We exclude `tickCounter` so the
  // 1-second tick doesn't thrash localStorage.
  useEffect(() => {
    writePersistedState({ timers: workLogState.timers, history: workLogState.history });
  }, [workLogState.timers, workLogState.history]);

  // Mount a 1-second tick only while at least one timer is running.
  const hasRunningTimer = workLogState.timers.some((existingTimer) => existingTimer.isRunning);
  useEffect(() => {
    if (!hasRunningTimer) {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
      return;
    }
    if (tickIntervalRef.current) return;
    tickIntervalRef.current = setInterval(() => {
      dispatchAction({ type: 'tick' });
    }, TIMER_TICK_INTERVAL_MILLISECONDS);
    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
    };
  }, [hasRunningTimer]);

  const setSearchKey = useCallback((newSearchKey: string) => {
    dispatchAction({ type: 'setSearchKey', searchKey: newSearchKey });
  }, []);

  const addTimerByIssueKey = useCallback(async () => {
    const trimmedKey = workLogState.searchKey.trim().toUpperCase();
    if (!trimmedKey) return;
    dispatchAction({ type: 'setSearchStatus', searchStatus: `Looking up ${trimmedKey}…` });
    try {
      const response = await jiraGet<JiraIssueLookupResponse>(
        `/rest/api/2/issue/${encodeURIComponent(trimmedKey)}?fields=summary,status,issuetype`,
      );
      if (!response.key) {
        dispatchAction({ type: 'setSearchStatus', searchStatus: 'Issue not found.' });
        return;
      }
      dispatchAction({
        type: 'addTimer',
        timer: {
          issueKey: response.key,
          summary: response.fields.summary ?? '',
          status: response.fields.status?.name ?? '',
          issueType: response.fields.issuetype?.name ?? '',
          isRunning: false,
          startedAtMs: null,
          accumulatedMilliseconds: 0,
        },
      });
      dispatchAction({ type: 'setSearchKey', searchKey: '' });
      dispatchAction({ type: 'setSearchStatus', searchStatus: null });
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Lookup failed';
      dispatchAction({ type: 'setSearchStatus', searchStatus: `Error: ${errorMessage}` });
    }
  }, [workLogState.searchKey]);

  const startTimer = useCallback((issueKey: string) => {
    dispatchAction({ type: 'startTimer', issueKey });
  }, []);

  const pauseTimer = useCallback((issueKey: string) => {
    dispatchAction({ type: 'pauseTimer', issueKey });
  }, []);

  const removeTimer = useCallback((issueKey: string) => {
    dispatchAction({ type: 'removeTimer', issueKey });
  }, []);

  const postWorkLog = useCallback(
    async (issueKey: string, durationSeconds: number, comment: string) => {
      if (durationSeconds < MINIMUM_WORKLOG_SECONDS) {
        dispatchAction({
          type: 'failPosting',
          postError: `Minimum work log is ${MINIMUM_WORKLOG_SECONDS / 60} minute.`,
        });
        return;
      }
      dispatchAction({ type: 'beginPosting' });
      try {
        await jiraPost<unknown>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`, {
          timeSpentSeconds: durationSeconds,
          comment: comment || `Work logged via NodeToolbox · ${formatDurationFromSeconds(durationSeconds)}`,
        });
        const matchingTimer = workLogState.timers.find((existingTimer) => existingTimer.issueKey === issueKey);
        const summaryForHistory = matchingTimer?.summary ?? '';
        dispatchAction({
          type: 'finishPosting',
          entry: {
            issueKey,
            summary: summaryForHistory,
            postedAtIso: new Date().toISOString(),
            durationSeconds,
            comment,
          },
        });
      } catch (caughtError: unknown) {
        const errorMessage = caughtError instanceof Error ? caughtError.message : 'Post failed';
        dispatchAction({ type: 'failPosting', postError: errorMessage });
      }
    },
    [workLogState.timers],
  );

  return useMemo(
    () => ({
      ...workLogState,
      setSearchKey,
      addTimerByIssueKey,
      startTimer,
      pauseTimer,
      removeTimer,
      postWorkLog,
      parseTimeInput: parseFreeFormTimeText,
      formatDuration: formatDurationFromSeconds,
      computeElapsedSeconds: computeElapsedSecondsFor,
    }),
    [workLogState, setSearchKey, addTimerByIssueKey, startTimer, pauseTimer, removeTimer, postWorkLog],
  );
}
