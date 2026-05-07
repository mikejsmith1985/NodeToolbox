// useHygieneState.test.ts — Hook tests for Hygiene Jira loading and persisted filters.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HYGIENE_FILTER_STORAGE_KEY,
  HYGIENE_PROJECT_KEY_STORAGE_KEY,
  buildHygieneSearchPath,
  mapJiraIssueToHygieneFinding,
  useHygieneState,
} from './useHygieneState.ts';
import type { JiraIssue } from '../checks/hygieneChecks.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);
const ACTIVE_STATUS = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
const TODO_STATUS = { name: 'To Do', statusCategory: { key: 'new' } };
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function buildDateDaysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * MILLISECONDS_PER_DAY).toISOString();
}

function buildJiraIssue(overrides: Partial<JiraIssue['fields']> = {}, issueKey = 'TBX-101'): JiraIssue {
  return {
    key: issueKey,
    fields: {
      summary: 'Needs story points',
      status: TODO_STATUS,
      assignee: { displayName: 'Alex' },
      issuetype: { name: 'Story' },
      created: buildDateDaysAgo(4),
      updated: buildDateDaysAgo(1),
      description: 'Given a team opens Hygiene, when data loads, then they can see flags.',
      customfield_10028: 3,
      customfield_10016: null,
      customfield_10020: [],
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockJiraGet.mockReset();
  window.localStorage.clear();
});

describe('useHygieneState helpers', () => {
  it('buildHygieneSearchPath creates the requested single-search Jira path', () => {
    const searchPath = buildHygieneSearchPath('tbx', 'AND labels = hygiene');
    const decodedSearchPath = decodeURIComponent(searchPath);

    expect(decodedSearchPath).toContain('jql=project=TBX AND statusCategory != Done AND labels = hygiene');
    expect(decodedSearchPath).toContain('fields=summary,status,assignee,issuetype,priority,created,updated,description');
    expect(decodedSearchPath).toContain('maxResults=200');
  });

  it('mapJiraIssueToHygieneFinding returns null for healthy issues and flags unhealthy issues', () => {
    const healthyFinding = mapJiraIssueToHygieneFinding(buildJiraIssue());
    const unhealthyFinding = mapJiraIssueToHygieneFinding(
      buildJiraIssue({ customfield_10028: null, customfield_10016: null }),
    );

    expect(healthyFinding).toBeNull();
    expect(unhealthyFinding?.flags[0].checkId).toBe('missing-sp');
  });
});

describe('useHygieneState', () => {
  it('starts with persisted project key and filter values', () => {
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, 'TBX');
    window.localStorage.setItem(HYGIENE_FILTER_STORAGE_KEY, 'stale');

    const { result } = renderHook(() => useHygieneState());

    expect(result.current.projectKey).toBe('TBX');
    expect(result.current.selectedFilter).toBe('stale');
  });

  it('persists project key edits and selected filters', () => {
    const { result } = renderHook(() => useHygieneState());

    act(() => result.current.setProjectKey('ABC'));
    act(() => result.current.selectFilter('missing-sp'));

    expect(window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY)).toBe('ABC');
    expect(window.localStorage.getItem(HYGIENE_FILTER_STORAGE_KEY)).toBe('missing-sp');
  });

  it('clicking the selected filter again clears it and removes persisted filter state', () => {
    const { result } = renderHook(() => useHygieneState());

    act(() => result.current.selectFilter('no-assignee'));
    act(() => result.current.selectFilter('no-assignee'));

    expect(result.current.selectedFilter).toBeNull();
    expect(window.localStorage.getItem(HYGIENE_FILTER_STORAGE_KEY)).toBeNull();
  });

  it('does not call Jira when the project key is empty', async () => {
    const { result } = renderHook(() => useHygieneState());

    await act(async () => {
      await result.current.loadHygiene();
    });

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(result.current.findings).toEqual([]);
  });

  it('calls jiraGet with project JQL, extra JQL, and maps only flagged issues', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        buildJiraIssue({ customfield_10028: null, customfield_10016: null }),
        buildJiraIssue({}, 'TBX-102'),
      ],
    });
    const { result } = renderHook(() => useHygieneState());

    act(() => result.current.setProjectKey('tbx'));
    act(() => result.current.setExtraJql('AND labels = hygiene'));
    await act(async () => {
      await result.current.loadHygiene();
    });

    const searchPath = String(mockJiraGet.mock.calls[0][0]);
    expect(decodeURIComponent(searchPath)).toContain('project=TBX AND statusCategory != Done AND labels = hygiene');
    expect(result.current.findings).toHaveLength(1);
    expect(result.current.summary.totalFlags).toBe(1);
  });

  it('filters findings to the selected check type', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        buildJiraIssue({ customfield_10028: null, customfield_10016: null }, 'TBX-101'),
        buildJiraIssue({ status: ACTIVE_STATUS, assignee: null }, 'TBX-102'),
      ],
    });
    const { result } = renderHook(() => useHygieneState());

    act(() => result.current.setProjectKey('TBX'));
    await act(async () => {
      await result.current.loadHygiene();
    });
    act(() => result.current.selectFilter('no-assignee'));

    expect(result.current.filteredFindings).toHaveLength(1);
    expect(result.current.filteredFindings[0].flags.map((flag) => flag.checkId)).toContain('no-assignee');
  });

  it('reports Jira load errors without retaining stale findings', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira down'));
    const { result } = renderHook(() => useHygieneState());

    act(() => result.current.setProjectKey('TBX'));
    await act(async () => {
      await result.current.loadHygiene();
    });

    await waitFor(() => expect(result.current.loadError).toBe('Jira down'));
    expect(result.current.findings).toEqual([]);
  });
});
