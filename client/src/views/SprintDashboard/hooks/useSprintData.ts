// useSprintData.ts — State management hook for the Sprint Dashboard view.
//
// Handles loading sprints and issues from Jira, with full Kanban board support:
//   1. Restores the previously-selected board and project from the shared settings store.
//   2. If no saved board, fetches the board list for the configured project and picks the first.
//   3. Detects board type (scrum vs kanban) via GET /rest/agile/1.0/board/{id}.
//   4. For scrum boards: fetches the active sprint then sprint issues.
//      For kanban boards: fetches board issues directly (no sprint required).
// Also manages the standup timer countdown, move-to-sprint, and available-sprints caching.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { fetchPiNameSuggestions } from '../../../services/piNameSuggestions.ts';
import { filterPiNamesToPlanningWindow } from '../../ArtView/hooks/artHelpers.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { useSettingsStore } from '../../../store/settingsStore.ts';
import type { JiraBoard, JiraIssue, JiraSprint, JiraVersion } from '../../../types/jira.ts';

// ── Named constants ──

const STANDUP_TIMER_SECONDS = 900; // 15 minutes
const SPRINT_ISSUE_MAX_RESULTS = 200;
const BOARD_SCOPE_SPRINT_MAX_RESULTS = 50;
const PI_JQL_FIELD_ID = 'cf[10301]';
// The same PI field in stored-id form, used to fetch the field's valid values (incl. future PIs).
const PI_AUTOCOMPLETE_FIELD_ID = 'customfield_10301';
const DASHBOARD_SCOPE_MODE_SPRINT = 'sprint';
const DASHBOARD_SCOPE_MODE_FIX_VERSION = 'fixVersion';
const DASHBOARD_SCOPE_MODE_PI = 'pi';
const SPRINT_ISSUE_BASE_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,created,updated,description,customfield_10016,customfield_10021,customfield_10301,fixVersions,issuelinks';

/** Returns the full field list for sprint/board issue requests, appending the configured
 *  story-points field when it differs from the legacy customfield_10016 already in the base. */
function buildSprintIssueFieldList(customStoryPointsFieldId: string): string {
  const shouldAppend =
    customStoryPointsFieldId
    && customStoryPointsFieldId !== 'customfield_10016'
    && !SPRINT_ISSUE_BASE_FIELDS.includes(customStoryPointsFieldId);
  return shouldAppend
    ? `${SPRINT_ISSUE_BASE_FIELDS},${customStoryPointsFieldId}`
    : SPRINT_ISSUE_BASE_FIELDS;
}
const BOARDS_API_PATH = '/rest/agile/1.0/board';
const NO_ACTIVE_SPRINT_MESSAGE =
  'No active sprint found on this board. Try selecting a different scrum board in Settings, or switch to a kanban board.';

const LOAD_FAILURE_MESSAGE = 'Failed to load sprint';

// ── Type definitions ──

export type DashboardTab =
  | 'overview'
  | 'assignee'
  | 'blockers'
  | 'defects'
  | 'hygiene'
  | 'standup'
  | 'settings'
  | 'metrics'
  | 'pipeline'
  | 'planning'
  | 'releases'
  | 'pointing'
  | 'pireview'
  | 'featurereview'
  | 'backlogremediation';

export type DashboardScopeMode =
  | typeof DASHBOARD_SCOPE_MODE_SPRINT
  | typeof DASHBOARD_SCOPE_MODE_FIX_VERSION
  | typeof DASHBOARD_SCOPE_MODE_PI;

const DEFAULT_DASHBOARD_TAB: DashboardTab = 'overview';
const LEGACY_ROSTER_TAB = 'roster';

