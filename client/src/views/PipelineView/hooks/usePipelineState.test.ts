// usePipelineState.test.ts — Hook tests for Pipeline View Jira loading, filters, and child expansion.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PIPELINE_FILTERS_STORAGE_KEY,
  usePipelineState,
  type PersistedPipelineFilters,
} from './usePipelineState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);

const SAMPLE_EPICS_RESPONSE = {
  issues: [
    {
      key: 'TBX-1',
      fields: {
        summary: 'Set up pipeline foundation',
        status: { name: 'Open', statusCategory: { key: 'new' } },
        assignee: { displayName: 'Alex Morgan' },
        customfield_10028: 13,
      },
    },
    {
      key: 'TBX-2',
      fields: {
        summary: 'Ship pipeline dashboard',
        status: { name: 'In Dev', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Sam Rivera' },
        customfield_10016: 8,
      },
    },
    {
      key: 'TBX-3',
      fields: {
        summary: 'Close out released pipeline work',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        assignee: null,
        customfield_10028: null,
      },
    },
  ],
};

const SAMPLE_CHILDREN_RESPONSE = {
  issues: [
    {
      key: 'TBX-11',
      fields: {
        summary: 'Child one',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        customfield_10028: 5,
      },
    },
    {
      key: 'TBX-12',
      fields: {
        summary: 'Child two',
        status: { name: 'In QA', statusCategory: { key: 'indeterminate' } },
        customfield_10016: 3,
      },
    },
  ],
};

beforeEach(() => {
  mockJiraGet.mockReset();
  window.localStorage.clear();
});

describe('usePipelineState', () => {
  it('starts with persisted filters when localStorage has a saved Pipeline state', () => {
    const savedFilters: PersistedPipelineFilters = {
      projectKey: 'ABC',
      statusCategoryFilter: ['new', 'done'],
      assigneeFilter: 'alex',
    };
    window.localStorage.setItem(PIPELINE_FILTERS_STORAGE_KEY, JSON.stringify(savedFilters));

    const renderedHook = renderHook(() => usePipelineState());

    expect(renderedHook.result.current.projectKey).toBe('ABC');
    expect(renderedHook.result.current.statusCategoryFilter).toEqual(['new', 'done']);
    expect(renderedHook.result.current.assigneeFilter).toBe('alex');
  });

  it('persists filter edits back to localStorage for browser refresh round-trips', async () => {
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    act(() => renderedHook.result.current.setAssigneeFilter('sam'));
    act(() => renderedHook.result.current.toggleStatusCategory('done'));

    await waitFor(() => {
      const storedFilters = JSON.parse(
        window.localStorage.getItem(PIPELINE_FILTERS_STORAGE_KEY) ?? '{}',
      ) as PersistedPipelineFilters;
      expect(storedFilters.projectKey).toBe('TBX');
      expect(storedFilters.assigneeFilter).toBe('sam');
      expect(storedFilters.statusCategoryFilter).toEqual(['new', 'indeterminate']);
    });
  });

  it('requires a project key before loading epics from Jira', async () => {
    const renderedHook = renderHook(() => usePipelineState());

    await act(async () => {
      await renderedHook.result.current.reload();
    });

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(renderedHook.result.current.errorMessage).toContain('project key');
  });

  it('loads epics from Jira and maps card fields plus story-point fallback', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_EPICS_RESPONSE);
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('tbx'));
    await act(async () => {
      await renderedHook.result.current.reload();
    });

    expect(decodeURIComponent(mockJiraGet.mock.calls[0][0])).toContain('project=TBX AND issuetype=Epic');
    expect(renderedHook.result.current.epics).toHaveLength(3);
    expect(renderedHook.result.current.epics[0]).toMatchObject({
      key: 'TBX-1',
      summary: 'Set up pipeline foundation',
      status: 'Open',
      statusCategoryKey: 'new',
      assignee: 'Alex Morgan',
      storyPoints: 13,
      rolledUpStoryPoints: 13,
      completionPercent: 0,
    });
    expect(renderedHook.result.current.epics[1].storyPoints).toBe(8);
  });

  it('filters loaded epics by status category multi-select', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_EPICS_RESPONSE);
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    await act(async () => {
      await renderedHook.result.current.reload();
    });
    act(() => renderedHook.result.current.toggleStatusCategory('new'));
    act(() => renderedHook.result.current.toggleStatusCategory('done'));

    expect(renderedHook.result.current.epics.map((epicSummary) => epicSummary.key)).toEqual(['TBX-2']);
  });

  it('filters loaded epics by assignee using case-insensitive contains matching', async () => {
    mockJiraGet.mockResolvedValue(SAMPLE_EPICS_RESPONSE);
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    await act(async () => {
      await renderedHook.result.current.reload();
    });
    act(() => renderedHook.result.current.setAssigneeFilter('river'));

    expect(renderedHook.result.current.epics.map((epicSummary) => epicSummary.key)).toEqual(['TBX-2']);
  });

  it('loadChildren uses parent JQL first and rolls up returned child story points', async () => {
    mockJiraGet.mockResolvedValueOnce(SAMPLE_EPICS_RESPONSE).mockResolvedValueOnce(SAMPLE_CHILDREN_RESPONSE);
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    await act(async () => {
      await renderedHook.result.current.reload();
    });
    await act(async () => {
      await renderedHook.result.current.loadChildren('TBX-1');
    });

    expect(decodeURIComponent(mockJiraGet.mock.calls[1][0])).toContain('jql=parent=TBX-1');
    const expandedEpic = renderedHook.result.current.epics.find((epicSummary) => epicSummary.key === 'TBX-1');
    expect(expandedEpic?.children).toHaveLength(2);
    expect(expandedEpic?.rolledUpStoryPoints).toBe(8);
    expect(expandedEpic?.completionPercent).toBe(50);
  });

  it('loadChildren falls back to quoted Epic Link JQL when parent returns no children', async () => {
    mockJiraGet
      .mockResolvedValueOnce(SAMPLE_EPICS_RESPONSE)
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce(SAMPLE_CHILDREN_RESPONSE);
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    await act(async () => {
      await renderedHook.result.current.reload();
    });
    await act(async () => {
      await renderedHook.result.current.loadChildren('TBX-1');
    });

    expect(decodeURIComponent(mockJiraGet.mock.calls[2][0])).toContain('jql="Epic Link"=TBX-1');
    expect(renderedHook.result.current.epics[0].children?.map((childIssue) => childIssue.key)).toEqual([
      'TBX-11',
      'TBX-12',
    ]);
  });

  it('captures Jira load failures as user-visible error messages', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unavailable'));
    const renderedHook = renderHook(() => usePipelineState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    await act(async () => {
      await renderedHook.result.current.reload();
    });

    expect(renderedHook.result.current.errorMessage).toBe('Jira unavailable');
    expect(renderedHook.result.current.epics).toEqual([]);
  });
});
