// useMyIssuesState.ts — State management hook for the My Issues view.
//
// Handles issue fetching from multiple sources (mine, JQL, saved filters, boards),
// view mode switching, persona filtering, and JQL history management.

import { useCallback, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraBoard, JiraFilter, JiraIssue } from '../../../types/jira.ts';

// ── Source and display type unions ──

export type IssueSource = 'mine' | 'jql' | 'filter' | 'board';
export type ViewMode = 'cards' | 'compact' | 'table';
export type SortField = 'updated' | 'priority' | 'due' | 'created' | 'project';
export type Persona = 'dev' | 'qa' | 'sm' | 'po';

// ── Named API path constants ──

const MY_ISSUES_JQL =
  'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
const ISSUE_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,created,updated,description';
const MAX_RESULTS = 100;
const MAX_JQL_HISTORY = 10;
const BOARDS_PATH_PREFIX = '/rest/agile/1.0/board';
const FAVOURITE_FILTERS_PATH = '/rest/api/2/filter/favourite';
const SEARCH_PATH = '/rest/api/2/search';

const FETCH_FAILURE_MESSAGE = 'Failed to fetch issues';
const EMPTY_FETCH_ERROR = null;

// ── State and actions interfaces ──

export interface MyIssuesState {
  source: IssueSource;
  viewMode: ViewMode;
  sortBy: SortField;
  persona: Persona;
  jqlQuery: string;
  /** Last MAX_JQL_HISTORY unique JQL queries, newest first. */
  jqlHistory: string[];
  activeStatusZone: string | null;
  issues: JiraIssue[];
  isFetching: boolean;
  fetchError: string | null;
  availableBoards: JiraBoard[];
  selectedBoardId: number | null;
  savedFilters: JiraFilter[];
  selectedFilterId: string | null;
}

export interface MyIssuesActions {
  setSource(source: IssueSource): void;
  setViewMode(viewMode: ViewMode): void;
  setSortBy(sortBy: SortField): void;
  setPersona(persona: Persona): void;
  setJqlQuery(query: string): void;
  setActiveStatusZone(zone: string | null): void;
  setSelectedBoardId(boardId: number | null): void;
  setSelectedFilterId(filterId: string | null): void;
  fetchMyIssues(): Promise<void>;
  runJqlQuery(): Promise<void>;
  loadBoards(searchTerm: string): Promise<void>;
  loadSavedFilters(): Promise<void>;
  runSavedFilter(): Promise<void>;
  runBoardIssues(): Promise<void>;
}

// ── API response shapes ──

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
}

interface JiraBoardListResponse {
  values: JiraBoard[];
}

interface JiraSprintListResponse {
  values: Array<{ id: number; name: string; state: string }>;
}

interface JiraSprintIssuesResponse {
  issues: JiraIssue[];
}

// ── Helper functions ──

function createInitialMyIssuesState(): MyIssuesState {
  return {
    source: 'mine',
    viewMode: 'cards',
    sortBy: 'updated',
    persona: 'dev',
    jqlQuery: '',
    jqlHistory: [],
    activeStatusZone: null,
    issues: [],
    isFetching: false,
    fetchError: EMPTY_FETCH_ERROR,
    availableBoards: [],
    selectedBoardId: null,
    savedFilters: [],
    selectedFilterId: null,
  };
}

/** Builds the Jira search URL for a given JQL expression. */
function buildSearchPath(jql: string): string {
  const encodedJql = encodeURIComponent(jql);
  return `${SEARCH_PATH}?jql=${encodedJql}&maxResults=${MAX_RESULTS}&fields=${ISSUE_FIELDS}`;
}

/** Prepends a query to the history list, deduplicating and capping at MAX_JQL_HISTORY. */
function buildUpdatedJqlHistory(newQuery: string, currentHistory: string[]): string[] {
  const deduplicatedHistory = currentHistory.filter(
    (previousQuery) => previousQuery !== newQuery,
  );
  return [newQuery, ...deduplicatedHistory].slice(0, MAX_JQL_HISTORY);
}

/** Extracts a human-readable error message from an unknown thrown value. */
function extractErrorMessage(unknownError: unknown): string {
  return unknownError instanceof Error ? unknownError.message : FETCH_FAILURE_MESSAGE;
}

// ── Hook ──

/**
 * Manages all state and async actions for the My Issues view.
 * Returns a stable `{ state, actions }` tuple so the view stays thin.
 */