export interface SprintDataState {
  projectKey: string;
  activeTab: DashboardTab;
  scopeMode: DashboardScopeMode;
  selectedSprintId: number | null;
  selectedFixVersionName: string;
  selectedPiValue: string;
  sprintInfo: JiraSprint | null;
  sprintIssues: JiraIssue[];
  isLoadingSprint: boolean;
  loadError: string | null;
  isTimerRunning: boolean;
  timerSecondsRemaining: number;
  /** The Jira board id currently driving the dashboard. */
  boardId: number | null;
  selectedBoardName: string | null;
  /** 'kanban' boards have no sprints; issues are loaded directly from the board. */
  boardType: 'scrum' | 'kanban' | null;
  /** All boards returned by the last board-list fetch (used to populate the board picker). */
  availableBoards: JiraBoard[];
  /** All scope-selectable sprints for the current board. */
  availableScopeSprints: JiraSprint[];
  /** All selectable fix versions for the current project. */
  availableFixVersions: JiraVersion[];
  /** All PI values observed on the current project issues. */
  availablePiValues: string[];
  /**
   * Active and future sprints for the current board, used to populate the move-to-sprint dropdown.
   * null means not yet fetched; [] means fetched but the board has no other sprints.
   */
  availableSprints: JiraSprint[] | null;
  isLoadingAvailableSprints: boolean;
  /**
   * True once the user has changed the working selection (project, board, or scope) since the
   * active team was last loaded or saved. Drives the "unsaved changes" prompt and Save/Revert.
   * Auto-resolution during a load never sets this — only explicit user actions do.
   */
  hasUnsavedTeamChanges: boolean;
}

export interface SprintDataActions {
  setProjectKey(key: string): void;
  setActiveTab(tab: DashboardTab): void;
  loadSprint(): Promise<void>;
  setScopeMode(scopeMode: DashboardScopeMode): Promise<void>;
  selectSprintScope(sprintId: number): Promise<void>;
  selectFixVersionScope(fixVersionName: string): Promise<void>;
  selectPiScope(piValue: string): Promise<void>;
  resetTimer(): void;
  tickTimer(): void;
  startTimer(): void;
  stopTimer(): void;
  /** Selects a specific board, persists it, and reloads issues. */
  selectBoard(boardId: number): Promise<void>;
  /** Lazily fetches active + future sprints for the current board. No-op if already fetched. */
  loadAvailableSprints(): Promise<void>;
  /** Moves an issue to a target sprint and removes it from the local sprint issues list. */
  moveIssueToSprint(issueKey: string, targetSprintId: number): Promise<void>;
  /** Clears the unsaved-changes flag after the working selection has been saved to the team profile. */
  markTeamChangesSaved(): void;
}

// ── API response shapes ──

interface JiraBoardListResponse {
  values: JiraBoard[];
}

interface JiraBoardInfoResponse {
  name?: string;
  type: string;
  location?: { projectKey?: string };
}

interface JiraSprintListResponse {
  values: JiraSprint[];
}

interface JiraSprintIssuesResponse {
  issues: JiraIssue[];
}

// ── Shared settings helpers ──

function isDashboardScopeMode(value: string): value is DashboardScopeMode {
  return [
    DASHBOARD_SCOPE_MODE_SPRINT,
    DASHBOARD_SCOPE_MODE_FIX_VERSION,
    DASHBOARD_SCOPE_MODE_PI,
  ].includes(value as DashboardScopeMode);
}

function normalizeProjectKey(projectKey: string): string {
  return projectKey.trim().toUpperCase();
}

/** Reads the persisted board id from the shared settings store; returns null when absent or unreadable. */
function readPersistedBoardId(): number | null {
  const storedBoardId = useSettingsStore.getState().sprintDashboardBoardId.trim();
  if (!storedBoardId) {
    return null;
  }

  const parsedBoardId = Number(storedBoardId);
  return Number.isFinite(parsedBoardId) ? parsedBoardId : null;
}

/** Saves or clears the selected board id in the shared settings store. */
function persistBoardId(boardId: number | null): void {
  useSettingsStore.getState().setSprintDashboardBoardId(boardId === null ? '' : String(boardId));
}

/** Restores the saved project key, falling back to the DSU project when Sprint Dashboard is still blank. */
function readPersistedProjectKey(): string {
  const settingsState = useSettingsStore.getState();
  return settingsState.sprintDashboardProjectKey || settingsState.dsuProjectKey;
}

/** Chooses the initial Team Dashboard tab based on setup readiness. */
function readPersistedActiveTab(): DashboardTab {
  const storedActiveTab = useSettingsStore.getState().sprintDashboardActiveTab;
  if (storedActiveTab === LEGACY_ROSTER_TAB) {
    return 'settings';
  }

  const hasConfiguredProjectKey = Boolean(readPersistedProjectKey().trim());
  const hasConfiguredBoardId = readPersistedBoardId() !== null;
  const isJiraReady = useConnectionStore.getState().isJiraReady;
  const isInitialDashboardSetupComplete = hasConfiguredProjectKey && hasConfiguredBoardId && isJiraReady;

  return isInitialDashboardSetupComplete ? DEFAULT_DASHBOARD_TAB : 'settings';
}

