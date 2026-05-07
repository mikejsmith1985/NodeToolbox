// useDsuBoardState.test.ts — Unit tests for the DSU Board state management hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockJiraPost } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
}));

import { useDsuBoardState } from './useDsuBoardState.ts';

const MOCK_ISSUE = {
  id: 'TBX-1', key: 'TBX-1',
  fields: {
    summary: 'Test issue',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: null, assignee: null, reporter: null,
    issuetype: { name: 'Story', iconUrl: '' },
    created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
    description: null,
  },
};

describe('useDsuBoardState', () => {
  afterEach(() => { vi.clearAllMocks(); });

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

  it('loads issues for each section when loadBoard resolves', async () => {
    mockJiraGet.mockResolvedValue({ issues: [MOCK_ISSUE] });
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadBoard(); });
    const sectionsWithIssues = result.current.state.sections.filter(
      (section) => section.issues.length > 0,
    );
    expect(sectionsWithIssues.length).toBeGreaterThan(0);
  });

  it('sets section loadError when a section fetch rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('JQL error'));
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

  it('initialises with isDetailOverlayOpen as false and selectedIssue as null', () => {
    const { result } = renderHook(() => useDsuBoardState());
    expect(result.current.state.isDetailOverlayOpen).toBe(false);
    expect(result.current.state.selectedIssue).toBeNull();
  });

  it('openDetailOverlay sets selectedIssue and opens the overlay', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.openDetailOverlay(MOCK_ISSUE); });
    expect(result.current.state.selectedIssue).toEqual(MOCK_ISSUE);
    expect(result.current.state.isDetailOverlayOpen).toBe(true);
  });

  it('closeDetailOverlay clears selectedIssue and closes the overlay', () => {
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.openDetailOverlay(MOCK_ISSUE); });
    act(() => { result.current.actions.closeDetailOverlay(); });
    expect(result.current.state.selectedIssue).toBeNull();
    expect(result.current.state.isDetailOverlayOpen).toBe(false);
  });

  it('loadTransitions populates availableTransitions on success', async () => {
    const mockTransition = { id: '11', name: 'In Progress', to: { name: 'In Progress' } };
    mockJiraGet.mockResolvedValueOnce({ transitions: [mockTransition] });
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
    localStorage.clear();
    const { result } = renderHook(() => useDsuBoardState());
    act(() => { result.current.actions.updateStandupNotes({ yesterday: 'Merged PR' }); });
    // Should not be written yet before the debounce fires
    expect(localStorage.getItem('toolbox-standup-notes')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(500); });
    const savedNotes = JSON.parse(localStorage.getItem('toolbox-standup-notes') ?? '{}');
    expect(savedNotes.yesterday).toBe('Merged PR');
    vi.useRealTimers();
  });

  it('setStandupPanelCollapsed updates isStandupPanelCollapsed', () => {
    const { result } = renderHook(() => useDsuBoardState());
    expect(result.current.state.isStandupPanelCollapsed).toBe(false);
    act(() => { result.current.actions.setStandupPanelCollapsed(true); });
    expect(result.current.state.isStandupPanelCollapsed).toBe(true);
  });

  it('setSnowRootCauseUrl saves URL to state and localStorage', () => {
    localStorage.clear();
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
});
