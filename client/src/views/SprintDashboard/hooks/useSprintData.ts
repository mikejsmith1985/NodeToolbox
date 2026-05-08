// useSprintData.ts — State management hook for the Sprint Dashboard view.
//
// Handles loading sprints and issues from Jira, with full Kanban board support:
//   1. Checks localStorage for a previously-selected boardId (tbxSprintDashboardBoardId).
//   2. If no saved board, fetches the board list for the configured project and picks the first.
//   3. Detects board type (scrum vs kanban) via GET /rest/agile/1.0/board/{id}.
//   4. For scrum boards: fetches the active sprint then sprint issues.
//      For kanban boards: fetches board issues directly (no sprint required).
// Also manages the standup timer countdown, move-to-sprint, and available-sprints caching.

import { useCallback, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraBoard, JiraIssue, JiraSprint } from '../../../types/jira.ts';

// ── Named constants ──

const STANDUP_TIMER_SECONDS = 900; // 15 minutes
const SPRINT_ISSUE_MAX_RESULTS = 200;
const SPRINT_ISSUE_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,created,updated,description,customfield_10016,fixVersions';
const BOARDS_API_PATH = '/rest/agile/1.0/board';

/** localStorage key where the last-selected board id is persisted between page loads. */
const BOARD_ID_STORAGE_KEY = 'tbxSprintDashboardBoardId';

const LOAD_FAILURE_MESSAGE = 'Failed to load sprint';

// ── Type definitions ──

export type DashboardTab =
  | 'overview'
  | 'assignee'
  | 'blockers'
  | 'defects'
  | 'standup'
  | 'settings'
  | 'metrics'
  | 'pipeline'
  | 'planning'
  | 'releases'
  | 'pointing';

export interface SprintDataState {
  projectKey: string;
  activeTab: DashboardTab;
  sprintInfo: JiraSprint | null;
  sprintIssues: JiraIssue[];
  isLoadingSprint: boolean;
  loadError: string | null;
  isTimerRunning: boolean;
  timerSecondsRemaining: number;
  /** The Jira board id currently driving the dashboard. */
  boardId: number | null;
  /** 'kanban' boards have no sprints; issues are loaded directly from the board. */
  boardType: 'scrum' | 'kanban' | null;
  /** All boards returned by the last board-list fetch (used to populate the board picker). */
  availableBoards: JiraBoard[];
  /**
   * Active and future sprints for the current board, used to populate the move-to-sprint dropdown.
   * null means not yet fetched; [] means fetched but the board has no other sprints.
   */
  availableSprints: JiraSprint[] | null;
  isLoadingAvailableSprints: boolean;
}

export interface SprintDataActions {
  setProjectKey(key: string): void;
  setActiveTab(tab: DashboardTab): void;
  loadSprint(): Promise<void>;
  resetTimer(): void;
  tickTimer(): void;
  startTimer(): void;
  stopTimer(): void;
  /** Selects a specific board, saves it to localStorage, and reloads issues. */
  selectBoard(boardId: number): Promise<void>;
  /** Lazily fetches active + future sprints for the current board. No-op if already fetched. */
  loadAvailableSprints(): Promise<void>;
  /** Moves an issue to a target sprint and removes it from the local sprint issues list. */
  moveIssueToSprint(issueKey: string, targetSprintId: number): Promise<void>;
}

// ── API response shapes ──

interface JiraBoardListResponse {
  values: JiraBoard[];
}

interface JiraBoardInfoResponse {
  type: string;
  location?: { projectKey?: string };
}

interface JiraSprintListResponse {
  values: JiraSprint[];
}

interface JiraSprintIssuesResponse {
  issues: JiraIssue[];
}

// ── localStorage helpers ──

