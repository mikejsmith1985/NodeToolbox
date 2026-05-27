// useSprintStandupState.test.ts — Hook tests for live ToolBox standup mode persistence and DSU-style person-walk behavior.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';

const { mockJiraGet, mockJiraPost } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
}));

import {
  calculateIssueAgeDays,
  classifyIssueAge,
  formatPersonWalkText,
  hasBlockingLink,
  useSprintStandupState,
} from './useSprintStandupState.ts';
import { useStandupPlanningStore } from './useStandupPlanningStore.ts';
import { useStandupRosterStore } from './useStandupRosterStore.ts';
import { useSettingsStore } from '../../../store/settingsStore.ts';

const STANDUP_UI_STORAGE_KEY = 'tbxSprintDashboardStandupUi:legacy-default';

function buildIssue(
  issueKey: string,
  summary: string,
  statusName = 'In Progress',
  statusCategoryKey = 'indeterminate',
  assigneeAccountId = 'user-1',
  updated = '2026-05-06T12:00:00.000Z',
): JiraIssue {
  const issueFields = {
    summary,
    status: { name: statusName, statusCategory: { key: statusCategoryKey } },
    priority: { name: 'Medium', iconUrl: 'priority.png' },
    assignee: assigneeAccountId
      ? {
          accountId: assigneeAccountId,
          displayName: 'Alex Example',
          emailAddress: 'alex@example.com',
          avatarUrls: {},
        }
      : null,
    reporter: null,
    issuelinks: issueKey === 'TBX-2' ? [{ type: { name: 'Blocks' }, inwardIssue: { key: 'TBX-1' } }] : [],
    issuetype: { name: 'Story', iconUrl: 'story.png' },
    created: '2026-05-01T00:00:00.000Z',
    updated,
    description: null,
    customfield_10016: 5,
    fixVersions: [],
  } as JiraIssue['fields'] & { issuelinks?: Array<{ type?: { name?: string }; inwardIssue?: { key: string } }> };

  return {
    id: issueKey,
    key: issueKey,
    fields: issueFields,
  };
}

function createRelativeIsoDate(dayOffset: number): string {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + dayOffset);
  return targetDate.toISOString();
}