/** Restores the last Team Dashboard scope mode and falls back to sprint when invalid. */
function readPersistedScopeMode(): DashboardScopeMode {
  const storedScopeMode = useSettingsStore.getState().sprintDashboardScopeMode;
  return isDashboardScopeMode(storedScopeMode)
    ? storedScopeMode
    : DASHBOARD_SCOPE_MODE_SPRINT;
}

function readPersistedSelectedSprintId(): number | null {
  const storedSprintId = useSettingsStore.getState().sprintDashboardSelectedSprintId.trim();
  if (!storedSprintId) {
    return null;
  }

  const parsedSprintId = Number(storedSprintId);
  return Number.isFinite(parsedSprintId) ? parsedSprintId : null;
}

function readPersistedSelectedFixVersionName(): string {
  return useSettingsStore.getState().sprintDashboardSelectedFixVersion.trim();
}

function readPersistedSelectedPiValue(): string {
  return useSettingsStore.getState().sprintDashboardSelectedPiValue.trim();
}

/** Persists the selected project key to both Sprint Dashboard and DSU settings. */
function persistProjectKey(projectKey: string): void {
  const settingsState = useSettingsStore.getState();
  settingsState.setSprintDashboardProjectKey(projectKey);
  settingsState.setDsuProjectKey(projectKey);
}

/** Persists the currently selected tab so the dashboard reopens to the same workspace. */
function persistActiveTab(activeTab: DashboardTab): void {
  useSettingsStore.getState().setSprintDashboardActiveTab(activeTab);
}

function persistScopeMode(scopeMode: DashboardScopeMode): void {
  useSettingsStore.getState().setSprintDashboardScopeMode(scopeMode);
}

function persistSelectedSprintId(sprintId: number | null): void {
  useSettingsStore.getState().setSprintDashboardSelectedSprintId(
    sprintId === null ? '' : String(sprintId),
  );
}

function persistSelectedFixVersionName(fixVersionName: string): void {
  useSettingsStore.getState().setSprintDashboardSelectedFixVersion(fixVersionName);
}

function persistSelectedPiValue(piValue: string): void {
  useSettingsStore.getState().setSprintDashboardSelectedPiValue(piValue);
}

// ── Internal helpers ──

function createInitialSprintDataState(): SprintDataState {
  return {
    projectKey: readPersistedProjectKey(),
    activeTab: readPersistedActiveTab(),
    scopeMode: readPersistedScopeMode(),
    selectedSprintId: readPersistedSelectedSprintId(),
    selectedFixVersionName: readPersistedSelectedFixVersionName(),
    selectedPiValue: readPersistedSelectedPiValue(),
    sprintInfo: null,
    sprintIssues: [],
    isLoadingSprint: false,
    loadError: null,
    isTimerRunning: false,
    timerSecondsRemaining: STANDUP_TIMER_SECONDS,
    boardId: readPersistedBoardId(),
    selectedBoardName: null,
    boardType: null,
    availableBoards: [],
    availableScopeSprints: [],
    availableFixVersions: [],
    availablePiValues: [],
    availableSprints: null,
    isLoadingAvailableSprints: false,
    hasUnsavedTeamChanges: false,
  };
}

/** Extracts a human-readable error message from an unknown thrown value. */
function extractErrorMessage(unknownError: unknown): string {
  return unknownError instanceof Error ? unknownError.message : LOAD_FAILURE_MESSAGE;
}

function buildBoardsUrl(projectKey: string): string {
  return projectKey
    ? `${BOARDS_API_PATH}?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`
    : `${BOARDS_API_PATH}?maxResults=100`;
}

async function loadAvailableBoardsForProject(projectKey: string): Promise<JiraBoard[]> {
  const boardResponse = await jiraGet<JiraBoardListResponse>(buildBoardsUrl(projectKey));
  return boardResponse.values ?? [];
}

