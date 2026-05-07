// useMyIssuesState.ts — State management hook for the My Issues view.
//
// Handles issue fetching from multiple sources (mine, JQL, saved filters, boards),
// view mode switching, persona filtering, and JQL history management.

import { useCallback, useMemo, useState } from 'react';

import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import type { JiraBoard, JiraFilter, JiraIssue } from '../../../types/jira.ts';

// ── Source and display type unions ──

export type IssueSource = 'mine' | 'jql' | 'filter' | 'board';
export type ViewMode = 'cards' | 'compact' | 'table';
export type SortField = 'updated' | 'priority' | 'due' | 'created' | 'project';
export type Persona = 'dev' | 'qa' | 'sm' | 'po';

/**
 * Represents a Jira workflow transition that can move an issue to a new status.
 * The `to` field describes the target status after the transition is executed.
 */
export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string; statusCategory: { name: string } };
}

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
const TRANSITIONS_PATH_PREFIX = '/rest/api/2/issue';
const TRANSITIONS_PATH_SUFFIX = '/transitions';

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
  /** The issue whose detail panel is currently open, or null if closed. */
  selectedIssue: JiraIssue | null;
  /** Whether the slide-in detail panel overlay is visible. */
  isDetailPanelOpen: boolean;
  /** True while a status transition API call is in flight. */
  isTransitioning: boolean;
  /** Error message from the most recent failed transition, or null. */
  transitionError: string | null;
  /** Workflow transitions available for the selected issue. */
  availableTransitions: JiraTransition[];
  /** True while transitions are being fetched from Jira. */
  isLoadingTransitions: boolean;
  /** Whether the export dropdown menu is visible. */
  isExportMenuOpen: boolean;
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
  /** Opens the detail panel for the given issue. */
  openDetailPanel(issue: JiraIssue): void;
  /** Closes the detail panel and clears the selected issue. */
  closeDetailPanel(): void;
  /** Fetches the available workflow transitions for the given issue. */
  loadTransitions(issueKey: string): Promise<void>;
  /** Executes a workflow transition and updates the issue status in state. */
  transitionIssue(issueKey: string, transitionId: string): Promise<void>;
  /** Opens or closes the export dropdown menu. */
  setExportMenuOpen(isOpen: boolean): void;
  /** Copies the issue list as a CSV string to the clipboard. */
  exportAsCsv(): void;
  /** Copies the issue list as a Markdown table to the clipboard. */
  exportAsMarkdown(): void;
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

