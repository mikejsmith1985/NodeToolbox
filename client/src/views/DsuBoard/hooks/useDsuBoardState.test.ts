// useDsuBoardState.test.ts — Unit tests for the DSU Board state management hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraIssue } from '../../../types/jira.ts';

const { mockJiraGet, mockJiraPost, mockEnrichIssuesWithSnowLinks } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
  mockEnrichIssuesWithSnowLinks: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
}));

vi.mock('./useDsuSnowEnrichment.ts', () => ({
  enrichIssuesWithSnowLinks: mockEnrichIssuesWithSnowLinks,
}));

import { useDsuBoardState } from './useDsuBoardState.ts';

const PROJECT_VERSIONS = [
  { name: 'Release 24.1', released: false },
  { name: 'Release 24.2', released: false },
  { name: 'Release 23.9', released: true },
];

interface CreateIssueOptions {
  key: string;
  summary?: string;
  statusName?: string;
  statusCategoryKey?: string;
  updated?: string;
  assigneeName?: string | null;
}

function createIssue({
  key,
  summary = 'Test issue',
  statusName = 'In Progress',
  statusCategoryKey = 'indeterminate',
  updated = '2025-01-02T00:00:00.000Z',
  assigneeName = 'Alice',
}: CreateIssueOptions): JiraIssue {
  return {
    id: key,
    key,
    fields: {
      summary,
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      priority: { name: 'High', iconUrl: '' },
      assignee: assigneeName
        ? { accountId: assigneeName, displayName: assigneeName, emailAddress: `${assigneeName}@example.com`, avatarUrls: {} }
        : null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated,
      description: null,
      fixVersions: [{ name: 'Release 24.1' }],
      customfield_10016: 3,
    },
  };
}

const DEFAULT_ISSUE = createIssue({ key: 'TBX-1' });

function configureBoardResponses(searchIssues: JiraIssue[] = [DEFAULT_ISSUE]): void {
  mockJiraGet.mockImplementation(async (path: string) => {
    if (path === '/rest/api/2/project/TBX/versions') {
      return PROJECT_VERSIONS;
    }

    if (path.startsWith('/rest/api/2/search?')) {
      return { issues: searchIssues };
    }

    if (path === '/rest/api/2/issue/TBX-1/transitions') {
      return { transitions: [{ id: '11', name: 'In Progress', to: { name: 'In Progress' } }] };
    }

    throw new Error(`Unexpected path: ${path}`);
  });
}

