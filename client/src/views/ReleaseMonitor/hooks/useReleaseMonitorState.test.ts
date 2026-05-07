// useReleaseMonitorState.test.ts — Hook tests for Release Monitor persistence and Jira loading.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RELEASE_MONITOR_STORAGE_KEY,
  useReleaseMonitorState,
} from './useReleaseMonitorState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);

const VERSIONS_RESPONSE = [
  { id: '10000', name: '0.6.0', released: true, archived: false, releaseDate: '2026-01-15' },
  { id: '10001', name: '0.6.1', released: false, archived: false, releaseDate: '2026-02-15' },
  { id: '10002', name: '0.5.0', released: true, archived: true, releaseDate: '2025-12-01' },
];

const ISSUES_RESPONSE = {
  issues: [
    {
      key: 'TBX-101',
      fields: {
        summary: 'Finalize release candidate',
        status: { name: 'In QA', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Alex Morgan' },
        priority: { name: 'Highest' },
        duedate: '2000-01-01',
        labels: [],
      },
    },
    {
      key: 'TBX-102',
      fields: {
        summary: 'Ship completed work',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        assignee: null,
        priority: { name: 'Medium' },
        duedate: '2000-01-01',
        labels: ['blocker'],
      },
    },
    {
      key: 'TBX-103',
      fields: {
        summary: 'Triage unknown workflow state',
        status: { name: 'Custom', statusCategory: { key: 'custom' } },
        priority: null,
        duedate: null,
        labels: [],
      },
    },
  ],
};

beforeEach(() => {
  mockJiraGet.mockReset();
  window.localStorage.clear();
});

describe('useReleaseMonitorState', () => {
  it('restores project key and fixVersion from localStorage', () => {
    window.localStorage.setItem(RELEASE_MONITOR_STORAGE_KEY, JSON.stringify({ projectKey: 'TBX', fixVersion: '0.6.1' }));

    const renderedHook = renderHook(() => useReleaseMonitorState());

    expect(renderedHook.result.current.projectKey).toBe('TBX');
    expect(renderedHook.result.current.fixVersion).toBe('0.6.1');
  });

  it('persists project key and fixVersion edits to localStorage', async () => {
    const renderedHook = renderHook(() => useReleaseMonitorState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    act(() => renderedHook.result.current.setFixVersion('0.6.1'));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(RELEASE_MONITOR_STORAGE_KEY) ?? '{}')).toEqual({
        projectKey: 'TBX',
        fixVersion: '0.6.1',
      });
    });
  });

  it('loadVersions populates non-archived versions for the project', async () => {
    mockJiraGet.mockResolvedValue(VERSIONS_RESPONSE);
    const renderedHook = renderHook(() => useReleaseMonitorState());

    act(() => renderedHook.result.current.setProjectKey('tbx'));
    await act(async () => {
      await renderedHook.result.current.loadVersions();
    });

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/project/TBX/versions');
    expect(renderedHook.result.current.versions.map((jiraVersion) => jiraVersion.name)).toEqual(['0.6.0', '0.6.1']);
  });

  it('loadIssues requires both project key and fixVersion', async () => {
    const renderedHook = renderHook(() => useReleaseMonitorState());

    await act(async () => {
      await renderedHook.result.current.loadIssues();
    });

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(renderedHook.result.current.errorMessage).toContain('project key and fixVersion');
  });

  it('loadIssues maps Jira fields and normalizes unknown status categories', async () => {
    mockJiraGet.mockResolvedValue(ISSUES_RESPONSE);
    const renderedHook = renderHook(() => useReleaseMonitorState());

    act(() => renderedHook.result.current.setProjectKey('tbx'));
    act(() => renderedHook.result.current.setFixVersion('0.6.1'));
    await act(async () => {
      await renderedHook.result.current.loadIssues();
    });

    expect(decodeURIComponent(mockJiraGet.mock.calls[0][0])).toContain('project=TBX AND fixVersion="0.6.1"');
    expect(renderedHook.result.current.issues[0]).toMatchObject({
      key: 'TBX-101',
      summary: 'Finalize release candidate',
      statusName: 'In QA',
      statusCategoryKey: 'indeterminate',
      assigneeName: 'Alex Morgan',
      priorityName: 'Highest',
      isBlocker: true,
      isOverdue: true,
    });
    expect(renderedHook.result.current.issues[1].isOverdue).toBe(false);
    expect(renderedHook.result.current.issues[2].statusCategoryKey).toBe('unknown');
  });

  it('derives selected version and release status after versions load', async () => {
    mockJiraGet.mockResolvedValue(VERSIONS_RESPONSE);
    const renderedHook = renderHook(() => useReleaseMonitorState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    act(() => renderedHook.result.current.setFixVersion('0.6.0'));
    await act(async () => {
      await renderedHook.result.current.loadVersions();
    });

    expect(renderedHook.result.current.selectedVersion?.name).toBe('0.6.0');
    expect(renderedHook.result.current.releaseStatus).toBe('released');
  });

  it('surfaces clear Jira 4xx errors from versions and issue loads', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira GET /rest/api/2/search failed: 404'));
    const renderedHook = renderHook(() => useReleaseMonitorState());

    act(() => renderedHook.result.current.setProjectKey('TBX'));
    act(() => renderedHook.result.current.setFixVersion('missing'));
    await act(async () => {
      await renderedHook.result.current.loadIssues();
    });

    expect(renderedHook.result.current.errorMessage).toBe('Jira GET /rest/api/2/search failed: 404');
    expect(renderedHook.result.current.issues).toEqual([]);
  });
});
