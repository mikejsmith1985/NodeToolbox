// useMyIssuesState.test.ts — Unit tests for the My Issues view state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockJiraPost } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
}));

import { useMyIssuesState } from './useMyIssuesState.ts';

function createMockJiraIssue(issueKey: string, summary: string) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: null,
    },
  };
}

function createMockTransition(transitionId: string, transitionName: string, categoryName: string) {
  return {
    id: transitionId,
    name: transitionName,
    to: { name: transitionName, statusCategory: { name: categoryName } },
  };
}

const MOCK_ISSUES = [
  createMockJiraIssue('TBX-1', 'Build the rocket'),
  createMockJiraIssue('TBX-2', 'Fuel the rocket'),
];

describe('useMyIssuesState', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('initialises with source=mine, viewMode=cards, persona=dev', () => {
    const { result } = renderHook(() => useMyIssuesState());

    expect(result.current.state.source).toBe('mine');
    expect(result.current.state.viewMode).toBe('cards');
    expect(result.current.state.persona).toBe('dev');
  });

  it('sets source when setSource is called', () => {
    const { result } = renderHook(() => useMyIssuesState());

    act(() => {
      result.current.actions.setSource('jql');
    });

    expect(result.current.state.source).toBe('jql');
  });

  it('sets viewMode when setViewMode is called', () => {
    const { result } = renderHook(() => useMyIssuesState());

    act(() => {
      result.current.actions.setViewMode('table');
    });

    expect(result.current.state.viewMode).toBe('table');
  });

  it('sets persona when setPersona is called', () => {
    const { result } = renderHook(() => useMyIssuesState());

    act(() => {
      result.current.actions.setPersona('qa');
    });

    expect(result.current.state.persona).toBe('qa');
  });

  it('sets activeStatusZone when setActiveStatusZone is called', () => {
    const { result } = renderHook(() => useMyIssuesState());

    act(() => {
      result.current.actions.setActiveStatusZone('inprogress');
    });

    expect(result.current.state.activeStatusZone).toBe('inprogress');
  });

  it('appends to jqlHistory after runJqlQuery succeeds', async () => {
    mockJiraGet.mockResolvedValue({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    act(() => {
      result.current.actions.setJqlQuery('project = TBX');
    });

    await act(async () => {
      await result.current.actions.runJqlQuery();
    });

    expect(result.current.state.jqlHistory).toContain('project = TBX');
  });

  it('deduplicates jqlHistory and caps it at MAX_JQL_HISTORY entries', async () => {
    mockJiraGet.mockResolvedValue({ issues: [], total: 0 });
    const { result } = renderHook(() => useMyIssuesState());

    // Run 12 distinct queries so history overflows beyond the max of 10
    for (let i = 0; i < 12; i++) {
      act(() => {
        result.current.actions.setJqlQuery(`project = TBX AND id = ${i}`);
      });
      await act(async () => {
        await result.current.actions.runJqlQuery();
      });
    }

    expect(result.current.state.jqlHistory.length).toBeLessThanOrEqual(10);
  });

  it('stores fetched issues after fetchMyIssues resolves', async () => {
    mockJiraGet.mockResolvedValue({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => {
      await result.current.actions.fetchMyIssues();
    });

    await waitFor(() => {
      expect(result.current.state.issues).toHaveLength(2);
      expect(result.current.state.isFetching).toBe(false);
    });
  });

  it('stores a fetchError when fetchMyIssues rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira is down'));
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => {
      await result.current.actions.fetchMyIssues();
    });

    await waitFor(() => {
      expect(result.current.state.fetchError).toBe('Jira is down');
      expect(result.current.state.isFetching).toBe(false);
    });
  });
});

// ── Detail panel tests ──

describe('useMyIssuesState — detail panel', () => {
  afterEach(() => vi.clearAllMocks());

  it('openDetailPanel sets selectedIssue and isDetailPanelOpen to true', () => {
    const { result } = renderHook(() => useMyIssuesState());
    const issue = createMockJiraIssue('TBX-1', 'Build the rocket');

    act(() => { result.current.actions.openDetailPanel(issue); });

    expect(result.current.state.selectedIssue).toEqual(issue);
    expect(result.current.state.isDetailPanelOpen).toBe(true);
  });

  it('closeDetailPanel clears selectedIssue and sets isDetailPanelOpen to false', () => {
    const { result } = renderHook(() => useMyIssuesState());
    const issue = createMockJiraIssue('TBX-1', 'Build the rocket');

    act(() => { result.current.actions.openDetailPanel(issue); });
    act(() => { result.current.actions.closeDetailPanel(); });

    expect(result.current.state.selectedIssue).toBeNull();
    expect(result.current.state.isDetailPanelOpen).toBe(false);
  });

  it('openDetailPanel clears prior transitionError and availableTransitions', () => {
    const { result } = renderHook(() => useMyIssuesState());
    const issue = createMockJiraIssue('TBX-1', 'Build the rocket');

    act(() => { result.current.actions.openDetailPanel(issue); });

    expect(result.current.state.transitionError).toBeNull();
    expect(result.current.state.availableTransitions).toHaveLength(0);
  });
});