describe('useDsuBoardState', () => {
  beforeEach(() => {
    localStorage.clear();
    mockEnrichIssuesWithSnowLinks.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('initialises with 8 sections and empty projectKey', () => {
    const { result } = renderHook(() => useDsuBoardState());
    expect(result.current.state.sections).toHaveLength(8);
    expect(result.current.state.projectKey).toBe('');
  });

  it('sets projectKey when setProjectKey is called', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    expect(result.current.state.projectKey).toBe('TBX');
  });

  it('sets staleDays when setStaleDays is called', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setStaleDays(7); });
    expect(result.current.state.staleDays).toBe(7);
  });

  it('toggles section collapse state', () => {
    const { result } = renderHook(() => useDsuBoardState());
    const sectionKey = result.current.state.sections[0].key;
    const initialCollapsed = result.current.state.sections[0].isCollapsed;
    act(() => { result.current.actions.toggleSectionCollapse(sectionKey); });
    expect(result.current.state.sections[0].isCollapsed).toBe(!initialCollapsed);
  });

  it('loads issues for each section when loadBoard resolves and stores release metadata', async () => {
    configureBoardResponses();
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });

    await act(async () => { await result.current.actions.loadBoard(); });

    const sectionsWithIssues = result.current.state.sections.filter(
      (section) => section.issues.length > 0,
    );
    expect(sectionsWithIssues.length).toBeGreaterThan(0);
    expect(result.current.state.availableVersions).toEqual(['Release 24.1', 'Release 24.2']);
    expect(result.current.state.autoReleaseName).toBe('Release 24.1');
  });

  it('sets section loadError when a section fetch rejects', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return PROJECT_VERSIONS;
      }

      if (path.startsWith('/rest/api/2/search?')) {
        throw new Error('JQL error');
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadBoard(); });
    const sectionsWithErrors = result.current.state.sections.filter(
      (section) => section.loadError !== null && section.key !== 'roster-snow',
    );
    expect(sectionsWithErrors.length).toBeGreaterThan(0);
  });

  it('toggleFilter adds and removes assignee from activeFilters', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.toggleFilter('Alice'); });
    expect(result.current.state.activeFilters).toContain('Alice');
    act(() => { result.current.actions.toggleFilter('Alice'); });
    expect(result.current.state.activeFilters).not.toContain('Alice');
  });

  it('toggleIssueTypeFilter adds and removes issue types', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.toggleIssueTypeFilter('Bug'); });
    expect(result.current.state.multiCriteriaFilters.issueTypes).toEqual(['Bug']);
    act(() => { result.current.actions.toggleIssueTypeFilter('Bug'); });
    expect(result.current.state.multiCriteriaFilters.issueTypes).toEqual([]);
  });

  it('togglePriorityFilter adds and removes priorities', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.togglePriorityFilter('High'); });
    expect(result.current.state.multiCriteriaFilters.priorities).toEqual(['High']);
    act(() => { result.current.actions.togglePriorityFilter('High'); });
    expect(result.current.state.multiCriteriaFilters.priorities).toEqual([]);
  });

  it('toggleStatusFilter adds and removes statuses', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.toggleStatusFilter('In Progress'); });
    expect(result.current.state.multiCriteriaFilters.statuses).toEqual(['In Progress']);
    act(() => { result.current.actions.toggleStatusFilter('In Progress'); });
    expect(result.current.state.multiCriteriaFilters.statuses).toEqual([]);
  });

  it('setFixVersionFilter stores the selected fix version', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setFixVersionFilter('Release 24.1'); });
    expect(result.current.state.multiCriteriaFilters.fixVersion).toBe('Release 24.1');
  });

  it('setPiFilter stores the selected PI value', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setPiFilter('PI-2'); });
    expect(result.current.state.multiCriteriaFilters.piValue).toBe('PI-2');
  });

  it('clearAllFilters clears assignee filters and multi-criteria filters', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => {
      result.current.actions.toggleFilter('Alice');
      result.current.actions.toggleIssueTypeFilter('Bug');
      result.current.actions.setFixVersionFilter('Release 24.1');
      result.current.actions.setPiFilter('PI-2');
    });

    act(() => { result.current.actions.clearAllFilters(); });

    expect(result.current.state.activeFilters).toEqual([]);
    expect(result.current.state.multiCriteriaFilters).toEqual({
      issueTypes: [],
      priorities: [],
      statuses: [],
      fixVersion: '',
      piValue: '',
    });
  });

  it('initialises with isDetailOverlayOpen as false and selectedIssue as null', () => {
    const { result } = renderHook(() => useDsuBoardState());
    expect(result.current.state.isDetailOverlayOpen).toBe(false);
    expect(result.current.state.selectedIssue).toBeNull();
  });

  it('openDetailOverlay sets selectedIssue and opens the overlay', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.openDetailOverlay(DEFAULT_ISSUE); });
    expect(result.current.state.selectedIssue).toEqual(DEFAULT_ISSUE);
    expect(result.current.state.isDetailOverlayOpen).toBe(true);
  });

  it('closeDetailOverlay clears selectedIssue and closes the overlay', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.openDetailOverlay(DEFAULT_ISSUE); });
    act(() => { result.current.actions.closeDetailOverlay(); });
    expect(result.current.state.selectedIssue).toBeNull();
    expect(result.current.state.isDetailOverlayOpen).toBe(false);
  });

  it('loadTransitions populates availableTransitions on success', async () => {
    configureBoardResponses();
    const { result } = renderHook(() => useDsuBoardState());
    await act(async () => { await result.current.actions.loadTransitions('TBX-1'); });
    expect(result.current.state.availableTransitions).toHaveLength(1);
    expect(result.current.state.availableTransitions[0].name).toBe('In Progress');
    expect(result.current.state.isLoadingTransitions).toBe(false);
  });

  it('loadTransitions sets transitionError on failure', async () => {
    mockJiraGet.mockRejectedValueOnce(new Error('Network failure'));
    const { result } = renderHook(() => useDsuBoardState());
    await act(async () => { await result.current.actions.loadTransitions('TBX-1'); });
    expect(result.current.state.transitionError).toBe('Network failure');
    expect(result.current.state.isLoadingTransitions).toBe(false);
  });

  it('transitionIssue calls jiraPost with the correct transition body', async () => {
    mockJiraPost.mockResolvedValueOnce({});
    const { result } = renderHook(() => useDsuBoardState());
    await act(async () => { await result.current.actions.transitionIssue('TBX-1', '11'); });
    expect(mockJiraPost).toHaveBeenCalledWith(
      '/rest/api/2/issue/TBX-1/transitions',
      { transition: { id: '11' } },
    );
    expect(result.current.state.isTransitioning).toBe(false);
  });

  it('transitionIssue sets transitionError on failure', async () => {
    mockJiraPost.mockRejectedValueOnce(new Error('Transition failed'));
    const { result } = renderHook(() => useDsuBoardState());
    await act(async () => { await result.current.actions.transitionIssue('TBX-1', '11'); });
    expect(result.current.state.transitionError).toBe('Transition failed');
  });

  it('postComment calls jiraPost with the correct comment body', async () => {
    mockJiraPost.mockResolvedValueOnce({});
    const { result } = renderHook(() => useDsuBoardState());
    await act(async () => { await result.current.actions.postComment('TBX-1', 'Looking good!'); });
    expect(mockJiraPost).toHaveBeenCalledWith(
      '/rest/api/2/issue/TBX-1/comment',
      { body: 'Looking good!' },
    );
  });

  it('updateStandupNotes updates the standup notes state', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => {
      result.current.actions.updateStandupNotes({ yesterday: 'Finished the PR', today: 'Starting tests' });
    });
    expect(result.current.state.standupNotes.yesterday).toBe('Finished the PR');
    expect(result.current.state.standupNotes.today).toBe('Starting tests');
  });

  it('updateStandupNotes persists notes to localStorage after the debounce delay', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.updateStandupNotes({ yesterday: 'Merged PR' }); });
    expect(localStorage.getItem('tbxDsuStandupNotes')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(500); });
    const savedState = JSON.parse(localStorage.getItem('tbxDsuStandupNotes') ?? '{}');
    expect(savedState.notes.yesterday).toBe('Merged PR');
    expect(savedState.isStandupPanelCollapsed).toBe(false);
  });

  it('setStandupPanelCollapsed updates isStandupPanelCollapsed and persists it', () => {
    const { result } = renderHook(() => useDsuBoardState());
    expect(result.current.state.isStandupPanelCollapsed).toBe(false);
    act(() => { result.current.actions.setStandupPanelCollapsed(true); });
    expect(result.current.state.isStandupPanelCollapsed).toBe(true);
    const savedState = JSON.parse(localStorage.getItem('tbxDsuStandupNotes') ?? '{}');
    expect(savedState.isStandupPanelCollapsed).toBe(true);
  });

  it('setSelectedRelease stores the selected release and reloads the release section', async () => {
    configureBoardResponses();
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadBoard(); });

    await act(async () => { await result.current.actions.setSelectedRelease('Release 24.2'); });

    expect(result.current.state.selectedReleaseName).toBe('Release 24.2');
    expect(localStorage.getItem('tbxDSUSelectedRelease')).toBe('Release 24.2');
    expect(
      mockJiraGet.mock.calls.some(([path]) =>
        typeof path === 'string' && decodeURIComponent(path).includes('fixVersion = "Release 24.2"'),
      ),
    ).toBe(true);
  });

  it('autoFillStandupNotes derives yesterday and today notes from board issues', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-03T12:00:00.000Z'));
    configureBoardResponses([
      createIssue({ key: 'TBX-1', summary: 'Finished release', statusName: 'Done', statusCategoryKey: 'done', updated: '2025-01-03T06:00:00.000Z' }),
      createIssue({ key: 'TBX-2', summary: 'Continue testing', statusName: 'In Progress', statusCategoryKey: 'indeterminate', updated: '2025-01-03T09:00:00.000Z' }),
      createIssue({ key: 'TBX-3', summary: 'Old completed work', statusName: 'Done', statusCategoryKey: 'done', updated: '2025-01-01T06:00:00.000Z' }),
    ]);

    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadBoard(); });

    act(() => { result.current.actions.autoFillStandupNotes(); });

    expect(result.current.state.standupNotes.yesterday).toBe('TBX-1 (Finished release)');
    expect(result.current.state.standupNotes.today).toBe('TBX-2 (Continue testing)');
  });

  it('setSnowRootCauseUrl saves URL to state and localStorage', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setSnowRootCauseUrl('TBX-1', 'https://snow.example.com/INC123'); });
    expect(result.current.state.snowRootCauseUrls['TBX-1']).toBe('https://snow.example.com/INC123');
    const savedUrls = JSON.parse(localStorage.getItem('toolbox-snow-root-causes') ?? '{}');
    expect(savedUrls['TBX-1']).toBe('https://snow.example.com/INC123');
  });

  it('copyStandupToClipboard calls navigator.clipboard.writeText with formatted notes', () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useDsuBoardState());
    act(() => {
      result.current.actions.updateStandupNotes({
        yesterday: 'Reviewed PR',
        today: 'Writing tests',
        blockers: 'None',
      });
    });
    act(() => { result.current.actions.copyStandupToClipboard(); });
    expect(mockWriteText).toHaveBeenCalledWith(
      '📅 Yesterday: Reviewed PR\n▶️ Today: Writing tests\n🚫 Blockers: None',
    );
  });

  it('calls snow enrichment after the release section loads successfully', async () => {
    const releaseIssue = createIssue({ key: 'TBX-9', summary: 'Investigate INC123 during release' });
    configureBoardResponses([releaseIssue]);
    mockEnrichIssuesWithSnowLinks.mockResolvedValue({
      'TBX-9': [{ label: 'INC123', url: 'https://snow.example.com/incident.do?number=INC123' }],
    });

    const { result } = renderHook(() => useDsuBoardState());
    act(() => {
      result.current.actions.setProjectKey('TBX');
      result.current.actions.updateStandupNotes({ snowUrl: 'https://snow.example.com' });
    });

    await act(async () => { await result.current.actions.loadBoard(); });

    expect(mockEnrichIssuesWithSnowLinks).toHaveBeenCalledWith(
      [releaseIssue],
      'https://snow.example.com',
    );
    expect(result.current.state.sectionSnowLinks.release['TBX-9'][0].label).toBe('INC123');
  });
});