describe('useSprintStandupState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStandupPlanningStore.setState({ dashboardTeamProfileId: 'legacy-default', planEntries: [] });
    useStandupRosterStore.setState({ dashboardTeamProfileId: 'legacy-default', rosterMembers: [] });
    useSettingsStore.setState({ sprintDashboardActiveTeam: '' });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    useStandupPlanningStore.setState({ dashboardTeamProfileId: 'legacy-default', planEntries: [] });
    useStandupRosterStore.setState({ dashboardTeamProfileId: 'legacy-default', rosterMembers: [] });
    useSettingsStore.setState({ sprintDashboardActiveTeam: '' });
  });

  it('formats the live person-walk preview text exactly', () => {
    expect(
      formatPersonWalkText({
        yesterday: '• TBX-1 - Fixed thing',
        today: '• TBX-2 - Build thing',
        blockers: '',
      }),
    ).toBe('*Yesterday*\n• TBX-1 - Fixed thing\n\n*Today*\n• TBX-2 - Build thing\n\n*Blockers*\nNone');
  });

  it('detects blocker links and legacy age bands', () => {
    expect(hasBlockingLink(buildIssue('TBX-2', 'Blocked issue'))).toBe(true);
    expect(classifyIssueAge(1)).toBe('ok');
    expect(classifyIssueAge(3)).toBe('warn');
    expect(classifyIssueAge(6)).toBe('old');
    expect(calculateIssueAgeDays(buildIssue('TBX-1', 'Age check', 'In Progress', 'indeterminate', 'user-1', createRelativeIsoDate(-1)))).toBe(1);
  });

  it('refreshes DSU-style person-walk text from the current user issues', async () => {
    mockJiraGet.mockResolvedValueOnce({ accountId: 'user-1' });
    const { result } = renderHook(() =>
      useSprintStandupState([
        buildIssue('TBX-1', 'Finished yesterday', 'Done', 'done', 'user-1', createRelativeIsoDate(-1)),
        buildIssue('TBX-2', 'Continue today', 'In Progress', 'indeterminate', 'user-1', createRelativeIsoDate(0)),
        buildIssue('TBX-3', 'Someone else issue', 'In Progress', 'indeterminate', 'user-2'),
      ], 'TBX'),
    );

    await waitFor(() => {
      expect(result.current.state.personWalkDraft.yesterday).toBe('• TBX-1 - Finished yesterday');
      expect(result.current.state.personWalkDraft.today).toBe('• TBX-2 - Continue today');
    });
  });

  it('persists standup mode and posts person-walk comments to Jira', async () => {
    mockJiraGet.mockResolvedValueOnce({ accountId: 'user-1' });
    mockJiraPost.mockResolvedValueOnce({});
    const { result } = renderHook(() => useSprintStandupState([buildIssue('TBX-2', 'Continue today')], 'TBX'));

    await waitFor(() => {
      expect(result.current.state.personWalkDraft.today).toContain('TBX-2');
    });

    act(() => {
      result.current.actions.setStandupMode('personwalk');
      result.current.actions.setPersonWalkDraftField('blockers', 'Waiting on access');
      result.current.actions.setPersonWalkPostKey('tbx-99');
    });

    await act(async () => {
      await result.current.actions.postPersonWalkComment();
    });

    expect(JSON.parse(localStorage.getItem(STANDUP_UI_STORAGE_KEY) ?? '{}')).toMatchObject({
      mode: 'personwalk',
    });
    expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-99/comment', {
      body: '*Yesterday*\n• (nothing updated yesterday)\n\n*Today*\n• TBX-2 - Continue today\n\n*Blockers*\nWaiting on access',
    });
  });

  it('toggles board-walk status filters correctly across batched clicks', () => {
    const { result } = renderHook(() =>
      useSprintStandupState([
        buildIssue('TBX-1', 'Keep moving', 'In Progress', 'indeterminate'),
        buildIssue('TBX-2', 'Watch the blocker', 'Blocked', 'indeterminate'),
      ], 'TBX'),
    );

    expect(result.current.state.boardwalkStatusFilters.indeterminate['In Progress']).toBe(true);

    act(() => {
      result.current.actions.toggleBoardwalkStatusFilter('indeterminate', 'In Progress');
      result.current.actions.toggleBoardwalkStatusFilter('indeterminate', 'In Progress');
    });

    expect(result.current.state.boardwalkStatusFilters.indeterminate['In Progress']).toBe(true);
  });

  it('persists the selected standup scope and uses yesterday plan entries as today defaults', () => {
    useStandupPlanningStore.getState().togglePlannedIssueKey('2026-05-17', 'sprint', 'TBX', 'Alex Example', 'TBX-1');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00.000Z'));

    const { result } = renderHook(() =>
      useSprintStandupState([
        buildIssue('TBX-1', 'Keep moving', 'In Progress', 'indeterminate'),
        buildIssue('TBX-2', 'Watch the blocker', 'Blocked', 'indeterminate'),
      ], 'TBX'),
    );

    expect(result.current.state.plannedIssueKeysByPerson['Alex Example']).toEqual(['TBX-1']);

    act(() => {
      result.current.actions.setScopeMode('roster');
    });

    expect(result.current.state.scopeMode).toBe('roster');
    expect(JSON.parse(localStorage.getItem(STANDUP_UI_STORAGE_KEY) ?? '{}')).toMatchObject({
      scopeMode: 'roster',
    });
  });

  it('loads roster issues when roster scope is selected', async () => {
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Taylor Teammate',
      assigneeQueryValue: 'Taylor Teammate',
    });
    mockJiraGet
      .mockResolvedValueOnce({
        issues: [buildIssue('TBX-7', 'Roster work item', 'In Progress', 'indeterminate', 'user-7', createRelativeIsoDate(0))],
      })
      .mockResolvedValueOnce({ accountId: 'user-1' });

    const { result } = renderHook(() => useSprintStandupState([], 'TBX'));

    await act(async () => {
      result.current.actions.setScopeMode('roster');
    });

    await waitFor(() => {
      expect(result.current.state.scopeIssues.map((issue) => issue.key)).toEqual(['TBX-7']);
    });
  });

  it('reloads roster issues when the roster members change without changing roster size', async () => {
    useStandupRosterStore.getState().replaceRosterMembers([
      {
        displayName: 'Taylor Teammate',
        assigneeQueryValue: 'Taylor Teammate',
      },
    ]);
    mockJiraGet
      .mockResolvedValueOnce({
        issues: [buildIssue('TBX-7', 'Taylor roster work', 'In Progress', 'indeterminate', 'user-7', createRelativeIsoDate(0))],
      })
      .mockResolvedValueOnce({ accountId: 'user-1' })
      .mockResolvedValueOnce({
        issues: [buildIssue('TBX-8', 'Jordan roster work', 'In Progress', 'indeterminate', 'user-8', createRelativeIsoDate(0))],
      });

    const { result } = renderHook(() => useSprintStandupState([], 'TBX'));

    await act(async () => {
      result.current.actions.setScopeMode('roster');
    });

    await waitFor(() => {
      expect(result.current.state.scopeIssues.map((issue) => issue.key)).toEqual(['TBX-7']);
    });

    act(() => {
      useStandupRosterStore.getState().replaceRosterMembers([
        {
          displayName: 'Jordan Joiner',
          assigneeQueryValue: 'Jordan Joiner',
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.state.scopeIssues.map((issue) => issue.key)).toEqual(['TBX-8']);
    });
  });

  it('limits roster scope loading to the currently active team', async () => {
    useStandupRosterStore.getState().replaceRosterMembers([
      {
        displayName: 'Taylor Teammate',
        assigneeQueryValue: 'Taylor Teammate',
        teamName: 'Transformers',
      },
      {
        displayName: 'Jordan Joiner',
        assigneeQueryValue: 'Jordan Joiner',
        teamName: 'Clean Up Crew',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeam('Transformers');
    mockJiraGet
      .mockResolvedValueOnce({
        issues: [buildIssue('TBX-9', 'Transformer work', 'In Progress', 'indeterminate', 'user-9', createRelativeIsoDate(0))],
      })
      .mockResolvedValueOnce({ accountId: 'user-1' });

    const { result } = renderHook(() => useSprintStandupState([], 'TBX'));

    await act(async () => {
      result.current.actions.setScopeMode('roster');
    });

    await waitFor(() => {
      expect(result.current.state.activeRosterTeamName).toBe('Transformers');
      expect(result.current.state.scopeIssues.map((issue) => issue.key)).toEqual(['TBX-9']);
    });

    expect(mockJiraGet).toHaveBeenCalledWith(expect.stringContaining('Taylor%20Teammate'));
    expect(mockJiraGet).not.toHaveBeenCalledWith(expect.stringContaining('Jordan%20Joiner'));
  });

  it('does not let a new team inherit bare-key standup ui state after scoped data exists', () => {
    localStorage.setItem('tbxSprintDashboardStandupUi', JSON.stringify({
      mode: 'personwalk',
      scopeMode: 'roster',
      shouldShowDoneColumn: true,
    }));
    localStorage.setItem('tbxSprintDashboardStandupUi:team-alpha', JSON.stringify({
      mode: 'boardwalk',
      scopeMode: 'sprint',
      shouldShowDoneColumn: false,
    }));

    const { result } = renderHook(() => useSprintStandupState([], 'TBX', 'team-beta'));

    expect(result.current.state.standupMode).toBe('boardwalk');
    expect(result.current.state.scopeMode).toBe('sprint');
    expect(result.current.state.shouldShowDoneColumn).toBe(false);
  });

  it('migrates bare-key standup ui state into the first scoped team key', () => {
    localStorage.setItem('tbxSprintDashboardStandupUi', JSON.stringify({
      mode: 'personwalk',
      scopeMode: 'roster',
      shouldShowDoneColumn: true,
    }));

    const { result } = renderHook(() => useSprintStandupState([], 'TBX', 'team-alpha'));

    expect(result.current.state.standupMode).toBe('personwalk');
    expect(result.current.state.scopeMode).toBe('roster');
    expect(result.current.state.shouldShowDoneColumn).toBe(true);
    expect(localStorage.getItem('tbxSprintDashboardStandupUi:team-alpha')).toBe(JSON.stringify({
      mode: 'personwalk',
      scopeMode: 'roster',
      shouldShowDoneColumn: true,
    }));
  });
});
