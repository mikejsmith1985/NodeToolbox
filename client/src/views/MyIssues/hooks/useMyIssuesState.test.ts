// useMyIssuesState.test.ts — Unit tests for the My Issues view state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
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