interface JiraTransitionsResponse {
  transitions: JiraTransition[];
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
    selectedIssue: null,
    isDetailPanelOpen: false,
    isTransitioning: false,
    transitionError: null,
    availableTransitions: [],
    isLoadingTransitions: false,
    isExportMenuOpen: false,
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

// Maps Jira status category names (from transitions) to the key format used in JiraIssue.
const STATUS_CATEGORY_KEY_MAP: Record<string, string> = {
  done: 'done',
  'to do': 'new',
  new: 'new',
};

/** Derives a status category key string from a human-readable category name. */
function deriveStatusCategoryKey(categoryName: string): string {
  return STATUS_CATEGORY_KEY_MAP[categoryName.toLowerCase()] ?? 'indeterminate';
}

/** Formats the current issue list as a CSV string (key, summary, status, priority, assignee). */
function buildCsvExport(issues: JiraIssue[]): string {
  const CSV_HEADER = 'key,summary,status,priority,assignee';
  const rows = issues.map((issue) => {
    // Escape double-quotes in summary to keep CSV valid
    const escapedSummary = `"${issue.fields.summary.replace(/"/g, '""')}"`;
    const priority = issue.fields.priority?.name ?? '';
    const assignee = issue.fields.assignee?.displayName ?? '';
    return `${issue.key},${escapedSummary},${issue.fields.status.name},${priority},${assignee}`;
  });
  return [CSV_HEADER, ...rows].join('\n');
}

/** Formats the current issue list as a Markdown table. */
function buildMarkdownExport(issues: JiraIssue[]): string {
  const MARKDOWN_HEADER = '| Key | Summary | Status | Priority | Assignee |';
  const MARKDOWN_SEPARATOR = '| --- | --- | --- | --- | --- |';
  const rows = issues.map((issue) => {
    const priority = issue.fields.priority?.name ?? '—';
    const assignee = issue.fields.assignee?.displayName ?? '—';
    return `| ${issue.key} | ${issue.fields.summary} | ${issue.fields.status.name} | ${priority} | ${assignee} |`;
  });
  return [MARKDOWN_HEADER, MARKDOWN_SEPARATOR, ...rows].join('\n');
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

  // ── Detail panel actions ──

  /** Sets the selected issue and opens the detail panel overlay. */
  const openDetailPanel = useCallback((issue: JiraIssue) => {
    setState((previousState) => ({
      ...previousState,
      selectedIssue: issue,
      isDetailPanelOpen: true,
      transitionError: null,
      availableTransitions: [],
    }));
  }, []);

  /** Closes the detail panel and clears the selected issue from state. */
  const closeDetailPanel = useCallback(() => {
    setState((previousState) => ({
      ...previousState,
      selectedIssue: null,
      isDetailPanelOpen: false,
      transitionError: null,
    }));
  }, []);

  /** Fetches the available workflow transitions for the given issue key. */
  const loadTransitions = useCallback(async (issueKey: string) => {
    setState((previousState) => ({ ...previousState, isLoadingTransitions: true }));

    try {
      const response = await jiraGet<JiraTransitionsResponse>(
        `${TRANSITIONS_PATH_PREFIX}/${issueKey}${TRANSITIONS_PATH_SUFFIX}`,
      );

      setState((previousState) => ({
        ...previousState,
        availableTransitions: response.transitions,
        isLoadingTransitions: false,
      }));
    } catch {
      // Silently clear the loading flag — transitions are non-critical
      setState((previousState) => ({ ...previousState, isLoadingTransitions: false }));
    }
  }, []);

  /**
   * Executes a workflow transition via POST, then updates the issue's status
   * in the issues array and the selectedIssue using data from availableTransitions.
   */
  const transitionIssue = useCallback(async (issueKey: string, transitionId: string) => {
    setState((previousState) => ({
      ...previousState,
      isTransitioning: true,
      transitionError: null,
    }));

    try {
      await jiraPost<void>(
        `${TRANSITIONS_PATH_PREFIX}/${issueKey}${TRANSITIONS_PATH_SUFFIX}`,
        { transition: { id: transitionId } },
      );

      setState((previousState) => {
        const matchedTransition = previousState.availableTransitions.find(
          (transition) => transition.id === transitionId,
        );

        if (!matchedTransition || !previousState.selectedIssue) {
          return { ...previousState, isTransitioning: false };
        }

        const newStatus = {
          name: matchedTransition.to.name,
          statusCategory: { key: deriveStatusCategoryKey(matchedTransition.to.statusCategory.name) },
        };

        const updatedIssue: JiraIssue = {
          ...previousState.selectedIssue,
          fields: { ...previousState.selectedIssue.fields, status: newStatus },
        };

        const updatedIssues = previousState.issues.map((issue) =>
          issue.key === issueKey ? updatedIssue : issue,
        );

        return {
          ...previousState,
          isTransitioning: false,
          selectedIssue: updatedIssue,
          issues: updatedIssues,
        };
      });
    } catch (unknownError) {
      setState((previousState) => ({
        ...previousState,
        isTransitioning: false,
        transitionError: extractErrorMessage(unknownError),
      }));
    }
  }, []);

  // ── Export actions ──

  /** Opens or closes the export dropdown menu. */
  const setExportMenuOpen = useCallback((isOpen: boolean) => {
    setState((previousState) => ({ ...previousState, isExportMenuOpen: isOpen }));
  }, []);

  /** Copies the current issue list as CSV to the clipboard, then closes the menu. */
  const exportAsCsv = useCallback(() => {
    void navigator.clipboard.writeText(buildCsvExport(state.issues));
    setState((previousState) => ({ ...previousState, isExportMenuOpen: false }));
  }, [state.issues]);

  /** Copies the current issue list as a Markdown table to the clipboard, then closes the menu. */
  const exportAsMarkdown = useCallback(() => {
    void navigator.clipboard.writeText(buildMarkdownExport(state.issues));
    setState((previousState) => ({ ...previousState, isExportMenuOpen: false }));
  }, [state.issues]);

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
      openDetailPanel,
      closeDetailPanel,
      loadTransitions,
      transitionIssue,
      setExportMenuOpen,
      exportAsCsv,
      exportAsMarkdown,
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
      openDetailPanel,
      closeDetailPanel,
      loadTransitions,
      transitionIssue,
      setExportMenuOpen,
      exportAsCsv,
      exportAsMarkdown,
    ],
  );

  return { state, actions };
}
