// useImpactAnalysisState.test.ts — Hook tests for Impact Analysis Jira loading and persistence.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IMPACT_ANALYSIS_STORAGE_KEY,
  buildChildSearchPath,
  buildImpactIssuePath,
  mapJiraIssueToRootIssue,
  useImpactAnalysisState,
  type JiraRootIssue,
} from './useImpactAnalysisState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);

function buildRootIssue(overrides: Partial<NonNullable<JiraRootIssue['fields']>> = {}, issueKey = 'TBX-1'): JiraRootIssue {
  return {
    key: issueKey,
    fields: {
      summary: 'Root issue summary',
      status: { name: 'In Progress' },
      assignee: { displayName: 'Alex Smith' },
      issuetype: { name: 'Story' },
      priority: { name: 'High' },
      issuelinks: [],
      ...overrides,
    },
  };
}

function buildLinkedIssue(issueKey: string) {
  return {
    key: issueKey,
    fields: {
      summary: `${issueKey} linked summary`,
      status: { name: 'To Do', statusCategory: { key: 'new' } },
    },
  };
}

beforeEach(() => {
  mockJiraGet.mockReset();
  window.localStorage.clear();
});

describe('useImpactAnalysisState helpers', () => {
  it('buildImpactIssuePath creates the requested Jira issue endpoint', () => {
    expect(buildImpactIssuePath('tbx-1')).toBe('/rest/api/2/issue/TBX-1?fields=summary,status,assignee,issuetype,priority,issuelinks');
  });

  it('buildChildSearchPath supports parent and legacy Epic Link JQL', () => {
    expect(decodeURIComponent(buildChildSearchPath('tbx-1', 'parent'))).toContain('jql=parent=TBX-1');
    expect(decodeURIComponent(buildChildSearchPath('tbx-1', 'Epic Link'))).toContain('jql="Epic Link" = TBX-1');
  });

  it('mapJiraIssueToRootIssue detects epics and fills missing fields', () => {
    const rootIssue = mapJiraIssueToRootIssue({ key: 'TBX-1', fields: { issuetype: { name: 'Epic' } } });

    expect(rootIssue).toMatchObject({ isEpic: true, summary: 'Untitled Jira issue', priorityName: 'None' });
  });
});

describe('useImpactAnalysisState', () => {
  it('restores the last searched issue key from localStorage', () => {
    window.localStorage.setItem(IMPACT_ANALYSIS_STORAGE_KEY, 'TBX-77');

    const { result } = renderHook(() => useImpactAnalysisState());

    expect(result.current.issueKey).toBe('TBX-77');
  });

  it('search requires a non-empty issue key', async () => {
    const { result } = renderHook(() => useImpactAnalysisState());

    await act(async () => {
      await result.current.search();
    });

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe('Enter an issue key before searching.');
  });

  it('successful search populates root, inward links, and outward links', async () => {
    mockJiraGet.mockResolvedValue(buildRootIssue({
      issuelinks: [
        { type: { outward: 'blocks', inward: 'is blocked by' }, outwardIssue: buildLinkedIssue('TBX-2'), inwardIssue: buildLinkedIssue('TBX-3') },
      ],
    }));
    const { result } = renderHook(() => useImpactAnalysisState());

    act(() => result.current.setIssueKey('tbx-1'));
    await act(async () => {
      await result.current.search();
    });

    expect(mockJiraGet).toHaveBeenCalledWith(buildImpactIssuePath('TBX-1'));
    expect(result.current.root?.key).toBe('TBX-1');
    expect(result.current.outward[0].related.key).toBe('TBX-2');
    expect(result.current.inward[0].related.key).toBe('TBX-3');
  });

  it('persists the normalized issue key after a successful search', async () => {
    mockJiraGet.mockResolvedValue(buildRootIssue());
    const { result } = renderHook(() => useImpactAnalysisState());

    act(() => result.current.setIssueKey('tbx-1'));
    await act(async () => {
      await result.current.search();
    });

    expect(window.localStorage.getItem(IMPACT_ANALYSIS_STORAGE_KEY)).toBe('TBX-1');
    expect(result.current.issueKey).toBe('TBX-1');
  });

  it('epic detection triggers a parent children query', async () => {
    mockJiraGet
      .mockResolvedValueOnce(buildRootIssue({ issuetype: { name: 'Epic' } }))
      .mockResolvedValueOnce({ issues: [buildLinkedIssue('TBX-20')] });
    const { result } = renderHook(() => useImpactAnalysisState());

    act(() => result.current.setIssueKey('TBX-1'));
    await act(async () => {
      await result.current.search();
    });

    expect(mockJiraGet).toHaveBeenNthCalledWith(2, buildChildSearchPath('TBX-1', 'parent'));
    expect(result.current.children[0].key).toBe('TBX-20');
  });

  it('falls back to legacy Epic Link children query when parent JQL returns 400', async () => {
    mockJiraGet
      .mockResolvedValueOnce(buildRootIssue({ issuetype: { name: 'Epic' } }))
      .mockRejectedValueOnce(new Error('Jira GET failed: 400'))
      .mockResolvedValueOnce({ issues: [buildLinkedIssue('TBX-30')] });
    const { result } = renderHook(() => useImpactAnalysisState());

    act(() => result.current.setIssueKey('TBX-1'));
    await act(async () => {
      await result.current.search();
    });

    expect(mockJiraGet).toHaveBeenNthCalledWith(3, buildChildSearchPath('TBX-1', 'Epic Link'));
    expect(result.current.children[0].key).toBe('TBX-30');
  });

  it('does not fetch children for non-epic issues', async () => {
    mockJiraGet.mockResolvedValue(buildRootIssue({ issuetype: { name: 'Task' } }));
    const { result } = renderHook(() => useImpactAnalysisState());

    act(() => result.current.setIssueKey('TBX-1'));
    await act(async () => {
      await result.current.search();
    });

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    expect(result.current.children).toEqual([]);
  });

  it('surfaces error messages cleanly and clears stale results', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unavailable'));
    const { result } = renderHook(() => useImpactAnalysisState());

    act(() => result.current.setIssueKey('TBX-1'));
    await act(async () => {
      await result.current.search();
    });

    await waitFor(() => expect(result.current.errorMessage).toBe('Jira unavailable'));
    expect(result.current.root).toBeNull();
    expect(result.current.stats.totalRelated).toBe(0);
  });
});
