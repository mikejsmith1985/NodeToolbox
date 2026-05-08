// useDsuBoardState.ts — State management hook for the DSU (Daily Standup) Board view.

import { useCallback, useRef, useState } from 'react';
import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  DEFAULT_MULTI_CRITERIA_FILTERS,
  type DsuMultiCriteriaFilters,
} from './useDsuFilters.ts';
import {
  enrichIssuesWithSnowLinks,
  type SnowLinksMap,
} from './useDsuSnowEnrichment.ts';

const DEFAULT_STALE_DAYS = 5;
const DEBOUNCE_DELAY_MS = 500;
const AUTO_FILL_MAX_ISSUES = 5;
const RECENT_UPDATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STANDUP_NOTES_STORAGE_KEY = 'tbxDsuStandupNotes';
const SELECTED_RELEASE_STORAGE_KEY = 'tbxDSUSelectedRelease';
const SNOW_ROOT_CAUSES_STORAGE_KEY = 'toolbox-snow-root-causes';
const JIRA_SEARCH_FIELDS = 'summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment';
const JIRA_SEARCH_MAX_RESULTS = 100;

/** Text content for the three standup note areas plus an optional SNow URL. */
export interface StandupNotes {
  yesterday: string;
  today: string;
  blockers: string;
  snowUrl: string;
}

/** A Jira workflow transition that can move an issue to a new status. */
export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

interface JiraProjectVersion {
  name: string;
  released?: boolean;
}

interface DsuStoredStandupState {
  notes: StandupNotes;
  isStandupPanelCollapsed: boolean;
}

const DEFAULT_STANDUP_NOTES: StandupNotes = {
  yesterday: '',
  today: '',
  blockers: '',
  snowUrl: '',
};

const DSU_SECTION_DEFINITIONS = [
  { key: 'new', icon: '🆕', label: 'New Since Last Business Day', help: 'Created since 5 PM on the last business day' },
  { key: 'stale', icon: '⚠️', label: 'Stale Issues', help: 'Open issues not updated in N or more days' },
  { key: 'release', icon: '🚀', label: 'Current Release', help: 'Issues targeting the current fix version' },
  { key: 'incidents', icon: '🔥', label: 'PRBs & Incidents', help: 'Issues with INC or PRB in the summary' },
  { key: 'open', icon: '📋', label: 'Open Issues', help: 'All issues in To Do or In Progress' },
  { key: 'watching', icon: '👁️', label: 'Watching', help: 'Issues you are currently watching' },
  { key: 'roster-jira', icon: '👥', label: 'Team Active Issues', help: 'Open issues for roster members' },
  { key: 'roster-snow', icon: '🌨️', label: 'Team SNow Tickets', help: 'Active SNow items for roster members' },
] as const;

type SectionKey = typeof DSU_SECTION_DEFINITIONS[number]['key'];

/** Represents a single section on the DSU board with its issues. */
export interface DsuBoardSection {
  key: string;
  icon: string;
  label: string;
  help: string;
  issues: JiraIssue[];
  isLoading: boolean;
  loadError: string | null;
  isCollapsed: boolean;
}

export type DsuViewMode = 'cards' | 'table';

/** Complete client-side state for the DSU Board view. */
export interface DsuBoardState {
  projectKey: string;
  staleDays: number;
  viewMode: DsuViewMode;
  sections: DsuBoardSection[];
  activeFilters: string[];
  multiCriteriaFilters: DsuMultiCriteriaFilters;
  snowUrl: string;
  availableVersions: string[];
  autoReleaseName: string | null;
  selectedReleaseName: string | null;
  sectionSnowLinks: Record<string, SnowLinksMap>;
  selectedIssue: JiraIssue | null;
  isDetailOverlayOpen: boolean;
  availableTransitions: JiraTransition[];
  isLoadingTransitions: boolean;
  isTransitioning: boolean;
  transitionError: string | null;
  standupNotes: StandupNotes;
  isStandupPanelCollapsed: boolean;
  snowRootCauseUrls: Record<string, string>;
}

