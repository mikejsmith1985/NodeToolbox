// useArtData.test.ts — Unit tests for the ART View data hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
}));

import { useArtData } from './useArtData.ts';

const MOCK_ISSUE = {
  id: 'TBX-1', key: 'TBX-1',
  fields: {
    summary: 'Test task',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: null, assignee: null, reporter: null,
    issuetype: { name: 'Story', iconUrl: '' },
    created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
    description: null,
  },
};

const MOCK_DONE_ISSUE = {
  id: 'TBX-2', key: 'TBX-2',
  fields: {
    summary: 'Done task',
    status: { name: 'Done', statusCategory: { key: 'done' } },
    priority: null, assignee: null, reporter: null,
    issuetype: { name: 'Story', iconUrl: '' },
    created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
    description: null,
  },
};

describe('useArtData', () => {
  beforeEach(() => {
    localStorage.clear();
    mockJiraGet.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    mockJiraGet.mockReset();
  });

  it('initialises with empty teams and overview tab', () => {
    const { result } = renderHook(() => useArtData());
    expect(result.current.state.teams).toEqual([]);
    expect(result.current.state.activeTab).toBe('overview');
  });

  it('sets activeTab when setActiveTab is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.setActiveTab('impediments'); });
    expect(result.current.state.activeTab).toBe('impediments');
  });

  it('loads stored teams from localStorage on initial render', async () => {
    localStorage.setItem(
      'nodetoolbox-art-teams',
      JSON.stringify([{ id: 'team-1', name: 'Stored Team', boardId: '42', projectKey: 'ALPHA' }]),
    );
    mockJiraGet.mockResolvedValue({ issues: [] });

    const { result } = renderHook(() => useArtData());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.teams).toHaveLength(1);
    expect(result.current.state.teams[0].name).toBe('Stored Team');
    expect(result.current.state.teams[0].projectKey).toBe('ALPHA');
  });

  it('adds a team when addTeam is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    expect(result.current.state.teams).toHaveLength(1);
    expect(result.current.state.teams[0].name).toBe('Alpha Team');
    expect(result.current.state.teams[0].boardId).toBe('42');
  });

  it('stores the selected board name when addTeam receives Jira board metadata', () => {
    const { result } = renderHook(() => useArtData());

    act(() => {
      result.current.actions.addTeam('Alpha Team', '42', 'ALPHA', 'Transformers Board');
    });

    expect(result.current.state.teams[0].boardName).toBe('Transformers Board');
  });

  it('removes a team when removeTeam is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    act(() => { result.current.actions.removeTeam(teamId); });
    expect(result.current.state.teams).toHaveLength(0);
  });

  it('persists teams to localStorage when the roster changes', () => {
    const { result } = renderHook(() => useArtData());

    act(() => {
      result.current.actions.addTeam('Alpha Team', '42', 'ALPHA');
    });

    expect(localStorage.getItem('nodetoolbox-art-teams')).toContain('Alpha Team');
    expect(localStorage.getItem('nodetoolbox-art-teams')).toContain('ALPHA');
  });

  it('saveTeams writes the current roster to localStorage on demand', () => {
    const { result } = renderHook(() => useArtData());

    act(() => {
      result.current.actions.addTeam('Alpha Team', '42', 'ALPHA');
      result.current.actions.saveTeams();
    });

    expect(localStorage.getItem('nodetoolbox-art-teams')).toContain('Alpha Team');
  });

  it('loads sprint issues for a team when loadTeam resolves', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 42, name: 'Alpha Board', type: 'scrum' })
      .mockResolvedValueOnce({ values: [{ id: 7, name: 'Sprint 7', state: 'active' }] })
      .mockResolvedValueOnce({ issues: [MOCK_ISSUE] });
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });
    expect(result.current.state.teams[0].sprintIssues).toHaveLength(1);
    expect(result.current.state.teams[0].loadError).toBeNull();
  });

  it('loads board issues for kanban teams instead of requiring a sprint', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 467, name: 'SIS Board', type: 'kanban' })
      .mockResolvedValueOnce({ issues: [MOCK_ISSUE] });
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('SIS', '467'); });
    const teamId = result.current.state.teams[0].id;

    await act(async () => {
      await result.current.actions.loadTeam(teamId);
    });

    expect(result.current.state.teams[0].boardName).toBe('SIS Board');
    expect(result.current.state.teams[0].boardType).toBe('kanban');
    expect(result.current.state.teams[0].sprintIssues).toHaveLength(1);
    expect(result.current.state.teams[0].loadError).toBeNull();
  });

  it('loads PI options from Jira autocomplete and strips JQL quotes', async () => {
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_10301' }));
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/jql/autocompletedata/suggestions')) {
        return Promise.resolve({
          results: [
            { value: '"PI 26.2"' },
            { displayName: '"PI 26.3"' },
          ],
        });
      }

      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useArtData());

    act(() => {
      result.current.actions.addTeam('Alpha Team', '42', 'ALPHA');
    });

    await act(async () => {
      await result.current.actions.loadPiOptions();
    });

    expect(result.current.state.availablePiNames).toEqual(['PI 26.3', 'PI 26.2']);
  });

  it('auto-loads PI options on launch when ART teams are already stored', async () => {
    localStorage.setItem(
      'nodetoolbox-art-teams',
      JSON.stringify([{ id: 'team-1', name: 'Stored Team', boardId: '42', projectKey: 'ALPHA' }]),
    );
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_10301' }));
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/jql/autocompletedata/suggestions')) {
        return Promise.resolve({
          results: [{ value: '"PI 26.3 (05/21/26 - 07/29/26)"' }],
        });
      }

      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useArtData());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.availablePiNames).toEqual(['PI 26.3 (05/21/26 - 07/29/26)']);
  });

  it('auto-loads PI options from autocomplete even when stored teams do not include project keys', async () => {
    localStorage.setItem(
      'nodetoolbox-art-teams',
      JSON.stringify([{ id: 'team-1', name: 'Stored Team', boardId: '42' }]),
    );
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_10301' }));
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/jql/autocompletedata/suggestions')) {
        return Promise.resolve({
          results: [{ value: '"PI 26.3 (05/21/26 - 07/29/26)"' }],
        });
      }

      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useArtData());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.availablePiNames).toEqual(['PI 26.3 (05/21/26 - 07/29/26)']);
  });

  it('selects the PI that covers the current date during the launch auto-load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1));
    localStorage.setItem(
      'nodetoolbox-art-teams',
      JSON.stringify([{ id: 'team-1', name: 'Stored Team', boardId: '42', projectKey: 'ALPHA' }]),
    );
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_10301' }));
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/jql/autocompletedata/suggestions')) {
        return Promise.resolve({
          results: [
            { value: '"PI 26.2 (02/26/26 - 04/29/26)"' },
            { value: '"PI 26.3 (05/21/26 - 07/29/26)"' },
          ],
        });
      }

      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useArtData());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.selectedPiName).toBe('PI 26.3 (05/21/26 - 07/29/26)');
    expect(JSON.parse(localStorage.getItem('tbxARTSettings') || '{}').piName).toBe(
      'PI 26.3 (05/21/26 - 07/29/26)',
    );
  });

  it('replaces a stale stored PI with the PI covering today during launch auto-load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1));
    localStorage.setItem(
      'nodetoolbox-art-teams',
      JSON.stringify([{ id: 'team-1', name: 'Stored Team', boardId: '42', projectKey: 'ALPHA' }]),
    );
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({
        piFieldId: 'customfield_10301',
        piName: 'PI 26.2 (02/26/26 - 04/29/26)',
      }),
    );
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/jql/autocompletedata/suggestions')) {
        return Promise.resolve({
          results: [
            { value: '"PI 26.2 (02/26/26 - 04/29/26)"' },
            { value: '"PI 26.3 (05/21/26 - 07/29/26)"' },
          ],
        });
      }

      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useArtData());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.state.selectedPiName).toBe('PI 26.3 (05/21/26 - 07/29/26)');
  });

  it('does not overwrite a manual PI selection when the user reloads PI options', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1));
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piFieldId: 'customfield_10301' }));
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/jql/autocompletedata/suggestions')) {
        return Promise.resolve({
          results: [
            { value: '"PI 26.2 (02/26/26 - 04/29/26)"' },
            { value: '"PI 26.3 (05/21/26 - 07/29/26)"' },
          ],
        });
      }

      return Promise.resolve({ issues: [] });
    });

    const { result } = renderHook(() => useArtData());

    act(() => {
      result.current.actions.addTeam('Alpha Team', '42', 'ALPHA');
      result.current.actions.setSelectedPiName('PI 26.2 (02/26/26 - 04/29/26)');
    });

    await act(async () => {
      await result.current.actions.loadPiOptions();
    });

    expect(result.current.state.selectedPiName).toBe('PI 26.2 (02/26/26 - 04/29/26)');
  });

  it('sets team loadError when loadTeam rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('Board not found'));
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Beta Team', '99'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });
    expect(result.current.state.teams[0].loadError).toBeTruthy();
    expect(result.current.state.teams[0].sprintIssues).toHaveLength(0);
  });

  // ── Phase 6: SoS Drawer state ──

  it('initialises sosExpandedTeams to empty array', () => {
    const { result } = renderHook(() => useArtData());
    expect(result.current.state.sosExpandedTeams).toEqual([]);
  });

  it('toggleSosTeam adds a team id to sosExpandedTeams', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.toggleSosTeam('team-abc'); });
    expect(result.current.state.sosExpandedTeams).toContain('team-abc');
  });

  it('toggleSosTeam removes a team id when it is already expanded', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.toggleSosTeam('team-abc'); });
    act(() => { result.current.actions.toggleSosTeam('team-abc'); });
    expect(result.current.state.sosExpandedTeams).not.toContain('team-abc');
  });

  it('toggleSosTeam can expand multiple teams independently', () => {
    const { result } = renderHook(() => useArtData());
    act(() => {
      result.current.actions.toggleSosTeam('team-a');
      result.current.actions.toggleSosTeam('team-b');
    });
    expect(result.current.state.sosExpandedTeams).toContain('team-a');
    expect(result.current.state.sosExpandedTeams).toContain('team-b');
  });

  // ── Phase 6: Board Prep state ──

  it('initialises boardPrepTeamFilter to "all"', () => {
    const { result } = renderHook(() => useArtData());
    expect(result.current.state.boardPrepTeamFilter).toBe('all');
  });

  it('initialises boardPrepIssues to empty array', () => {
    const { result } = renderHook(() => useArtData());
    expect(result.current.state.boardPrepIssues).toEqual([]);
  });

  it('initialises isLoadingBoardPrep to false', () => {
    const { result } = renderHook(() => useArtData());
    expect(result.current.state.isLoadingBoardPrep).toBe(false);
  });

  it('setBoardPrepTeamFilter updates the team filter value', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.setBoardPrepTeamFilter('Alpha Team'); });
    expect(result.current.state.boardPrepTeamFilter).toBe('Alpha Team');
  });

  it('loadBoardPrep populates boardPrepIssues from board backlog on success', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 42, name: 'Alpha Board', type: 'scrum' })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'ALPHA-10', key: 'ALPHA-10',
            fields: {
              summary: 'Backlog ready story',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              priority: { name: 'High', iconUrl: '' },
              assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '', updated: '', description: null,
              customfield_10016: 5,
            },
          },
        ],
      });
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    await act(async () => { await result.current.actions.loadBoardPrep(); });
    expect(result.current.state.boardPrepIssues).toHaveLength(1);
    expect(result.current.state.boardPrepIssues[0].key).toBe('ALPHA-10');
    expect(result.current.state.boardPrepIssues[0].teamName).toBe('Alpha Team');
    expect(result.current.state.boardPrepIssues[0].estimate).toBe(5);
    expect(result.current.state.boardPrepIssues[0].priority).toBe('High');
    expect(result.current.state.isLoadingBoardPrep).toBe(false);
    expect(result.current.state.boardPrepError).toBeNull();
    expect(mockJiraGet).toHaveBeenNthCalledWith(1, '/rest/agile/1.0/board/42');
    expect(mockJiraGet).toHaveBeenNthCalledWith(
      2,
      `/rest/agile/1.0/board/42/backlog?maxResults=100&fields=${encodeURIComponent('summary,status,priority,customfield_10016,customfield_10028')}`,
    );
  });

  it('loadBoardPrep uses board issues for kanban teams instead of the scrum backlog endpoint', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 467, name: 'SIS Board', type: 'kanban' })
      .mockResolvedValueOnce({
        issues: [
          {
            id: 'SIS-10',
            key: 'SIS-10',
            fields: {
              summary: 'Kanban-ready work item',
              status: { name: 'Selected for Development', statusCategory: { key: 'indeterminate' } },
              priority: { name: 'Medium', iconUrl: '' },
              assignee: null,
              reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '',
              updated: '',
              description: null,
              customfield_10016: 8,
            },
          },
        ],
      });

    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('SIS', '467'); });

    await act(async () => { await result.current.actions.loadBoardPrep(); });

    expect(mockJiraGet).toHaveBeenNthCalledWith(1, '/rest/agile/1.0/board/467');
    expect(mockJiraGet).toHaveBeenNthCalledWith(
      2,
      `/rest/agile/1.0/board/467/issue?maxResults=100&fields=${encodeURIComponent('summary,status,priority,customfield_10016,customfield_10028')}`,
    );
    expect(result.current.state.boardPrepIssues).toEqual([
      {
        teamName: 'SIS',
        key: 'SIS-10',
        summary: 'Kanban-ready work item',
        estimate: 8,
        priority: 'Medium',
      },
    ]);
    expect(result.current.state.boardPrepError).toBeNull();
  });

  it('loadBoardPrep sets boardPrepError when fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    await act(async () => { await result.current.actions.loadBoardPrep(); });
    expect(result.current.state.boardPrepError).toBeTruthy();
    expect(result.current.state.isLoadingBoardPrep).toBe(false);
  });

  // ── Phase 6: PI Progress Stats ──

  it('piProgressStats starts with all-zero values when no teams loaded', () => {
    const { result } = renderHook(() => useArtData());
    expect(result.current.state.piProgressStats.totalIssues).toBe(0);
    expect(result.current.state.piProgressStats.completionPercent).toBe(0);
    expect(result.current.state.piProgressStats.doneCount).toBe(0);
  });

  it('piProgressStats correctly counts done issues by statusCategory', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 42, name: 'Alpha Board', type: 'scrum' })
      .mockResolvedValueOnce({ values: [{ id: 7, name: 'Sprint 7', state: 'active' }] })
      .mockResolvedValueOnce({ issues: [MOCK_ISSUE, MOCK_DONE_ISSUE] });
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });
    expect(result.current.state.piProgressStats.totalIssues).toBe(2);
    expect(result.current.state.piProgressStats.doneCount).toBe(1);
    expect(result.current.state.piProgressStats.completionPercent).toBe(50);
  });

  it('sets activeTab to dependencies when setActiveTab("dependencies") is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.setActiveTab('dependencies'); });
    expect(result.current.state.activeTab).toBe('dependencies');
  });

  it('sets activeTab to boardprep when setActiveTab("boardprep") is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.setActiveTab('boardprep'); });
    expect(result.current.state.activeTab).toBe('boardprep');
  });

  // ── Overview parity: activeSprintName ──

  it('stores activeSprintName on the team after loading a Scrum board', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 42, name: 'Alpha Board', type: 'scrum' })
      .mockResolvedValueOnce({ values: [{ id: 7, name: 'Sprint 7', state: 'active' }] })
      .mockResolvedValueOnce({ issues: [MOCK_ISSUE] });

    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });

    expect(result.current.state.teams[0].activeSprintName).toBe('Sprint 7');
  });

  it('does not store activeSprintName for Kanban teams', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 467, name: 'SIS Board', type: 'kanban' })
      .mockResolvedValueOnce({ issues: [MOCK_ISSUE] });

    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('SIS', '467'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });

    expect(result.current.state.teams[0].activeSprintName).toBeUndefined();
  });

  // ── Shared foundation: expanded SPRINT_ISSUE_FIELDS ──

  it('requests shared fields (issuelinks, fixVersions, customfield_10021, labels) when loading a Scrum sprint', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 42, name: 'Alpha Board', type: 'scrum' })
      .mockResolvedValueOnce({ values: [{ id: 7, name: 'Sprint 7', state: 'active' }] })
      .mockResolvedValueOnce({ issues: [] });

    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });

    // The third call is the sprint issue fetch — verify the fields parameter includes all parity fields.
    const sprintIssueUrl = mockJiraGet.mock.calls[2][0] as string;
    expect(sprintIssueUrl).toContain('issuelinks');
    expect(sprintIssueUrl).toContain('fixVersions');
    expect(sprintIssueUrl).toContain('customfield_10021');
    expect(sprintIssueUrl).toContain('customfield_10301');
    expect(sprintIssueUrl).toContain('labels');
    expect(sprintIssueUrl).toContain('customfield_10028');
    expect(sprintIssueUrl).toContain('parent');
  });

  it('requests shared fields when loading a Kanban board', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ id: 467, name: 'SIS Board', type: 'kanban' })
      .mockResolvedValueOnce({ issues: [] });

    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('SIS', '467'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });

    const boardIssueUrl = mockJiraGet.mock.calls[1][0] as string;
    expect(boardIssueUrl).toContain('issuelinks');
    expect(boardIssueUrl).toContain('fixVersions');
  });

  // ── Shared foundation: loadBoardPrep story-point fallback ──

  it('loadBoardPrep uses customfield_10028 as story-point fallback when customfield_10016 is null', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [
        {
          id: 'ALPHA-20', key: 'ALPHA-20',
          fields: {
            summary: 'Story with alt story points',
            status: { name: 'To Do', statusCategory: { key: 'new' } },
            priority: null, assignee: null, reporter: null,
            issuetype: { name: 'Story', iconUrl: '' },
            created: '', updated: '', description: null,
            // Primary field absent; alternate field populated.
            customfield_10016: null,
            customfield_10028: 3,
          },
        },
      ],
    });

    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    await act(async () => { await result.current.actions.loadBoardPrep(); });

    expect(result.current.state.boardPrepIssues[0].estimate).toBe(3);
  });
});