export function useMyIssuesState(): { state: MyIssuesState; actions: MyIssuesActions } {
  const [state, setState] = useState<MyIssuesState>(() => createInitialMyIssuesState());

  // ── Synchronous setters ──

  const setSource = useCallback((source: IssueSource) => {
    setState((previousState) => ({ ...previousState, source }));
  }, []);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setState((previousState) => ({ ...previousState, viewMode }));
  }, []);

  const setSortBy = useCallback((sortBy: SortField) => {
    setState((previousState) => ({ ...previousState, sortBy }));
  }, []);

  const setPersona = useCallback((persona: Persona) => {
    setState((previousState) => ({ ...previousState, persona }));
  }, []);

  const setJqlQuery = useCallback((jqlQuery: string) => {
    setState((previousState) => ({ ...previousState, jqlQuery }));
  }, []);

  const setActiveStatusZone = useCallback((activeStatusZone: string | null) => {
    setState((previousState) => ({ ...previousState, activeStatusZone }));
  }, []);

  const setSelectedBoardId = useCallback((selectedBoardId: number | null) => {
    setState((previousState) => ({ ...previousState, selectedBoardId }));
  }, []);

  const setSelectedFilterId = useCallback((selectedFilterId: string | null) => {
    setState((previousState) => ({ ...previousState, selectedFilterId }));
  }, []);

  // ── Async fetchers ──

  /** Fetches issues assigned to the current user from Jira. */
  const fetchMyIssues = useCallback(async () => {
    setState((previousState) => ({
      ...previousState,
      isFetching: true,
      fetchError: EMPTY_FETCH_ERROR,
    }));

    try {
      const searchPath = buildSearchPath(MY_ISSUES_JQL);
      const response = await jiraGet<JiraSearchResponse>(searchPath);

      setState((previousState) => ({
        ...previousState,
        issues: response.issues,
        isFetching: false,
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isFetching: false,
        fetchError: extractErrorMessage(unknownError),
      }));
    }
  }, []);

  /** Runs the current jqlQuery and prepends it to jqlHistory on success. */
  const runJqlQuery = useCallback(async () => {
    setState((previousState) => ({
      ...previousState,
      isFetching: true,
      fetchError: EMPTY_FETCH_ERROR,
    }));

    try {
      // Capture the current query before async work so we use the right value.
      const currentQuery = state.jqlQuery;
      const searchPath = buildSearchPath(currentQuery);
      const response = await jiraGet<JiraSearchResponse>(searchPath);

      setState((previousState) => ({
        ...previousState,
        issues: response.issues,
        isFetching: false,
        jqlHistory: buildUpdatedJqlHistory(currentQuery, previousState.jqlHistory),
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isFetching: false,
        fetchError: extractErrorMessage(unknownError),
      }));
    }
  }, [state.jqlQuery]);

  /** Searches for Jira boards matching the given search term. */
  const loadBoards = useCallback(async (searchTerm: string) => {
    try {
      const encodedTerm = encodeURIComponent(searchTerm);
      const response = await jiraGet<JiraBoardListResponse>(
        `${BOARDS_PATH_PREFIX}?name=${encodedTerm}`,
      );

      setState((previousState) => ({
        ...previousState,
        availableBoards: response.values,
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        fetchError: extractErrorMessage(unknownError),
      }));
    }
  }, []);

  /** Loads the user's favourite Jira filters. */
  const loadSavedFilters = useCallback(async () => {
    try {
      const response = await jiraGet<JiraFilter[]>(FAVOURITE_FILTERS_PATH);

      setState((previousState) => ({
        ...previousState,
        savedFilters: response,
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        fetchError: extractErrorMessage(unknownError),
      }));
    }
  }, []);

  /** Runs the currently selected saved filter's JQL. */
  const runSavedFilter = useCallback(async () => {
    const selectedFilter = state.savedFilters.find(
      (savedFilter) => savedFilter.id === state.selectedFilterId,
    );

    if (!selectedFilter) {
      return;
    }

    setState((previousState) => ({
      ...previousState,
      isFetching: true,
      fetchError: EMPTY_FETCH_ERROR,
    }));

    try {
      const searchPath = buildSearchPath(selectedFilter.jql);
      const response = await jiraGet<JiraSearchResponse>(searchPath);

      setState((previousState) => ({
        ...previousState,
        issues: response.issues,
        isFetching: false,
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isFetching: false,
        fetchError: extractErrorMessage(unknownError),
      }));
    }
  }, [state.savedFilters, state.selectedFilterId]);

  /** Fetches the active sprint issues for the selected board. */
  const runBoardIssues = useCallback(async () => {
    if (!state.selectedBoardId) {
      return;
    }

    setState((previousState) => ({
      ...previousState,
      isFetching: true,
      fetchError: EMPTY_FETCH_ERROR,
    }));

    try {
      const sprintResponse = await jiraGet<JiraSprintListResponse>(
        `${BOARDS_PATH_PREFIX}/${state.selectedBoardId}/sprint?state=active`,
      );

      const activeSprint = sprintResponse.values[0];
      if (!activeSprint) {
        setState((previousState) => ({
          ...previousState,
          isFetching: false,
          issues: [],
        }));
        return;
      }

      const issuesResponse = await jiraGet<JiraSprintIssuesResponse>(
        `/rest/agile/1.0/sprint/${activeSprint.id}/issue?maxResults=${MAX_RESULTS}&fields=${ISSUE_FIELDS}`,
      );

      setState((previousState) => ({
        ...previousState,
        issues: issuesResponse.issues,
        isFetching: false,
      }));
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isFetching: false,
        fetchError: extractErrorMessage(unknownError),
      }));
    }
  }, [state.selectedBoardId]);

  const actions = useMemo<MyIssuesActions>(
    () => ({
      setSource,
      setViewMode,
      setSortBy,
      setPersona,
      setJqlQuery,
      setActiveStatusZone,
      setSelectedBoardId,
      setSelectedFilterId,
      fetchMyIssues,
      runJqlQuery,
      loadBoards,
      loadSavedFilters,
      runSavedFilter,
      runBoardIssues,
    }),
    [
      setSource,
      setViewMode,
      setSortBy,
      setPersona,
      setJqlQuery,
      setActiveStatusZone,
      setSelectedBoardId,
      setSelectedFilterId,
      fetchMyIssues,
      runJqlQuery,
      loadBoards,
      loadSavedFilters,
      runSavedFilter,
      runBoardIssues,
    ],
  );

  return { state, actions };
}