/** All callable actions available to the DSU Board view and sub-components. */
export interface DsuBoardActions {
  setProjectKey: (key: string) => void;
  setStaleDays: (days: number) => void;
  setViewMode: (mode: DsuViewMode) => void;
  toggleSectionCollapse: (sectionKey: string) => void;
  toggleFilter: (assigneeName: string) => void;
  toggleIssueTypeFilter: (issueTypeName: string) => void;
  togglePriorityFilter: (priorityName: string) => void;
  toggleStatusFilter: (statusName: string) => void;
  setFixVersionFilter: (fixVersion: string) => void;
  setPiFilter: (piValue: string) => void;
  clearAllFilters: () => void;
  setSnowUrl: (url: string) => void;
  loadBoard: () => Promise<void>;
  openDetailOverlay: (issue: JiraIssue) => void;
  closeDetailOverlay: () => void;
  loadTransitions: (issueKey: string) => Promise<void>;
  transitionIssue: (issueKey: string, transitionId: string) => Promise<void>;
  postComment: (issueKey: string, commentBody: string) => Promise<void>;
  updateStandupNotes: (notes: Partial<StandupNotes>) => void;
  setStandupPanelCollapsed: (isCollapsed: boolean) => void;
  copyStandupToClipboard: () => void;
  setSnowRootCauseUrl: (issueKey: string, url: string) => void;
  setSelectedRelease: (versionName: string | null) => void;
  autoFillStandupNotes: () => void;
}

function createDefaultSections(): DsuBoardSection[] {
  return DSU_SECTION_DEFINITIONS.map((definition) => ({
    ...definition,
    issues: [],
    isLoading: false,
    loadError: null,
    isCollapsed: false,
  }));
}

function createDefaultStoredStandupState(): DsuStoredStandupState {
  return { notes: DEFAULT_STANDUP_NOTES, isStandupPanelCollapsed: false };
}

function readStoredStandupState(): DsuStoredStandupState {
  const savedJson = localStorage.getItem(STANDUP_NOTES_STORAGE_KEY);
  if (!savedJson) {
    return createDefaultStoredStandupState();
  }

  try {
    const parsedValue = JSON.parse(savedJson) as Partial<DsuStoredStandupState> & Partial<StandupNotes>;
    if ('notes' in parsedValue) {
      return {
        notes: { ...DEFAULT_STANDUP_NOTES, ...(parsedValue.notes ?? {}) },
        isStandupPanelCollapsed: Boolean(parsedValue.isStandupPanelCollapsed),
      };
    }

    return {
      notes: { ...DEFAULT_STANDUP_NOTES, ...parsedValue },
      isStandupPanelCollapsed: false,
    };
  } catch {
    return createDefaultStoredStandupState();
  }
}

function persistStandupState(storedStandupState: DsuStoredStandupState): void {
  localStorage.setItem(STANDUP_NOTES_STORAGE_KEY, JSON.stringify(storedStandupState));
}

function readSelectedReleaseName(): string | null {
  return localStorage.getItem(SELECTED_RELEASE_STORAGE_KEY);
}

function persistSelectedReleaseName(selectedReleaseName: string | null): void {
  if (selectedReleaseName === null) {
    localStorage.removeItem(SELECTED_RELEASE_STORAGE_KEY);
    return;
  }

  localStorage.setItem(SELECTED_RELEASE_STORAGE_KEY, selectedReleaseName);
}

function toggleStringValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((currentValue) => currentValue !== value)
    : [...values, value];
}

