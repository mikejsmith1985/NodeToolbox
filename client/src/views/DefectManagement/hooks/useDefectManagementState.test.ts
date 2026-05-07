// useDefectManagementState.test.ts — Hook unit tests for Defect Management filtering, sorting, persistence, and Jira loading.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateDefectAge,
  calculateDefectUpdated,
  calculatePriorityOrder,
  detectIssueIsDefect,
  filterDefects,
  sortDefects,
  useDefectManagementState,
  type DefectIssue,
} from './useDefectManagementState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from '../../../services/jiraApi.ts';

const mockJiraGet = vi.mocked(jiraGet);
const CURRENT_DATE_ISO = '2024-04-20T12:00:00.000Z';
const ONE_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

interface RawIssueOverride {
  key?: string;
  issueType?: string;
  priority?: string;
  statusCategory?: 'new' | 'indeterminate' | 'done';
  status?: string;
  assignee?: string | null;
  createdDaysAgo?: number;
  updatedDaysAgo?: number;
}

function createIsoDaysAgo(daysAgo: number): string {
  return new Date(new Date(CURRENT_DATE_ISO).getTime() - daysAgo * ONE_DAY_MILLISECONDS).toISOString();
}

function buildRawIssue(overrides: RawIssueOverride = {}) {
  return {
    key: overrides.key ?? 'TBX-1',
    fields: {
      summary: `${overrides.key ?? 'TBX-1'} summary`,
      issuetype: { name: overrides.issueType ?? 'Bug' },
      priority: { name: overrides.priority ?? 'Medium' },
      status: {
        name: overrides.status ?? 'To Do',
        statusCategory: { key: overrides.statusCategory ?? 'new' },
      },
      assignee: overrides.assignee === undefined
        ? { displayName: 'Alex' }
        : overrides.assignee === null
          ? null
          : { displayName: overrides.assignee },
      created: createIsoDaysAgo(overrides.createdDaysAgo ?? 5),
      updated: createIsoDaysAgo(overrides.updatedDaysAgo ?? 2),
    },
  };
}

function buildDefect(overrides: Partial<DefectIssue> = {}): DefectIssue {
  return {
    key: overrides.key ?? 'TBX-1',
    summary: overrides.summary ?? 'Defect summary',
    priority: overrides.priority ?? 'Medium',
    status: overrides.status ?? 'To Do',
    statusCat: overrides.statusCat ?? 'new',
    assignee: overrides.assignee ?? 'Alex',
    issueType: overrides.issueType ?? 'Bug',
    created: overrides.created ?? createIsoDaysAgo(5),
    updated: overrides.updated ?? createIsoDaysAgo(2),
    ageDays: overrides.ageDays ?? 5,
    updatedDays: overrides.updatedDays ?? 2,
  };
}

