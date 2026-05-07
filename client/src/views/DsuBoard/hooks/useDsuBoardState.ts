// useDsuBoardState.ts — State management hook for the DSU (Daily Standup) Board view.

import { useCallback, useRef, useState } from 'react';
import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const DEFAULT_STALE_DAYS = 5;

/** Number of milliseconds to wait before flushing standup notes to localStorage. */
const DEBOUNCE_DELAY_MS = 500;

/** localStorage key used to persist standup notes between sessions. */
const STANDUP_NOTES_STORAGE_KEY = 'toolbox-standup-notes';

/** localStorage key used to persist per-issue SNow root cause URLs. */
const SNOW_ROOT_CAUSES_STORAGE_KEY = 'toolbox-snow-root-causes';

/** Text content for the three standup note areas plus an optional SNow URL. */
export interface StandupNotes {
  /** What was completed since the last standup. */
  yesterday: string;
  /** What will be worked on today. */
  today: string;
  /** Any blockers preventing forward progress. */
  blockers: string;
  /** Optional SNow root cause ticket URL for the whole standup. */
  snowUrl: string;
}

/**
 * A Jira workflow transition that can move an issue to a new status.
 * Returned by `GET /jira-proxy/rest/api/2/issue/{key}/transitions`.
 */
export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

/** Default empty standup notes used when nothing is persisted in localStorage. */
const DEFAULT_STANDUP_NOTES: StandupNotes = {
  yesterday: '',
  today: '',
  blockers: '',
  snowUrl: '',
};

/** Defines the fixed set of DSU board sections and their metadata. */
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
  snowUrl: string;
  /** The issue currently open in the detail overlay, or null when closed. */
  selectedIssue: JiraIssue | null;
  /** Whether the issue detail overlay is visible. */
  isDetailOverlayOpen: boolean;
  /** Workflow transitions available for the selected issue. */
  availableTransitions: JiraTransition[];
  /** True while transitions are being fetched from Jira. */
  isLoadingTransitions: boolean;
  /** True while a status transition is being applied. */
  isTransitioning: boolean;
  /** Error message from the last failed transition or load, or null. */
  transitionError: string | null;
  /** The three daily standup text areas, persisted to localStorage. */
  standupNotes: StandupNotes;
  /** Whether the standup notes panel is collapsed. */
  isStandupPanelCollapsed: boolean;
  /** Per-issue SNow root cause URLs, keyed by Jira issue key. */
  snowRootCauseUrls: Record<string, string>;
}

/** All callable actions available to the DSU Board view and sub-components. */
export interface DsuBoardActions {
  setProjectKey: (key: string) => void;
  setStaleDays: (days: number) => void;
  setViewMode: (mode: DsuViewMode) => void;
  toggleSectionCollapse: (sectionKey: string) => void;
  toggleFilter: (assigneeName: string) => void;
  setSnowUrl: (url: string) => void;
  loadBoard: () => Promise<void>;
  /** Opens the detail overlay for the given issue. */
  openDetailOverlay: (issue: JiraIssue) => void;
  /** Closes the detail overlay and clears selected issue state. */
  closeDetailOverlay: () => void;
  /** Fetches available workflow transitions for a Jira issue. */
  loadTransitions: (issueKey: string) => Promise<void>;
  /** Posts a workflow transition to move an issue to a new status. */
  transitionIssue: (issueKey: string, transitionId: string) => Promise<void>;
  /** Posts a comment to a Jira issue. */
  postComment: (issueKey: string, commentBody: string) => Promise<void>;
  /** Updates one or more standup note fields; debounces the localStorage write. */
  updateStandupNotes: (notes: Partial<StandupNotes>) => void;
  /** Sets whether the standup notes panel is collapsed. */
  setStandupPanelCollapsed: (isCollapsed: boolean) => void;
  /** Copies formatted standup notes to the clipboard. */
  copyStandupToClipboard: () => void;
  /** Saves a SNow root cause URL for a specific issue key. */
  setSnowRootCauseUrl: (issueKey: string, url: string) => void;
}

/** Builds the JQL query for each DSU section based on project key and configuration. */
function buildSectionJql(sectionKey: SectionKey, projectKey: string, staleDays: number): string | null {
  const projectFilter = `project = "${projectKey}"`;
  const openStatuses = `status in ("To Do", "In Progress", "Open")`;

  switch (sectionKey) {
    case 'new': {
      // Issues created since the last business day at 5 PM
      return `${projectFilter} AND created >= "-1d" ORDER BY created DESC`;
    }
    case 'stale': {
      // Issues open but not updated for N days
      return `${projectFilter} AND ${openStatuses} AND updated <= "-${staleDays}d" ORDER BY updated ASC`;
    }
    case 'release': {
      // Issues with a fixVersion matching the most recent active release
      return `${projectFilter} AND fixVersion in unreleasedVersions() ORDER BY priority DESC`;
    }
    case 'incidents': {
      // Issues that look like incidents/PRBs based on summary keywords
      return `${projectFilter} AND ${openStatuses} AND summary ~ "INC OR PRB" ORDER BY created DESC`;
    }
    case 'open': {
      return `${projectFilter} AND ${openStatuses} ORDER BY updated DESC`;
    }
    case 'watching': {
      return `${projectFilter} AND ${openStatuses} AND watcher = currentUser() ORDER BY updated DESC`;
    }
    case 'roster-jira': {
      return `${projectFilter} AND ${openStatuses} ORDER BY assignee ASC`;
    }
    case 'roster-snow': {
      // SNow tickets are loaded via a separate mechanism — skip Jira fetch
      return null;
    }
    default: {
      return null;
    }
  }
}