function buildSearchPath(jql: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${JIRA_SEARCH_FIELDS}&maxResults=${JIRA_SEARCH_MAX_RESULTS}`;
}

function extractUnreleasedVersionNames(projectVersions: JiraProjectVersion[]): string[] {
  return projectVersions
    .filter((projectVersion) => projectVersion.released !== true)
    .map((projectVersion) => projectVersion.name);
}

function createUniqueIssueList(sections: DsuBoardSection[]): JiraIssue[] {
  const issuesByKey = new Map<string, JiraIssue>();
  for (const boardSection of sections) {
    for (const issue of boardSection.issues) {
      if (!issuesByKey.has(issue.key)) {
        issuesByKey.set(issue.key, issue);
      }
    }
  }
  return Array.from(issuesByKey.values());
}

function wasUpdatedRecently(updatedTimestamp: string, currentTimestamp: number): boolean {
  return currentTimestamp - new Date(updatedTimestamp).getTime() <= RECENT_UPDATE_WINDOW_MS;
}

function formatStandupIssueList(issues: JiraIssue[]): string {
  return issues
    .slice(0, AUTO_FILL_MAX_ISSUES)
    .map((issue) => `${issue.key} (${issue.fields.summary})`)
    .join(', ');
}

/** Builds the JQL query for each DSU section based on project key and configuration. */
function buildSectionJql(
  sectionKey: SectionKey,
  projectKey: string,
  staleDays: number,
  activeReleaseName: string | null,
): string | null {
  const projectFilter = `project = "${projectKey}"`;
  const openStatuses = 'status in ("To Do", "In Progress", "Open")';

  switch (sectionKey) {
    case 'new':
      return `${projectFilter} AND created >= "-1d" ORDER BY created DESC`;
    case 'stale':
      return `${projectFilter} AND ${openStatuses} AND updated <= "-${staleDays}d" ORDER BY updated ASC`;
    case 'release':
      return activeReleaseName
        ? `${projectFilter} AND fixVersion = "${activeReleaseName}" ORDER BY priority DESC`
        : `${projectFilter} AND fixVersion in unreleasedVersions() ORDER BY priority DESC`;
    case 'incidents':
      return `${projectFilter} AND ${openStatuses} AND summary ~ "INC OR PRB" ORDER BY created DESC`;
    case 'open':
      return `${projectFilter} AND ${openStatuses} ORDER BY updated DESC`;
    case 'watching':
      return `${projectFilter} AND ${openStatuses} AND watcher = currentUser() ORDER BY updated DESC`;
    case 'roster-jira':
      return `${projectFilter} AND ${openStatuses} ORDER BY assignee ASC`;
    case 'roster-snow':
      return null;
    default:
      return null;
  }
}

/** Hook providing all state and actions for the DSU Board view. */
export function useDsuBoardState(): { state: DsuBoardState; actions: DsuBoardActions } {
  const [projectKey, setProjectKeyState] = useState('');
  const [staleDays, setStaleDaysState] = useState(DEFAULT_STALE_DAYS);
  const [viewMode, setViewModeState] = useState<DsuViewMode>('cards');
  const [sections, setSections] = useState<DsuBoardSection[]>(createDefaultSections);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [multiCriteriaFilters, setMultiCriteriaFilters] = useState<DsuMultiCriteriaFilters>({
    ...DEFAULT_MULTI_CRITERIA_FILTERS,
  });
  const [availableVersions, setAvailableVersionsState] = useState<string[]>([]);
  const [autoReleaseName, setAutoReleaseNameState] = useState<string | null>(null);
  const [selectedReleaseName, setSelectedReleaseNameState] = useState<string | null>(readSelectedReleaseName);
  const [sectionSnowLinks, setSectionSnowLinksState] = useState<Record<string, SnowLinksMap>>({});
  const [selectedIssue, setSelectedIssueState] = useState<JiraIssue | null>(null);
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [availableTransitions, setAvailableTransitions] = useState<JiraTransition[]>([]);
  const [isLoadingTransitions, setIsLoadingTransitions] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [storedStandupState, setStoredStandupState] = useState<DsuStoredStandupState>(readStoredStandupState);
  const [snowRootCauseUrls, setSnowRootCauseUrlsState] = useState<Record<string, string>>(() => {
    const savedJson = localStorage.getItem(SNOW_ROOT_CAUSES_STORAGE_KEY);
    return savedJson ? (JSON.parse(savedJson) as Record<string, string>) : {};
  });

  const standupNotesDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const standupNotes = storedStandupState.notes;
  const isStandupPanelCollapsed = storedStandupState.isStandupPanelCollapsed;
  const snowUrl = standupNotes.snowUrl;

  const updateSectionState = useCallback(
    (sectionKey: string, updateSection: (section: DsuBoardSection) => DsuBoardSection) => {
      setSections((currentSections) =>
        currentSections.map((boardSection) =>
          boardSection.key === sectionKey ? updateSection(boardSection) : boardSection,
        ),
      );
    },
    [],
  );

  const scheduleStandupPersistence = useCallback((nextStoredStandupState: DsuStoredStandupState) => {
    if (standupNotesDebounceTimer.current !== null) {
      clearTimeout(standupNotesDebounceTimer.current);
    }

    standupNotesDebounceTimer.current = setTimeout(() => {
      persistStandupState(nextStoredStandupState);
    }, DEBOUNCE_DELAY_MS);
  }, []);

  const setProjectKey = useCallback((key: string) => {
    setProjectKeyState(key);
  }, []);

  const setStaleDays = useCallback((days: number) => {
    setStaleDaysState(days);
  }, []);

  const setViewMode = useCallback((mode: DsuViewMode) => {
    setViewModeState(mode);
  }, []);

  const toggleSectionCollapse = useCallback(
    (sectionKey: string) => {
      updateSectionState(sectionKey, (boardSection) => ({
        ...boardSection,
        isCollapsed: !boardSection.isCollapsed,
      }));
    },
    [updateSectionState],
  );

  const toggleFilter = useCallback((assigneeName: string) => {
    setActiveFilters((currentFilters) => toggleStringValue(currentFilters, assigneeName));
  }, []);

  const toggleIssueTypeFilter = useCallback((issueTypeName: string) => {
    setMultiCriteriaFilters((currentFilters) => ({
      ...currentFilters,
      issueTypes: toggleStringValue(currentFilters.issueTypes, issueTypeName),
    }));
  }, []);

  const togglePriorityFilter = useCallback((priorityName: string) => {
    setMultiCriteriaFilters((currentFilters) => ({
      ...currentFilters,
      priorities: toggleStringValue(currentFilters.priorities, priorityName),
    }));
  }, []);

  const toggleStatusFilter = useCallback((statusName: string) => {
    setMultiCriteriaFilters((currentFilters) => ({
      ...currentFilters,
      statuses: toggleStringValue(currentFilters.statuses, statusName),
    }));
  }, []);

  const setFixVersionFilter = useCallback((fixVersion: string) => {
    setMultiCriteriaFilters((currentFilters) => ({ ...currentFilters, fixVersion }));
  }, []);

  const setPiFilter = useCallback((piValue: string) => {
    setMultiCriteriaFilters((currentFilters) => ({ ...currentFilters, piValue }));
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveFilters([]);
    setMultiCriteriaFilters({ ...DEFAULT_MULTI_CRITERIA_FILTERS });
  }, []);

  const openDetailOverlay = useCallback((issue: JiraIssue) => {
    setSelectedIssueState(issue);
    setIsDetailOverlayOpen(true);
    setAvailableTransitions([]);
    setTransitionError(null);
  }, []);

  const closeDetailOverlay = useCallback(() => {
    setIsDetailOverlayOpen(false);
    setSelectedIssueState(null);
    setAvailableTransitions([]);
    setTransitionError(null);
  }, []);

  /** Fetches available Jira workflow transitions for the given issue key. */
  const loadTransitions = useCallback(async (issueKey: string) => {
    setIsLoadingTransitions(true);
    setTransitionError(null);
    try {
      const response = await jiraGet<{ transitions: JiraTransition[] }>(
        `/rest/api/2/issue/${issueKey}/transitions`,
      );
      setAvailableTransitions(response.transitions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load transitions';
      setTransitionError(errorMessage);
      setAvailableTransitions([]);
    } finally {
      setIsLoadingTransitions(false);
    }
  }, []);

  /** Posts a status transition for the given issue. */
  const transitionIssue = useCallback(async (issueKey: string, transitionId: string) => {
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      await jiraPost<unknown>(`/rest/api/2/issue/${issueKey}/transitions`, {
        transition: { id: transitionId },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to transition issue';
      setTransitionError(errorMessage);
    } finally {
      setIsTransitioning(false);
    }
  }, []);

  /** Posts a comment to the given Jira issue. */
  const postComment = useCallback(async (issueKey: string, commentBody: string) => {
    await jiraPost<unknown>(`/rest/api/2/issue/${issueKey}/comment`, { body: commentBody });
  }, []);

  /** Updates one or more standup note fields and debounces persistence. */
  const updateStandupNotes = useCallback(
    (partialNotes: Partial<StandupNotes>) => {
      setStoredStandupState((currentStoredStandupState) => {
        const nextStoredStandupState = {
          ...currentStoredStandupState,
          notes: { ...currentStoredStandupState.notes, ...partialNotes },
        };
        scheduleStandupPersistence(nextStoredStandupState);
        return nextStoredStandupState;
      });
    },
    [scheduleStandupPersistence],
  );

  const setSnowUrl = useCallback((url: string) => {
    updateStandupNotes({ snowUrl: url });
  }, [updateStandupNotes]);

  const setStandupPanelCollapsed = useCallback((isCollapsed: boolean) => {
    setStoredStandupState((currentStoredStandupState) => {
      const nextStoredStandupState = {
        ...currentStoredStandupState,
        isStandupPanelCollapsed: isCollapsed,
      };
      persistStandupState(nextStoredStandupState);
      return nextStoredStandupState;
    });
  }, []);

  /** Formats the three standup areas and writes them to the system clipboard. */
  const copyStandupToClipboard = useCallback(() => {
    const clipboardText = [
      `📅 Yesterday: ${standupNotes.yesterday}`,
      `▶️ Today: ${standupNotes.today}`,
      `🚫 Blockers: ${standupNotes.blockers}`,
    ].join('\n');

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(clipboardText);
    }
  }, [standupNotes]);

  /** Saves a SNow root cause URL for the given issue key to state and localStorage. */
  const setSnowRootCauseUrl = useCallback((issueKey: string, url: string) => {
    setSnowRootCauseUrlsState((currentUrls) => {
      const nextUrls = { ...currentUrls, [issueKey]: url };
      localStorage.setItem(SNOW_ROOT_CAUSES_STORAGE_KEY, JSON.stringify(nextUrls));
      return nextUrls;
    });
  }, []);

  const fetchSectionIssues = useCallback(
    async (sectionKey: SectionKey, activeReleaseName: string | null): Promise<JiraIssue[]> => {
      const jql = buildSectionJql(sectionKey, projectKey, staleDays, activeReleaseName);
      if (jql === null) {
        return [];
      }

      const response = await jiraGet<{ issues: JiraIssue[] }>(buildSearchPath(jql));
      return response.issues;
    },
    [projectKey, staleDays],
  );

  const fetchReleaseSectionIssues = useCallback(
    async (releaseName: string | null) => {
      updateSectionState('release', (boardSection) => ({
        ...boardSection,
        isLoading: true,
        loadError: null,
        issues: [],
      }));
      setSectionSnowLinksState((currentSnowLinks) => ({ ...currentSnowLinks, release: {} }));

      try {
        const issues = await fetchSectionIssues('release', releaseName);
        updateSectionState('release', (boardSection) => ({
          ...boardSection,
          isLoading: false,
          issues,
          loadError: null,
        }));
        const snowLinks = await enrichIssuesWithSnowLinks(issues, snowUrl);
        setSectionSnowLinksState((currentSnowLinks) => ({ ...currentSnowLinks, release: snowLinks }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load section';
        updateSectionState('release', (boardSection) => ({
          ...boardSection,
          isLoading: false,
          loadError: errorMessage,
          issues: [],
        }));
      }
    },
    [fetchSectionIssues, snowUrl, updateSectionState],
  );

  const setSelectedRelease = useCallback(
    (versionName: string | null) => {
      setSelectedReleaseNameState(versionName);
      persistSelectedReleaseName(versionName);
      void fetchReleaseSectionIssues(versionName ?? autoReleaseName);
    },
    [autoReleaseName, fetchReleaseSectionIssues],
  );

  const autoFillStandupNotes = useCallback(() => {
    const currentTimestamp = Date.now();
    const uniqueIssues = createUniqueIssueList(sections);
    const completedIssues = uniqueIssues.filter(
      (issue) =>
        issue.fields.status.statusCategory.key === 'done' &&
        wasUpdatedRecently(issue.fields.updated, currentTimestamp),
    );
    const activeIssues = uniqueIssues.filter(
      (issue) => issue.fields.status.statusCategory.key === 'indeterminate',
    );

    updateStandupNotes({
      yesterday: formatStandupIssueList(completedIssues),
      today: formatStandupIssueList(activeIssues),
    });
  }, [sections, updateStandupNotes]);

  const loadBoard = useCallback(async () => {
    setSections((currentSections) =>
      currentSections.map((boardSection) =>
        boardSection.key === 'roster-snow'
          ? { ...boardSection, issues: [], loadError: null, isLoading: false }
          : { ...boardSection, isLoading: true, loadError: null, issues: [] },
      ),
    );
    setSectionSnowLinksState({});

    let activeReleaseName = selectedReleaseName;

    try {
      const projectVersions = await jiraGet<JiraProjectVersion[]>(
        `/rest/api/2/project/${projectKey}/versions`,
      );
      const unreleasedVersionNames = extractUnreleasedVersionNames(projectVersions);
      const autoDetectedReleaseName = unreleasedVersionNames[0] ?? null;
      const hasValidSelectedRelease =
        selectedReleaseName !== null && unreleasedVersionNames.includes(selectedReleaseName);
      const validatedSelectedReleaseName = hasValidSelectedRelease ? selectedReleaseName : null;

      activeReleaseName = validatedSelectedReleaseName ?? autoDetectedReleaseName;
      setAvailableVersionsState(unreleasedVersionNames);
      setAutoReleaseNameState(autoDetectedReleaseName);
      setSelectedReleaseNameState(validatedSelectedReleaseName);
      persistSelectedReleaseName(validatedSelectedReleaseName);
    } catch {
      setAvailableVersionsState([]);
      setAutoReleaseNameState(null);
    }

    await Promise.all(
      DSU_SECTION_DEFINITIONS.map(async (definition) => {
        if (definition.key === 'roster-snow') {
          return;
        }

        if (definition.key === 'release') {
          await fetchReleaseSectionIssues(activeReleaseName);
          return;
        }

        try {
          const issues = await fetchSectionIssues(definition.key as SectionKey, activeReleaseName);
          updateSectionState(definition.key, (boardSection) => ({
            ...boardSection,
            isLoading: false,
            issues,
            loadError: null,
          }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load section';
          updateSectionState(definition.key, (boardSection) => ({
            ...boardSection,
            isLoading: false,
            loadError: errorMessage,
          }));
        }
      }),
    );
  }, [
    fetchReleaseSectionIssues,
    fetchSectionIssues,
    projectKey,
    selectedReleaseName,
    updateSectionState,
  ]);

  return {
    state: {
      projectKey,
      staleDays,
      viewMode,
      sections,
      activeFilters,
      multiCriteriaFilters,
      snowUrl,
      availableVersions,
      autoReleaseName,
      selectedReleaseName,
      sectionSnowLinks,
      selectedIssue,
      isDetailOverlayOpen,
      availableTransitions,
      isLoadingTransitions,
      isTransitioning,
      transitionError,
      standupNotes,
      isStandupPanelCollapsed,
      snowRootCauseUrls,
    },
    actions: {
      setProjectKey,
      setStaleDays,
      setViewMode,
      toggleSectionCollapse,
      toggleFilter,
      toggleIssueTypeFilter,
      togglePriorityFilter,
      toggleStatusFilter,
      setFixVersionFilter,
      setPiFilter,
      clearAllFilters,
      setSnowUrl,
      loadBoard,
      openDetailOverlay,
      closeDetailOverlay,
      loadTransitions,
      transitionIssue,
      postComment,
      updateStandupNotes,
      setStandupPanelCollapsed,
      copyStandupToClipboard,
      setSnowRootCauseUrl,
      setSelectedRelease,
      autoFillStandupNotes,
    },
  };
}