beforeEach(() => {
  mockJiraGet.mockReset();
  window.localStorage.clear();
  vi.setSystemTime(new Date(CURRENT_DATE_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Defect Management helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('detectIssueIsDefect accepts bug and defect issue type names only', () => {
    expect(detectIssueIsDefect(buildRawIssue({ issueType: 'Bug' }))).toBe(true);
    expect(detectIssueIsDefect(buildRawIssue({ issueType: 'Defect' }))).toBe(true);
    expect(detectIssueIsDefect(buildRawIssue({ issueType: 'Sub-bug' }))).toBe(true);
    expect(detectIssueIsDefect(buildRawIssue({ issueType: 'Story' }))).toBe(false);
  });

  it('calculatePriorityOrder follows the legacy severity ranking', () => {
    expect(calculatePriorityOrder('Highest')).toBe(0);
    expect(calculatePriorityOrder('Critical')).toBe(0);
    expect(calculatePriorityOrder('Blocker')).toBe(0);
    expect(calculatePriorityOrder('High')).toBe(1);
    expect(calculatePriorityOrder('Medium')).toBe(2);
    expect(calculatePriorityOrder('Low')).toBe(3);
    expect(calculatePriorityOrder('Lowest')).toBe(3);
    expect(calculatePriorityOrder('Trivial')).toBe(4);
  });

  it('calculates created and updated age in whole days', () => {
    const rawIssue = buildRawIssue({ createdDaysAgo: 9, updatedDaysAgo: 4 });

    expect(calculateDefectAge(rawIssue)).toBe(9);
    expect(calculateDefectUpdated(rawIssue)).toBe(4);
  });

  it('filterDefects applies priority, status category, and unassigned filters independently and together', () => {
    const defects = [
      buildDefect({ key: 'TBX-1', priority: 'High', statusCat: 'new', assignee: '' }),
      buildDefect({ key: 'TBX-2', priority: 'Medium', statusCat: 'indeterminate', assignee: 'Alex' }),
      buildDefect({ key: 'TBX-3', priority: 'High', statusCat: 'indeterminate', assignee: '' }),
    ];

    expect(filterDefects(defects, { priority: 'High', statusCat: '', unassignedOnly: false }).map((defect) => defect.key)).toEqual([
      'TBX-1',
      'TBX-3',
    ]);
    expect(filterDefects(defects, { priority: '', statusCat: 'indeterminate', unassignedOnly: false }).map((defect) => defect.key)).toEqual([
      'TBX-2',
      'TBX-3',
    ]);
    expect(filterDefects(defects, { priority: '', statusCat: '', unassignedOnly: true }).map((defect) => defect.key)).toEqual([
      'TBX-1',
      'TBX-3',
    ]);
    expect(filterDefects(defects, { priority: 'High', statusCat: 'indeterminate', unassignedOnly: true }).map((defect) => defect.key)).toEqual([
      'TBX-3',
    ]);
  });

  it('sortDefects supports priority-age, age, and updated ordering', () => {
    const defects = [
      buildDefect({ key: 'TBX-1', priority: 'Medium', ageDays: 20, updatedDays: 1 }),
      buildDefect({ key: 'TBX-2', priority: 'High', ageDays: 3, updatedDays: 10 }),
      buildDefect({ key: 'TBX-3', priority: 'High', ageDays: 8, updatedDays: 5 }),
    ];

    expect(sortDefects(defects, 'priority-age').map((defect) => defect.key)).toEqual(['TBX-3', 'TBX-2', 'TBX-1']);
    expect(sortDefects(defects, 'age').map((defect) => defect.key)).toEqual(['TBX-1', 'TBX-3', 'TBX-2']);
    expect(sortDefects(defects, 'updated').map((defect) => defect.key)).toEqual(['TBX-2', 'TBX-3', 'TBX-1']);
  });
});

describe('useDefectManagementState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('starts with restored filters from localStorage', () => {
    window.localStorage.setItem(
      'tbxDefectFilters',
      JSON.stringify({
        projectKey: 'TBX',
        extraJql: 'statusCategory != Done',
        filter: { priority: 'High', statusCat: 'indeterminate', unassignedOnly: true },
        sort: 'updated',
      }),
    );

    const { result } = renderHook(() => useDefectManagementState());

    expect(result.current.projectKey).toBe('TBX');
    expect(result.current.extraJql).toBe('statusCategory != Done');
    expect(result.current.filter).toEqual({ priority: 'High', statusCat: 'indeterminate', unassignedOnly: true });
    expect(result.current.sort).toBe('updated');
  });

  it('persists project, extra JQL, filters, and sort whenever they change', () => {
    const { result } = renderHook(() => useDefectManagementState());

    act(() => result.current.setProjectKey('TBX'));
    act(() => result.current.setExtraJql('labels = escaped'));
    act(() => result.current.setFilter('priority', 'Highest'));
    act(() => result.current.setFilter('unassignedOnly', true));
    act(() => result.current.setSort('age'));

    expect(JSON.parse(window.localStorage.getItem('tbxDefectFilters') ?? '{}')).toEqual({
      projectKey: 'TBX',
      extraJql: 'labels = escaped',
      filter: { priority: 'Highest', statusCat: '', unassignedOnly: true },
      sort: 'age',
    });
  });

  it('calls Jira with project JQL, requested fields, and extra JQL, then maps defects', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        buildRawIssue({ key: 'TBX-1', issueType: 'Bug', priority: 'High', createdDaysAgo: 12, updatedDaysAgo: 3 }),
        buildRawIssue({ key: 'TBX-2', issueType: 'Story' }),
      ],
    });
    const { result } = renderHook(() => useDefectManagementState());

    act(() => result.current.setProjectKey('TBX'));
    act(() => result.current.setExtraJql('statusCategory != Done'));
    await act(async () => {
      await result.current.reload();
    });

    const calledPath = mockJiraGet.mock.calls[0]?.[0] ?? '';
    const encodedJqlText = new URLSearchParams(calledPath.split('?')[1]).get('jql') ?? '';
    expect(encodedJqlText).toContain('project=TBX');
    expect(encodedJqlText).toContain('issuetype in (Bug, Defect)');
    expect(encodedJqlText).toContain('created >= -90d');
    expect(encodedJqlText).toContain('statusCategory != Done');
    expect(calledPath).toContain('fields=summary,status,priority,assignee,issuetype,created,updated');
    expect(calledPath).toContain('maxResults=200');
    expect(result.current.rawIssueCount).toBe(2);
    expect(result.current.defects).toHaveLength(1);
    expect(result.current.defects[0]).toMatchObject({ key: 'TBX-1', priority: 'High', ageDays: 12, updatedDays: 3 });
  });

  it('sets a friendly error and clears defects when Jira loading fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira unavailable'));
    const { result } = renderHook(() => useDefectManagementState());

    act(() => result.current.setProjectKey('TBX'));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.errorMessage).toBe('Jira unavailable');
    expect(result.current.defects).toEqual([]);
    expect(result.current.rawIssueCount).toBe(0);
  });
});