/** Reads the persisted board id from localStorage; returns null when absent or unreadable. */
function loadBoardIdFromStorage(): number | null {
  try {
    const stored = localStorage.getItem(BOARD_ID_STORAGE_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists the selected board id to localStorage so it survives page reloads. */
function saveBoardIdToStorage(boardId: number): void {
  try {
    localStorage.setItem(BOARD_ID_STORAGE_KEY, String(boardId));
  } catch {
    // localStorage unavailable; continue without persistence.
  }
}

// ── Internal helpers ──

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
    boardId: null,
    boardType: null,
    availableBoards: [],
    availableSprints: null,
    isLoadingAvailableSprints: false,
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

  // ── Board-level loader: handles both scrum and kanban paths ──

  /**
   * Fetches board metadata to detect the board type, then loads issues via the correct path:
   * - kanban: GET /rest/agile/1.0/board/{id}/issue
   * - scrum:  GET active sprint → GET sprint issues
   *
   * This callback is stable (empty dependency array) because it only references
   * setState (which React guarantees to be stable).
   */
  const loadForBoardId = useCallback(async (boardId: number) => {
    try {
      const boardInfo = await jiraGet<JiraBoardInfoResponse>(`${BOARDS_API_PATH}/${boardId}`);
      const detectedBoardType = (boardInfo.type ?? 'scrum').toLowerCase() as 'scrum' | 'kanban';

      setState((prev) => ({ ...prev, boardId, boardType: detectedBoardType }));

      if (detectedBoardType === 'kanban') {
        await loadKanbanBoardIssues(boardId);
      } else {
        await loadScrumSprintIssues(boardId);
      }
    } catch (unknownError) {
      setState((prev) => ({
        ...prev,
        isLoadingSprint: false,
        loadError: extractErrorMessage(unknownError),
      }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Loads all issues on a Kanban board directly (no sprint). */
  async function loadKanbanBoardIssues(boardId: number) {
    const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(
      `${BOARDS_API_PATH}/${boardId}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${SPRINT_ISSUE_FIELDS}`,
    );
    setState((prev) => ({
      ...prev,
      sprintInfo: null,
      sprintIssues: issuesResponse.issues,
      isLoadingSprint: false,
      loadError: null,
    }));
  }

  /** Finds the active sprint for a scrum board then loads its issues. */
  async function loadScrumSprintIssues(boardId: number) {
    const sprintResponse = await jiraGet<JiraSprintListResponse>(
      `${BOARDS_API_PATH}/${boardId}/sprint?state=active&maxResults=5`,
    );
    const activeSprint = sprintResponse.values[0];

    if (!activeSprint) {
      setState((prev) => ({
        ...prev,
        isLoadingSprint: false,
        loadError: 'No active sprint found on this board. Try selecting a different board in Settings.',
      }));
      return;
    }

    const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(
      `/rest/agile/1.0/sprint/${activeSprint.id}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${SPRINT_ISSUE_FIELDS}`,
    );
    setState((prev) => ({
      ...prev,
      sprintInfo: activeSprint,
      sprintIssues: issuesResponse.issues,
      isLoadingSprint: false,
      loadError: null,
    }));
  }

  // ── Sprint loader (entry point) ──

  /**
   * Entry point for loading the dashboard. Uses a three-tier resolution strategy:
   * 1. If a boardId is saved in localStorage, use it directly.
   * 2. Otherwise fetch the board list (filtered by projectKey when provided).
   * 3. Auto-select the first board, save it to localStorage, then call loadForBoardId.
   */
  const loadSprint = useCallback(async () => {
    setState((previousState) => ({
      ...previousState,
      isLoadingSprint: true,
      loadError: null,
      // Clear cached sprint list so move-to-sprint reflects the freshest data on reload.
      availableSprints: null,
    }));

    try {
      const savedBoardId = loadBoardIdFromStorage();
      if (savedBoardId !== null) {
        setState((prev) => ({ ...prev, boardId: savedBoardId }));
        await loadForBoardId(savedBoardId);
        return;
      }

      // Capture projectKey before the async call so we get a consistent value.
      const currentProjectKey = state.projectKey;
      const boardsUrl = currentProjectKey
        ? `${BOARDS_API_PATH}?projectKeyOrId=${encodeURIComponent(currentProjectKey)}&maxResults=50`
        : `${BOARDS_API_PATH}?maxResults=100`;

      const boardResponse = await jiraGet<JiraBoardListResponse>(boardsUrl);

      if (!boardResponse.values.length) {
        setState((prev) => ({
          ...prev,
          isLoadingSprint: false,
          loadError: currentProjectKey
            ? `No boards found for project "${currentProjectKey}".`
            : 'No boards found. Enter a project key in Settings.',
        }));
        return;
      }

      const firstBoardId = boardResponse.values[0].id;
      saveBoardIdToStorage(firstBoardId);

      setState((prev) => ({ ...prev, availableBoards: boardResponse.values, boardId: firstBoardId }));
      await loadForBoardId(firstBoardId);
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isLoadingSprint: false,
        loadError: extractErrorMessage(unknownError),
      }));
    }
  }, [state.projectKey, loadForBoardId]);

  // ── Board picker action ──

  /**
   * Selects a new board, saves it to localStorage, and reloads the dashboard.
   * Resets the available-sprints cache so the move-to-sprint dropdown stays accurate.
   */
  const selectBoard = useCallback(async (boardId: number) => {
    saveBoardIdToStorage(boardId);
    setState((prev) => ({
      ...prev,
      boardId,
      isLoadingSprint: true,
      loadError: null,
      availableSprints: null,
    }));
    await loadForBoardId(boardId);
  }, [loadForBoardId]);

  // ── Available-sprints loader (move-to-sprint) ──

  /**
   * Lazily fetches active and future sprints for the current board.
   * Results are cached in state so repeated dropdown opens are instant.
   * Corresponds to sdFetchAvailableSprints (07-sprint-dashboard.js lines 238–250).
   */
  const loadAvailableSprints = useCallback(async () => {
    const currentBoardId = state.boardId;
    // Abort if already fetched (null = not yet fetched, array = already fetched).
    if (!currentBoardId || state.availableSprints !== null) return;

    setState((prev) => ({ ...prev, isLoadingAvailableSprints: true }));
    try {
      const sprintsResponse = await jiraGet<JiraSprintListResponse>(
        `${BOARDS_API_PATH}/${currentBoardId}/sprint?state=active,future&maxResults=20`,
      );
      setState((prev) => ({
        ...prev,
        availableSprints: sprintsResponse.values ?? [],
        isLoadingAvailableSprints: false,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        availableSprints: [],
        isLoadingAvailableSprints: false,
      }));
    }
  }, [state.boardId, state.availableSprints]);

  // ── Move-to-sprint action ──

  /**
   * Calls the Jira Agile REST API to move an issue into a different sprint, then
   * removes it from the local sprintIssues list so the card disappears immediately.
   * Uses raw fetch (rather than jiraPost) because the Jira endpoint returns 204 No Content.
   * Corresponds to sdMoveIssueSprint (07-sprint-dashboard.js lines 284–308).
   */
  const moveIssueToSprint = useCallback(async (issueKey: string, targetSprintId: number) => {
    const response = await fetch(`/jira-proxy/rest/agile/1.0/sprint/${targetSprintId}/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues: [issueKey] }),
    });

    if (!response.ok) {
      throw new Error(`Move failed: ${response.status}`);
    }

    // Remove the issue from local state so a re-render does not bring it back.
    setState((prev) => ({
      ...prev,
      sprintIssues: prev.sprintIssues.filter((issue) => issue.key !== issueKey),
    }));
  }, []);

  const actions = useMemo<SprintDataActions>(
    () => ({
      setProjectKey,
      setActiveTab,
      loadSprint,
      resetTimer,
      tickTimer,
      startTimer,
      stopTimer,
      selectBoard,
      loadAvailableSprints,
      moveIssueToSprint,
    }),
    [
      setProjectKey,
      setActiveTab,
      loadSprint,
      resetTimer,
      tickTimer,
      startTimer,
      stopTimer,
      selectBoard,
      loadAvailableSprints,
      moveIssueToSprint,
    ],
  );

  return { state, actions };
}