// ── Transitions tests ──

describe('useMyIssuesState — loadTransitions', () => {
  afterEach(() => vi.clearAllMocks());

  it('fetches and stores available transitions', async () => {
    const mockTransitions = [createMockTransition('21', 'In Progress', 'In Progress')];
    mockJiraGet.mockResolvedValue({ transitions: mockTransitions });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.loadTransitions('TBX-1'); });

    expect(result.current.state.availableTransitions).toEqual(mockTransitions);
    expect(result.current.state.isLoadingTransitions).toBe(false);
  });

  it('calls GET on the correct transitions path', async () => {
    mockJiraGet.mockResolvedValue({ transitions: [] });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.loadTransitions('TBX-42'); });

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-42/transitions');
  });

  it('sets isLoadingTransitions to false even when fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.loadTransitions('TBX-1'); });

    expect(result.current.state.isLoadingTransitions).toBe(false);
  });
});

// ── transitionIssue tests ──

describe('useMyIssuesState — transitionIssue', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls jiraPost on the correct path and updates issue status in state', async () => {
    mockJiraGet.mockResolvedValueOnce({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.fetchMyIssues(); });

    const transitions = [createMockTransition('31', 'Done', 'Done')];
    mockJiraGet.mockResolvedValueOnce({ transitions });
    act(() => { result.current.actions.openDetailPanel(result.current.state.issues[0]); });
    await act(async () => { await result.current.actions.loadTransitions('TBX-1'); });

    mockJiraPost.mockResolvedValue({});
    await act(async () => { await result.current.actions.transitionIssue('TBX-1', '31'); });

    expect(mockJiraPost).toHaveBeenCalledWith(
      '/rest/api/2/issue/TBX-1/transitions',
      { transition: { id: '31' } },
    );
    expect(result.current.state.isTransitioning).toBe(false);
    expect(result.current.state.issues[0].fields.status.name).toBe('Done');
  });

  it('sets transitionError and clears isTransitioning on API failure', async () => {
    mockJiraGet.mockResolvedValueOnce({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.fetchMyIssues(); });
    act(() => { result.current.actions.openDetailPanel(result.current.state.issues[0]); });

    mockJiraPost.mockRejectedValue(new Error('Transition failed'));
    await act(async () => { await result.current.actions.transitionIssue('TBX-1', '31'); });

    expect(result.current.state.transitionError).toBe('Transition failed');
    expect(result.current.state.isTransitioning).toBe(false);
  });
});

// ── Export tests ──

describe('useMyIssuesState — export', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('setExportMenuOpen sets isExportMenuOpen to the given value', () => {
    const { result } = renderHook(() => useMyIssuesState());

    act(() => { result.current.actions.setExportMenuOpen(true); });

    expect(result.current.state.isExportMenuOpen).toBe(true);
  });

  it('exportAsCsv copies CSV to clipboard and closes the export menu', async () => {
    mockJiraGet.mockResolvedValue({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.fetchMyIssues(); });
    act(() => { result.current.actions.exportAsCsv(); });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('key,summary,status,priority,assignee'),
    );
    expect(result.current.state.isExportMenuOpen).toBe(false);
  });

  it('exportAsCsv includes issue key and summary in CSV output', async () => {
    mockJiraGet.mockResolvedValue({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.fetchMyIssues(); });
    act(() => { result.current.actions.exportAsCsv(); });

    const writtenContent = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(writtenContent).toContain('TBX-1');
    expect(writtenContent).toContain('Build the rocket');
  });

  it('exportAsMarkdown copies Markdown table to clipboard', async () => {
    mockJiraGet.mockResolvedValue({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.fetchMyIssues(); });
    act(() => { result.current.actions.exportAsMarkdown(); });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('| Key | Summary | Status | Priority | Assignee |'),
    );
  });

  it('exportAsMarkdown includes issue data rows', async () => {
    mockJiraGet.mockResolvedValue({ issues: MOCK_ISSUES, total: 2 });
    const { result } = renderHook(() => useMyIssuesState());

    await act(async () => { await result.current.actions.fetchMyIssues(); });
    act(() => { result.current.actions.exportAsMarkdown(); });

    const writtenContent = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(writtenContent).toContain('| TBX-1 |');
    expect(writtenContent).toContain('Build the rocket');
  });
});
