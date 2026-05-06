// useSprintData.ts — State management hook for the Sprint Dashboard view.
//
// Handles loading the active sprint from a Jira project key (board → sprint → issues),
// and manages the standup timer countdown state.

import { useCallback, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue, JiraSprint } from '../../../types/jira.ts';

// ── Named constants ──

const STANDUP_TIMER_SECONDS = 900; // 15 minutes
const SPRINT_ISSUE_MAX_RESULTS = 200;
const SPRINT_ISSUE_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,created,updated,description';
const BOARDS_API_PATH = '/rest/agile/1.0/board';

const LOAD_FAILURE_MESSAGE = 'Failed to load sprint';

// ── Type definitions ──

export type DashboardTab =
  | 'overview'
  | 'assignee'
  | 'blockers'
  | 'defects'
  | 'standup'
  | 'settings';

export interface SprintDataState {
  projectKey: string;
  activeTab: DashboardTab;
  sprintInfo: JiraSprint | null;
  sprintIssues: JiraIssue[];
  isLoadingSprint: boolean;
  loadError: string | null;
  isTimerRunning: boolean;
  timerSecondsRemaining: number;
}

export interface SprintDataActions {
  setProjectKey(key: string): void;
  setActiveTab(tab: DashboardTab): void;
  loadSprint(): Promise<void>;
  resetTimer(): void;
  tickTimer(): void;
  startTimer(): void;
  stopTimer(): void;
}

// ── API response shapes ──

interface JiraBoardListResponse {
  values: Array<{ id: number; name: string; type: string; projectKey: string }>;
}

interface JiraSprintListResponse {
  values: JiraSprint[];
}

interface JiraSprintIssuesResponse {
  issues: JiraIssue[];
}

// ── Helper functions ──

function createInitialSprintDataState(): SprintDataState {
  return {
    projectKey: '',
    activeTab: 'overview',
    sprintInfo: null,
    sprintIssues: [],
    isLoadingSprint: false,
    loadError: null,
    isTimerRunning: false,
    timerSecondsRemaining: STANDUP_TIMER_SECONDS,
  };
}

/** Extracts a human-readable error message from an unknown thrown value. */
function extractErrorMessage(unknownError: unknown): string {
  return unknownError instanceof Error ? unknownError.message : LOAD_FAILURE_MESSAGE;
}

// ── Hook ──

/**
 * Manages sprint data and standup timer state for the Sprint Dashboard view.
 * Returns a stable `{ state, actions }` tuple so the view remains a thin consumer.
 */
export function useSprintData(): { state: SprintDataState; actions: SprintDataActions } {
  const [state, setState] = useState<SprintDataState>(() => createInitialSprintDataState());

  // ── Synchronous setters ──

  const setProjectKey = useCallback((projectKey: string) => {
    setState((previousState) => ({ ...previousState, projectKey }));
  }, []);

  const setActiveTab = useCallback((activeTab: DashboardTab) => {
    setState((previousState) => ({ ...previousState, activeTab }));
  }, []);

  // ── Timer actions ──

  const resetTimer = useCallback(() => {
    setState((previousState) => ({
      ...previousState,
      timerSecondsRemaining: STANDUP_TIMER_SECONDS,
    }));
  }, []);

  const tickTimer = useCallback(() => {
    setState((previousState) => ({
      ...previousState,
      timerSecondsRemaining: Math.max(0, previousState.timerSecondsRemaining - 1),
    }));
  }, []);

  const startTimer = useCallback(() => {
    setState((previousState) => ({ ...previousState, isTimerRunning: true }));
  }, []);

  const stopTimer = useCallback(() => {
    setState((previousState) => ({ ...previousState, isTimerRunning: false }));
  }, []);

  // ── Sprint loader ──

  /**
   * Loads the active sprint for the current projectKey using three sequential Jira calls:
   * 1. Find the first scrum board for the project.
   * 2. Find the active sprint on that board.
   * 3. Fetch all issues in that sprint.
   */
  const loadSprint = useCallback(async () => {
    setState((previousState) => ({
      ...previousState,
      isLoadingSprint: true,
      loadError: null,
    }));

    try {
      // Capture projectKey before async calls so closures use a consistent value.
      const currentProjectKey = state.projectKey;

      const boardResponse = await jiraGet<JiraBoardListResponse>(
        `${BOARDS_API_PATH}?projectKeyOrId=${currentProjectKey}&type=scrum`,
      );

      const firstBoard = boardResponse.values[0];
      if (!firstBoard) {
        setState((previousState) => ({
          ...previousState,
          isLoadingSprint: false,
          loadError: 'No scrum board found for this project.',
        }));
        return;
      }

      const sprintResponse = await jiraGet<JiraSprintListResponse>(
        `${BOARDS_API_PATH}/${firstBoard.id}/sprint?state=active`,
      );

      const activeSprint = sprintResponse.values[0];
      if (!activeSprint) {
        setState((previousState) => ({
          ...previousState,
          isLoadingSprint: false,
          loadError: 'No active sprint found for this board.',
        }));
        return;
      }

      const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(
        `/rest/agile/1.0/sprint/${activeSprint.id}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${SPRINT_ISSUE_FIELDS}`,
      );

      setState((previousState) => ({
        ...previousState,
        sprintInfo: activeSprint,
        sprintIssues: issuesResponse.issues,
        isLoadingSprint: false,
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isLoadingSprint: false,
        loadError: extractErrorMessage(unknownError),
      }));
    }
  }, [state.projectKey]);

  const actions = useMemo<SprintDataActions>(
    () => ({
      setProjectKey,
      setActiveTab,
      loadSprint,
      resetTimer,
      tickTimer,
      startTimer,
      stopTimer,
    }),
    [setProjectKey, setActiveTab, loadSprint, resetTimer, tickTimer, startTimer, stopTimer],
  );

  return { state, actions };
}
