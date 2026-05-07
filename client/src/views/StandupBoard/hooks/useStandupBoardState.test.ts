// useStandupBoardState.test.ts — Hook tests for Standup Board Jira loading, sorting, and settings persistence.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_STANDUP_JQL,
  STANDUP_STORAGE_KEY,
  buildStandupSearchPath,
  mapJiraIssueToStandupIssue,
  useStandupBoardState,
  type JiraStandupIssue,
} from './useStandupBoardState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);
const FIXED_NOW = new Date('2026-01-10T12:00:00.000Z');
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function buildDateDaysAgo(dayCount: number): string {
  return new Date(FIXED_NOW.getTime() - dayCount * MILLISECONDS_PER_DAY).toISOString();
}

function buildJiraIssue(overrides: Partial<NonNullable<JiraStandupIssue['fields']>> = {}, issueKey = 'TBX-101'): JiraStandupIssue {
  return {
    key: issueKey,
    fields: {
      summary: 'Standup issue',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Alex Smith' },
      created: buildDateDaysAgo(3),
      updated: buildDateDaysAgo(1),
      issuelinks: [],
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockJiraGet.mockReset();
  mockJiraGet.mockResolvedValue({ issues: [] });
  window.localStorage.clear();
});

describe('useStandupBoardState helpers', () => {
  it('buildStandupSearchPath creates the required Jira search URL', () => {
    const searchPath = decodeURIComponent(buildStandupSearchPath('project = TBX'));

    expect(searchPath).toContain('jql=project = TBX');
    expect(searchPath).toContain('fields=summary,status,assignee,priority,issuetype,issuelinks,created,updated');
    expect(searchPath).toContain('maxResults=100');
  });

  it('mapJiraIssueToStandupIssue compacts Jira fields for card rendering', () => {
    const standupIssue = mapJiraIssueToStandupIssue(
      buildJiraIssue({ issuelinks: [{ type: { name: 'is blocked by' }, inwardIssue: { key: 'TBX-99' } }] }),
      FIXED_NOW,
    );

    expect(standupIssue).toMatchObject({
      key: 'TBX-101',
      assignee: 'Alex',
      ageDays: 3,
      isBlocked: true,
      statusCategoryKey: 'indeterminate',
    });
  });
});

describe('useStandupBoardState', () => {
  it('loads issues via jiraGet on mount when JQL has a value', async () => {
    mockJiraGet.mockResolvedValue({ issues: [buildJiraIssue()] });

    const { result } = renderHook(() => useStandupBoardState());

    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    expect(mockJiraGet).toHaveBeenCalledWith(buildStandupSearchPath(DEFAULT_STANDUP_JQL));
  });

  it('filters Done issues by default and includes them when hideDone is false', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        buildJiraIssue({}, 'TBX-101'),
        buildJiraIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }, 'TBX-102'),
      ],
    });

    const { result } = renderHook(() => useStandupBoardState());

    await waitFor(() => expect(result.current.issues.map((issue) => issue.key)).toEqual(['TBX-101']));
    act(() => result.current.setHideDone(false));

    expect(result.current.issues.map((issue) => issue.key)).toEqual(['TBX-102', 'TBX-101']);
  });

  it('sorts issues within a status category by age descending', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        buildJiraIssue({ created: buildDateDaysAgo(1) }, 'TBX-YOUNG'),
        buildJiraIssue({ created: buildDateDaysAgo(9) }, 'TBX-OLD'),
      ],
    });

    const { result } = renderHook(() => useStandupBoardState());

    await waitFor(() => expect(result.current.issues.map((issue) => issue.key)).toEqual(['TBX-OLD', 'TBX-YOUNG']));
  });

  it('persists JQL and Hide-Done settings into one localStorage object', async () => {
    const { result } = renderHook(() => useStandupBoardState());

    act(() => result.current.setJql('project = ABC'));
    act(() => result.current.setHideDone(false));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(STANDUP_STORAGE_KEY) ?? '{}')).toEqual({
        jql: 'project = ABC',
        hideDone: false,
      });
    });
  });

  it('restores JQL and Hide-Done settings from localStorage', async () => {
    window.localStorage.setItem(STANDUP_STORAGE_KEY, JSON.stringify({ jql: 'project = RESTORED', hideDone: false }));

    const { result } = renderHook(() => useStandupBoardState());

    expect(result.current.jql).toBe('project = RESTORED');
    expect(result.current.hideDone).toBe(false);
    await waitFor(() => expect(mockJiraGet).toHaveBeenCalledWith(buildStandupSearchPath('project = RESTORED')));
  });

  it('surfaces an error when jiraGet rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unavailable'));

    const { result } = renderHook(() => useStandupBoardState());

    await waitFor(() => expect(result.current.errorMessage).toBe('Jira unavailable'));
    expect(result.current.issues).toEqual([]);
  });
});
