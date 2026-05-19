// useDsuBoardState.test.ts — Hook tests for exact legacy DSU Board JQL, persistence, and standup helpers.

import { act, renderHook, waitFor } from '@testing-library/react';
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

import { useSettingsStore } from '../../../store/settingsStore.ts';
import { useStandupRosterStore } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import { useDsuBoardState } from './useDsuBoardState.ts';

const PROJECT_VERSIONS = [
  { name: 'Release 24.1', released: false },
  { name: 'Release 24.2', released: false },
  { name: 'Release 23.9', released: true },
];

function createIssue(
  issueKey: string,
  summary = 'Test issue',
  statusName = 'In Progress',
  statusCategoryKey = 'indeterminate',
): JiraIssue {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      priority: { name: 'High', iconUrl: '' },
      assignee: {
        accountId: 'alice',
        displayName: 'Alice',
        emailAddress: 'alice@example.com',
        avatarUrls: {},
      },
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
      fixVersions: [{ name: 'Release 24.1' }],
      customfield_10016: 3,
    },
  };
}

function configureBoardResponses(searchIssues: JiraIssue[] = [createIssue('TBX-1')]): void {
  mockJiraGet.mockImplementation(async (path: string) => {
    if (path === '/rest/api/2/project/TBX/versions') {
      return PROJECT_VERSIONS;
    }

    if (path === '/rest/api/2/project/ENFCT/versions') {
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

function getDecodedSearchCalls(): string[] {
  return mockJiraGet.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith('/rest/api/2/search?'))
    .map((path) => decodeURIComponent(path));
}

describe('useDsuBoardState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.getState().setDsuProjectKey('');
    useStandupRosterStore.setState({ rosterMembers: [] });
    mockEnrichIssuesWithSnowLinks.mockResolvedValue({});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    useSettingsStore.getState().setDsuProjectKey('');
    useStandupRosterStore.setState({ rosterMembers: [] });
  });

  it('initialises with the legacy DSU defaults', () => {
    const { result } = renderHook(() => useDsuBoardState());

    expect(result.current.state.sections).toHaveLength(8);
    expect(result.current.state.projectKey).toBe('');
    expect(result.current.state.staleDays).toBe(5);
    expect(result.current.state.viewMode).toBe('cards');
  });

  it('persists project key, stale days, view mode, and selected release', async () => {
    configureBoardResponses();
    const { result } = renderHook(() => useDsuBoardState());

    act(() => {
      result.current.actions.setProjectKey('TBX');
      result.current.actions.setStaleDays(7);
      result.current.actions.setViewMode('table');
    });

    await act(async () => {
      await result.current.actions.loadBoard();
      await result.current.actions.setSelectedRelease('Release 24.2');
    });

    expect(useSettingsStore.getState().dsuProjectKey).toBe('TBX');
    expect(localStorage.getItem('tbxDSUStaleDays')).toBe('7');
    expect(localStorage.getItem('tbxDSUView')).toBe('table');
    expect(localStorage.getItem('tbxDSUSelectedRelease')).toBe('Release 24.2');
  });

  it('builds the exact legacy JQLs when loading the board', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-08T12:00:00.000Z'));
    configureBoardResponses();
    const { result } = renderHook(() => useDsuBoardState());

    act(() => {
      result.current.actions.setProjectKey('TBX');
      result.current.actions.setStaleDays(7);
    });

    await act(async () => {
      await result.current.actions.loadBoard();
    });

    const searchCalls = getDecodedSearchCalls();

    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND created >= "2025/01/07 17:00" ORDER BY created DESC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );
    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND updated <= "-7d" AND statusCategory = "In Progress" ORDER BY updated ASC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );
    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND fixVersion = "Release 24.1" ORDER BY priority ASC, updated DESC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );
    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND (summary ~ "INC*" OR summary ~ "PRB*") AND statusCategory != Done ORDER BY created DESC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );
    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND statusCategory in ("To Do", "In Progress") ORDER BY priority ASC, updated DESC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );
    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND watcher = currentUser() ORDER BY updated DESC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );

    const rosterJiraSection = result.current.state.sections.find((section) => section.key === 'roster-jira');
    expect(rosterJiraSection?.loadError).toBe(
      'No roster members — add team members in the Team Dashboard → Roster tab first',
    );
  });

  it('auto-loads when a persisted DSU project key already exists', async () => {
    configureBoardResponses([createIssue('ENFCT-1')]);
    useSettingsStore.getState().setDsuProjectKey('ENFCT');

    const { result } = renderHook(() => useDsuBoardState());

    await waitFor(() => {
      expect(result.current.state.projectKey).toBe('ENFCT');
      expect(result.current.state.availableVersions).toEqual(['Release 24.1', 'Release 24.2']);
    });

    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/project/ENFCT/versions');
  });

  it('uses the Team Dashboard roster when building the roster Jira section query', async () => {
    configureBoardResponses();
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Alice Adams',
      assigneeQueryValue: 'Alice Adams',
      teamName: 'Transformers',
    });
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Bob Brown',
      assigneeQueryValue: 'Bob Brown',
      teamName: 'Clean Up Crew',
    });
    const { result } = renderHook(() => useDsuBoardState());

    act(() => {
      result.current.actions.setProjectKey('TBX');
    });

    await act(async () => {
      await result.current.actions.loadBoard();
    });

    const searchCalls = getDecodedSearchCalls();

    expect(searchCalls).toContain(
      '/rest/api/2/search?jql=project = "TBX" AND assignee in ("Alice Adams", "Bob Brown") AND statusCategory in ("To Do","In Progress") ORDER BY assignee ASC, priority ASC&fields=summary,status,priority,assignee,issuetype,created,updated,duedate,fixVersions,issuelinks,labels,customfield_10016,customfield_10028,customfield_10014,customfield_10301,comment&maxResults=100',
    );
  });

  it('loads transitions, posts comments, and keeps standup note persistence intact', async () => {
    vi.useFakeTimers();
    configureBoardResponses();
    mockJiraPost.mockResolvedValue({});
    const { result } = renderHook(() => useDsuBoardState());

    await act(async () => {
      await result.current.actions.loadTransitions('TBX-1');
      await result.current.actions.postComment('TBX-1', 'Looking good!');
    });

    act(() => {
      result.current.actions.updateStandupNotes({
        yesterday: 'Reviewed PR',
        today: 'Writing tests',
        blockers: 'None',
      });
    });

    act(() => {
      vi.advanceTimersByTime(500);
      result.current.actions.copyStandupToClipboard();
    });

    expect(result.current.state.availableTransitions[0].name).toBe('In Progress');
    expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-1/comment', { body: 'Looking good!' });
    expect(JSON.parse(localStorage.getItem('tbxDsuStandupNotes') ?? '{}')).toMatchObject({
      notes: {
        yesterday: 'Reviewed PR',
        today: 'Writing tests',
        blockers: 'None',
      },
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '📅 Yesterday: Reviewed PR\n▶️ Today: Writing tests\n🚫 Blockers: None',
    );
  });
});