/** Hook providing all state and actions for the DSU Board view. */
export function useDsuBoardState(): { state: DsuBoardState; actions: DsuBoardActions } {
  const [projectKey, setProjectKeyState] = useState('');
  const [staleDays, setStaleDaysState] = useState(DEFAULT_STALE_DAYS);
  const [viewMode, setViewModeState] = useState<DsuViewMode>('cards');
  const [sections, setSections] = useState<DsuBoardSection[]>(
    DSU_SECTION_DEFINITIONS.map((definition) => ({
      ...definition,
      issues: [],
      isLoading: false,
      loadError: null,
      isCollapsed: false,
    })),
  );
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [snowUrl, setSnowUrlState] = useState('');

  // ── Detail overlay state ──
  const [selectedIssue, setSelectedIssueState] = useState<JiraIssue | null>(null);
  const [isDetailOverlayOpen, setIsDetailOverlayOpen] = useState(false);
  const [availableTransitions, setAvailableTransitions] = useState<JiraTransition[]>([]);
  const [isLoadingTransitions, setIsLoadingTransitions] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // ── Standup notes state (loaded from localStorage on first render) ──
  const [standupNotes, setStandupNotes] = useState<StandupNotes>(() => {
    const savedJson = localStorage.getItem(STANDUP_NOTES_STORAGE_KEY);
    return savedJson
      ? { ...DEFAULT_STANDUP_NOTES, ...(JSON.parse(savedJson) as Partial<StandupNotes>) }
      : DEFAULT_STANDUP_NOTES;
  });
  const [isStandupPanelCollapsed, setIsStandupPanelCollapsedState] = useState(false);
  const [snowRootCauseUrls, setSnowRootCauseUrlsState] = useState<Record<string, string>>(() => {
    const savedJson = localStorage.getItem(SNOW_ROOT_CAUSES_STORAGE_KEY);
    return savedJson ? (JSON.parse(savedJson) as Record<string, string>) : {};
  });

  /** Timer ref for debouncing standup notes localStorage writes. */
  const standupNotesDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setProjectKey = useCallback((key: string) => {
    setProjectKeyState(key);
  }, []);

  const setStaleDays = useCallback((days: number) => {
    setStaleDaysState(days);
  }, []);

  const setViewMode = useCallback((mode: DsuViewMode) => {
    setViewModeState(mode);
  }, []);

  const toggleSectionCollapse = useCallback((sectionKey: string) => {
    setSections((previous) =>
      previous.map((section) =>
        section.key === sectionKey
          ? { ...section, isCollapsed: !section.isCollapsed }
          : section,
      ),
    );
  }, []);

  const toggleFilter = useCallback((assigneeName: string) => {
    setActiveFilters((previous) => {
      const isAlreadyActive = previous.includes(assigneeName);
      if (isAlreadyActive) {
        return previous.filter((filter) => filter !== assigneeName);
      }
      return [...previous, assigneeName];
    });
  }, []);

  const setSnowUrl = useCallback((url: string) => {
    setSnowUrlState(url);
  }, []);

  // ── Detail overlay actions ──

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

  // ── Standup notes actions ──

  /** Updates standup note fields and debounces the localStorage write. */
  const updateStandupNotes = useCallback((partialNotes: Partial<StandupNotes>) => {
    setStandupNotes((previousNotes) => {
      const updatedNotes = { ...previousNotes, ...partialNotes };

      // Debounce: cancel any pending write and schedule a new one
      if (standupNotesDebounceTimer.current !== null) {
        clearTimeout(standupNotesDebounceTimer.current);
      }
      standupNotesDebounceTimer.current = setTimeout(() => {
        localStorage.setItem(STANDUP_NOTES_STORAGE_KEY, JSON.stringify(updatedNotes));
      }, DEBOUNCE_DELAY_MS);

      return updatedNotes;
    });
  }, []);

  const setStandupPanelCollapsed = useCallback((isCollapsed: boolean) => {
    setIsStandupPanelCollapsedState(isCollapsed);
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
    setSnowRootCauseUrlsState((previousUrls) => {
      const updatedUrls = { ...previousUrls, [issueKey]: url };
      localStorage.setItem(SNOW_ROOT_CAUSES_STORAGE_KEY, JSON.stringify(updatedUrls));
      return updatedUrls;
    });
  }, []);

  const loadBoard = useCallback(async () => {
    // Mark all Jira sections as loading (SNow section is skipped)
    setSections((previous) =>
      previous.map((section) =>
        section.key === 'roster-snow'
          ? { ...section, issues: [], loadError: null }
          : { ...section, isLoading: true, loadError: null },
      ),
    );

    // Build and fire parallel fetches for all Jira-backed sections
    const fetchPromises = DSU_SECTION_DEFINITIONS.map(async (definition) => {
      const jql = buildSectionJql(definition.key as SectionKey, projectKey, staleDays);

      // SNow section does not query Jira
      if (jql === null) return;

      try {
        const response = await jiraGet<{ issues: JiraIssue[] }>(
          `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=50`,
        );
        setSections((current) =>
          current.map((section) =>
            section.key === definition.key
              ? { ...section, isLoading: false, issues: response.issues, loadError: null }
              : section,
          ),
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load section';
        setSections((current) =>
          current.map((section) =>
            section.key === definition.key
              ? { ...section, isLoading: false, loadError: errorMessage }
              : section,
          ),
        );
      }
    });

    await Promise.all(fetchPromises);
  }, [projectKey, staleDays]);

  return {
    state: {
      projectKey,
      staleDays,
      viewMode,
      sections,
      activeFilters,
      snowUrl,
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
    },
  };
}
