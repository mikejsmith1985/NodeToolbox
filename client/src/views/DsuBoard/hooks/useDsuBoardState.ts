// useDsuBoardState.ts — State management hook for the DSU (Daily Standup) Board view.

import { useCallback, useState } from 'react';
import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const DEFAULT_STALE_DAYS = 5;

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

export interface DsuBoardState {
  projectKey: string;
  staleDays: number;
  viewMode: DsuViewMode;
  sections: DsuBoardSection[];
  activeFilters: string[];
  snowUrl: string;
}

export interface DsuBoardActions {
  setProjectKey: (key: string) => void;
  setStaleDays: (days: number) => void;
  setViewMode: (mode: DsuViewMode) => void;
  toggleSectionCollapse: (sectionKey: string) => void;
  toggleFilter: (assigneeName: string) => void;
  setSnowUrl: (url: string) => void;
  loadBoard: () => Promise<void>;
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
    },
    actions: {
      setProjectKey,
      setStaleDays,
      setViewMode,
      toggleSectionCollapse,
      toggleFilter,
      setSnowUrl,
      loadBoard,
    },
  };
}