function buildIssueSearchPath(jql: string, fieldList: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fieldList}&maxResults=${SPRINT_ISSUE_MAX_RESULTS}&expand=changelog`;
}

function escapeJqlValue(jqlValue: string): string {
  return jqlValue.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function createAlphabeticalValues(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((leftValue, rightValue) =>
    leftValue.localeCompare(rightValue),
  );
}

function readIssuePiValue(issue: JiraIssue): string {
  if (typeof issue.fields.customfield_10301 === 'string') {
    return issue.fields.customfield_10301;
  }

  return issue.fields.customfield_10301?.value ?? issue.fields.customfield_10301?.name ?? '';
}

function sortScopeSprints(scopeSprints: JiraSprint[]): JiraSprint[] {
  const sprintStateOrder: Record<JiraSprint['state'], number> = { active: 0, future: 1, closed: 2 };
  return [...scopeSprints].sort((leftSprint, rightSprint) => {
    const stateDifference =
      sprintStateOrder[leftSprint.state] - sprintStateOrder[rightSprint.state];
    if (stateDifference !== 0) {
      return stateDifference;
    }

    return new Date(rightSprint.startDate ?? '').getTime() - new Date(leftSprint.startDate ?? '').getTime();
  });
}

function sortScopeVersions(scopeVersions: JiraVersion[]): JiraVersion[] {
  return [...scopeVersions]
    .filter((scopeVersion) => !scopeVersion.archived)
    .sort((leftVersion, rightVersion) => {
      if (Boolean(leftVersion.released) !== Boolean(rightVersion.released)) {
        return leftVersion.released ? 1 : -1;
      }
      if (leftVersion.releaseDate && rightVersion.releaseDate) {
        return new Date(leftVersion.releaseDate).getTime() - new Date(rightVersion.releaseDate).getTime();
      }
      return leftVersion.name.localeCompare(rightVersion.name);
    });
}

// ── Hook ──

/**
 * Manages sprint data and standup timer state for the Sprint Dashboard view.
 * Returns a stable `{ state, actions }` tuple so the view remains a thin consumer.
 */
export function useSprintData(
  activeDashboardTeamProfileId = '',
  customStoryPointsFieldId = '',
  hydrationNonce = 0,
): { state: SprintDataState; actions: SprintDataActions } {
  const [state, setState] = useState<SprintDataState>(() => createInitialSprintDataState());

  // Held in a ref so callbacks can read the current value without being re-created
  // every time the configured story-points field changes.
  const sprintFieldListRef = useRef(buildSprintIssueFieldList(customStoryPointsFieldId));
  useEffect(() => {
    sprintFieldListRef.current = buildSprintIssueFieldList(customStoryPointsFieldId);
  }, [customStoryPointsFieldId]);

  // Re-hydrate the working selection from persisted settings whenever the active team changes
  // (id) or a Revert re-writes the draft (hydrationNonce). This clears any unsaved-changes flag.
  useEffect(() => {
    setState(createInitialSprintDataState());
  }, [activeDashboardTeamProfileId, hydrationNonce]);

  // ── Synchronous setters ──

  const setProjectKey = useCallback((projectKey: string) => {
    const hasProjectSelectionChanged =
      normalizeProjectKey(readPersistedProjectKey()) !== normalizeProjectKey(projectKey);

    persistProjectKey(projectKey);
    if (hasProjectSelectionChanged) {
      // A board belongs to one Jira project, so switching projects must clear the old board choice.
      persistBoardId(null);
      persistSelectedSprintId(null);
      persistSelectedFixVersionName('');
      persistSelectedPiValue('');
    }

    setState((previousState) => ({
      ...previousState,
      projectKey,
      boardId: hasProjectSelectionChanged ? null : previousState.boardId,
      selectedBoardName: hasProjectSelectionChanged ? null : previousState.selectedBoardName,
      boardType: hasProjectSelectionChanged ? null : previousState.boardType,
      availableBoards: hasProjectSelectionChanged ? [] : previousState.availableBoards,
      availableScopeSprints: hasProjectSelectionChanged ? [] : previousState.availableScopeSprints,
      availableFixVersions: hasProjectSelectionChanged ? [] : previousState.availableFixVersions,
      availablePiValues: hasProjectSelectionChanged ? [] : previousState.availablePiValues,
      availableSprints: hasProjectSelectionChanged ? null : previousState.availableSprints,
      selectedSprintId: hasProjectSelectionChanged ? null : previousState.selectedSprintId,
      selectedFixVersionName: hasProjectSelectionChanged ? '' : previousState.selectedFixVersionName,
      selectedPiValue: hasProjectSelectionChanged ? '' : previousState.selectedPiValue,
      sprintInfo: hasProjectSelectionChanged ? null : previousState.sprintInfo,
      sprintIssues: hasProjectSelectionChanged ? [] : previousState.sprintIssues,
      loadError: hasProjectSelectionChanged ? null : previousState.loadError,
      hasUnsavedTeamChanges: true,
    }));
  }, []);

  const setActiveTab = useCallback((activeTab: DashboardTab) => {
    persistActiveTab(activeTab);
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

  function createSelectedBoardName(
    boardId: number,
    boardNameFromMetadata: string | undefined,
    availableBoards: JiraBoard[],
  ): string | null {
    return boardNameFromMetadata
      ?? availableBoards.find((availableBoard) => availableBoard.id === boardId)?.name
      ?? null;
  }

  async function loadProjectScopeMetadata(projectKey: string): Promise<{
    availableFixVersions: JiraVersion[];
    availablePiValues: string[];
  }> {
    if (!projectKey) {
      return { availableFixVersions: [], availablePiValues: [] };
    }

    const [versionResponse, piResponse, piSuggestions] = await Promise.all([
      jiraGet<JiraVersion[]>(
        `/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`,
      ).catch(() => []),
      jiraGet<{ issues?: JiraIssue[] }>(
        buildIssueSearchPath(
          `project = "${escapeJqlValue(projectKey)}" AND ${PI_JQL_FIELD_ID} is not EMPTY ORDER BY updated DESC`,
          sprintFieldListRef.current,
        ),
      ).catch(() => ({ issues: [] })),
      // The field's valid values include future PIs no issue references yet — the issue query can't see those.
      fetchPiNameSuggestions(PI_AUTOCOMPLETE_FIELD_ID).catch(() => []),
    ]);

    // Combine PIs actually used on issues with the field's valid values, then narrow to the planning
    // window (current PI + all future PIs + one most-recent prior PI) so the selector is not cluttered
    // with years-old increments and always offers the upcoming PIs the user needs for planning.
    const combinedPiValues = [
      ...(piResponse.issues ?? []).map(readIssuePiValue).filter(Boolean),
      ...piSuggestions,
    ];

    return {
      availableFixVersions: sortScopeVersions(versionResponse),
      availablePiValues: createAlphabeticalValues(filterPiNamesToPlanningWindow(combinedPiValues)),
    };
  }

  function resolveScopeSprint(availableScopeSprints: JiraSprint[]): JiraSprint | null {
    const persistedSprintId = readPersistedSelectedSprintId();
    if (persistedSprintId !== null) {
      const matchingSprint = availableScopeSprints.find(
        (availableScopeSprint) => availableScopeSprint.id === persistedSprintId,
      );
      if (matchingSprint) {
        return matchingSprint;
      }
    }

    return availableScopeSprints.find(
      (availableScopeSprint) => availableScopeSprint.state === 'active',
    ) ?? availableScopeSprints[0] ?? null;
  }

  const loadProjectScopeIssues = useCallback(async (
    projectKey: string,
    scopeMode: DashboardScopeMode,
    availableFixVersions: JiraVersion[],
    availablePiValues: string[],
    availableScopeSprints: JiraSprint[],
    selectedBoardName: string | null,
    boardType: 'scrum' | 'kanban',
  ) => {
    const resolvedSprint = resolveScopeSprint(availableScopeSprints);
    const persistedFixVersionName = readPersistedSelectedFixVersionName();
    const persistedPiValue = readPersistedSelectedPiValue();
    const resolvedFixVersionName =
      availableFixVersions.find(
        (availableFixVersion) => availableFixVersion.name === persistedFixVersionName,
      )?.name
      ?? availableFixVersions[0]?.name
      ?? '';
    const resolvedPiValue =
      availablePiValues.find((availablePiValue) => availablePiValue === persistedPiValue)
      ?? availablePiValues[0]
      ?? '';

    if (resolvedSprint) {
      persistSelectedSprintId(resolvedSprint.id);
    }
    persistSelectedFixVersionName(resolvedFixVersionName);
    persistSelectedPiValue(resolvedPiValue);

    const nextScopedState = {
      scopeMode,
      selectedSprintId: resolvedSprint?.id ?? null,
      selectedFixVersionName: resolvedFixVersionName,
      selectedPiValue: resolvedPiValue,
      sprintInfo: null,
      selectedBoardName,
      boardType,
      availableScopeSprints,
      availableFixVersions,
      availablePiValues,
      isLoadingSprint: false,
      loadError: null as string | null,
    };

    if (scopeMode === DASHBOARD_SCOPE_MODE_FIX_VERSION && !resolvedFixVersionName) {
      setState((previousState) => ({ ...previousState, ...nextScopedState, sprintIssues: [] }));
      return;
    }

    if (scopeMode === DASHBOARD_SCOPE_MODE_PI && !resolvedPiValue) {
      setState((previousState) => ({ ...previousState, ...nextScopedState, sprintIssues: [] }));
      return;
    }

    const scopedJql =
      scopeMode === DASHBOARD_SCOPE_MODE_FIX_VERSION
        ? `project = "${escapeJqlValue(projectKey)}" AND fixVersion = "${escapeJqlValue(resolvedFixVersionName)}" ORDER BY updated DESC`
        : `project = "${escapeJqlValue(projectKey)}" AND ${PI_JQL_FIELD_ID} = "${escapeJqlValue(resolvedPiValue)}" ORDER BY updated DESC`;
    const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(buildIssueSearchPath(scopedJql, sprintFieldListRef.current));
    setState((previousState) => ({
      ...previousState,
      ...nextScopedState,
      sprintIssues: issuesResponse.issues ?? [],
    }));
  }, []);

  const loadKanbanBoardIssues = useCallback(async (
    boardId: number,
    projectKey: string,
    selectedBoardName: string | null,
    availableFixVersions: JiraVersion[],
    availablePiValues: string[],
  ) => {
    const persistedScopeMode = readPersistedScopeMode();
    if (persistedScopeMode !== DASHBOARD_SCOPE_MODE_SPRINT) {
      await loadProjectScopeIssues(
        projectKey,
        persistedScopeMode,
        availableFixVersions,
        availablePiValues,
        [],
        selectedBoardName,
        'kanban',
      );
      return;
    }

    const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(
      `${BOARDS_API_PATH}/${boardId}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${sprintFieldListRef.current}&expand=changelog`,
    );
    persistSelectedSprintId(null);
    setState((previousState) => ({
      ...previousState,
      scopeMode: DASHBOARD_SCOPE_MODE_SPRINT,
      selectedSprintId: null,
      sprintInfo: null,
      sprintIssues: issuesResponse.issues,
      selectedBoardName,
      boardType: 'kanban',
      availableScopeSprints: [],
      availableFixVersions,
      availablePiValues,
      isLoadingSprint: false,
      loadError: null,
    }));
  }, [loadProjectScopeIssues]);

  const loadScrumScopeIssues = useCallback(async (
    boardId: number,
    projectKey: string,
    selectedBoardName: string | null,
    availableFixVersions: JiraVersion[],
    availablePiValues: string[],
  ) => {
    const sprintResponse = await jiraGet<JiraSprintListResponse>(
      `${BOARDS_API_PATH}/${boardId}/sprint?state=active,future,closed&maxResults=${BOARD_SCOPE_SPRINT_MAX_RESULTS}`,
    );
    const availableScopeSprints = sortScopeSprints(sprintResponse.values ?? []);
    const persistedScopeMode = readPersistedScopeMode();

    if (persistedScopeMode !== DASHBOARD_SCOPE_MODE_SPRINT) {
      await loadProjectScopeIssues(
        projectKey,
        persistedScopeMode,
        availableFixVersions,
        availablePiValues,
        availableScopeSprints,
        selectedBoardName,
        'scrum',
      );
      return;
    }

    const selectedScopeSprint = resolveScopeSprint(availableScopeSprints);
    if (!selectedScopeSprint) {
      persistSelectedSprintId(null);
      setState((previousState) => ({
        ...previousState,
        scopeMode: DASHBOARD_SCOPE_MODE_SPRINT,
        selectedSprintId: null,
        sprintInfo: null,
        sprintIssues: [],
        selectedBoardName,
        boardType: 'scrum',
        availableScopeSprints,
        availableFixVersions,
        availablePiValues,
        isLoadingSprint: false,
        loadError: NO_ACTIVE_SPRINT_MESSAGE,
      }));
      return;
    }

    persistSelectedSprintId(selectedScopeSprint.id);
    const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(
      `/rest/agile/1.0/sprint/${selectedScopeSprint.id}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${sprintFieldListRef.current}&expand=changelog`,
    );
    setState((previousState) => ({
      ...previousState,
      scopeMode: DASHBOARD_SCOPE_MODE_SPRINT,
      selectedSprintId: selectedScopeSprint.id,
      sprintInfo: selectedScopeSprint,
      sprintIssues: issuesResponse.issues,
      selectedBoardName,
      boardType: 'scrum',
      availableScopeSprints,
      availableFixVersions,
      availablePiValues,
      isLoadingSprint: false,
      loadError: null,
    }));
  }, [loadProjectScopeIssues]);

  // ── Board-level loader: handles both scrum and kanban paths ──

  /**
   * Fetches board metadata, discovers project-level scope options, and then loads the active Team Dashboard scope.
   * Keeping this orchestration in one place prevents tab-by-tab scope drift.
   */
  const loadForBoardId = useCallback(
    async (
      boardId: number,
      fallbackProjectKey = '',
      availableBoardsFromCaller: JiraBoard[] = [],
    ) => {
      try {
        const boardInfo = await jiraGet<JiraBoardInfoResponse>(`${BOARDS_API_PATH}/${boardId}`);
        const detectedBoardType = (boardInfo.type ?? 'scrum').toLowerCase() as 'scrum' | 'kanban';
        const discoveredProjectKey = boardInfo.location?.projectKey ?? '';
        const effectiveProjectKey = discoveredProjectKey || fallbackProjectKey;
        let availableBoards = availableBoardsFromCaller;

        if (availableBoards.length === 0 && effectiveProjectKey) {
          try {
            availableBoards = await loadAvailableBoardsForProject(effectiveProjectKey);
          } catch {
            availableBoards = [];
          }
        }

        const selectedBoardName = createSelectedBoardName(
          boardId,
          boardInfo.name,
          availableBoards,
        );
        const { availableFixVersions, availablePiValues } = await loadProjectScopeMetadata(
          effectiveProjectKey,
        );

        setState((previousState) => ({
          ...previousState,
          boardId,
          selectedBoardName,
          boardType: detectedBoardType,
          projectKey: effectiveProjectKey || previousState.projectKey,
          availableBoards:
            availableBoards.length > 0 ? availableBoards : previousState.availableBoards,
          availableFixVersions,
          availablePiValues,
        }));
        if (discoveredProjectKey) {
          persistProjectKey(discoveredProjectKey);
        }

        if (detectedBoardType === 'kanban') {
          await loadKanbanBoardIssues(
            boardId,
            effectiveProjectKey,
            selectedBoardName,
            availableFixVersions,
            availablePiValues,
          );
        } else {
          await loadScrumScopeIssues(
            boardId,
            effectiveProjectKey,
            selectedBoardName,
            availableFixVersions,
            availablePiValues,
          );
        }
      } catch (unknownError) {
        setState((previousState) => ({
          ...previousState,
          isLoadingSprint: false,
          loadError: extractErrorMessage(unknownError),
        }));
      }
    },
    [loadKanbanBoardIssues, loadScrumScopeIssues],
  );

  // ── Sprint loader (entry point) ──

  /**
   * Entry point for loading the dashboard. Uses a three-tier resolution strategy:
   * 1. If a boardId is already saved in the shared settings store, use it directly.
   * 2. Otherwise fetch the board list (filtered by projectKey when provided).
   * 3. Auto-select the first board, persist it, then call loadForBoardId.
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
      const savedBoardId = readPersistedBoardId();
      if (savedBoardId !== null) {
        setState((prev) => ({ ...prev, boardId: savedBoardId }));
        await loadForBoardId(savedBoardId, state.projectKey);
        return;
      }

      // Capture projectKey before the async call so we get a consistent value.
      const currentProjectKey = state.projectKey;
      const boardResponse = await jiraGet<JiraBoardListResponse>(buildBoardsUrl(currentProjectKey));

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
      persistBoardId(firstBoardId);

      setState((prev) => ({ ...prev, availableBoards: boardResponse.values, boardId: firstBoardId }));
      await loadForBoardId(firstBoardId, currentProjectKey, boardResponse.values);
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isLoadingSprint: false,
        loadError: extractErrorMessage(unknownError),
      }));
    }
  }, [state.projectKey, loadForBoardId]);

  const reloadConfiguredScope = useCallback(async () => {
    const hasConfiguredSelection =
      readPersistedBoardId() !== null || Boolean(readPersistedProjectKey().trim());
    if (hasConfiguredSelection) {
      await loadSprint();
    }
  }, [loadSprint]);

  // Scope selections (mode, sprint, fix version, PI) choose which slice of a team's work to VIEW.
  // They persist to the shared scope keys so the view survives a reload, but they are not edits to
  // the team's saved configuration — only project/board changes are — so they must not flag the
  // profile dirty (otherwise merely picking a PI to look at would prompt a spurious Save/Revert).
  const setScopeMode = useCallback(async (scopeMode: DashboardScopeMode) => {
    persistScopeMode(scopeMode);
    setState((previousState) => ({
      ...previousState,
      scopeMode,
      loadError: null,
    }));
    await reloadConfiguredScope();
  }, [reloadConfiguredScope]);

  const selectSprintScope = useCallback(async (sprintId: number) => {
    persistScopeMode(DASHBOARD_SCOPE_MODE_SPRINT);
    persistSelectedSprintId(sprintId);
    setState((previousState) => ({
      ...previousState,
      scopeMode: DASHBOARD_SCOPE_MODE_SPRINT,
      selectedSprintId: sprintId,
      loadError: null,
    }));
    await reloadConfiguredScope();
  }, [reloadConfiguredScope]);

  const selectFixVersionScope = useCallback(async (fixVersionName: string) => {
    persistScopeMode(DASHBOARD_SCOPE_MODE_FIX_VERSION);
    persistSelectedFixVersionName(fixVersionName);
    setState((previousState) => ({
      ...previousState,
      scopeMode: DASHBOARD_SCOPE_MODE_FIX_VERSION,
      selectedFixVersionName: fixVersionName,
      loadError: null,
    }));
    await reloadConfiguredScope();
  }, [reloadConfiguredScope]);

  const selectPiScope = useCallback(async (piValue: string) => {
    persistScopeMode(DASHBOARD_SCOPE_MODE_PI);
    persistSelectedPiValue(piValue);
    setState((previousState) => ({
      ...previousState,
      scopeMode: DASHBOARD_SCOPE_MODE_PI,
      selectedPiValue: piValue,
      loadError: null,
    }));
    await reloadConfiguredScope();
  }, [reloadConfiguredScope]);

  // ── Board picker action ──

  /**
   * Selects a new board, persists it, and reloads the dashboard.
   * Resets the available-sprints cache so the move-to-sprint dropdown stays accurate.
   */
  const selectBoard = useCallback(async (boardId: number) => {
    persistBoardId(boardId);
    persistSelectedSprintId(null);
    setState((prev) => ({
      ...prev,
      boardId,
      selectedBoardName: null,
      isLoadingSprint: true,
      loadError: null,
      selectedSprintId: null,
      availableScopeSprints: [],
      availableSprints: null,
      hasUnsavedTeamChanges: true,
    }));
    await loadForBoardId(boardId, state.projectKey, state.availableBoards);
  }, [loadForBoardId, state.availableBoards, state.projectKey]);

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

  const markTeamChangesSaved = useCallback(() => {
    setState((previousState) => ({ ...previousState, hasUnsavedTeamChanges: false }));
  }, []);

  const actions = useMemo<SprintDataActions>(
    () => ({
      setProjectKey,
      setActiveTab,
      loadSprint,
      setScopeMode,
      selectSprintScope,
      selectFixVersionScope,
      selectPiScope,
      resetTimer,
      tickTimer,
      startTimer,
      stopTimer,
      selectBoard,
      loadAvailableSprints,
      moveIssueToSprint,
      markTeamChangesSaved,
    }),
    [
      setProjectKey,
      setActiveTab,
      loadSprint,
      setScopeMode,
      selectSprintScope,
      selectFixVersionScope,
      selectPiScope,
      resetTimer,
      tickTimer,
      startTimer,
      stopTimer,
      selectBoard,
      loadAvailableSprints,
      moveIssueToSprint,
      markTeamChangesSaved,
    ],
  );

  return { state, actions };
}
