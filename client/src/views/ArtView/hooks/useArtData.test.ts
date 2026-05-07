// useArtData.test.ts — Unit tests for the ART View data hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => { vi.clearAllMocks(); });

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

  it('sets persona when setPersona is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.setPersona('po'); });
    expect(result.current.state.persona).toBe('po');
  });

  it('adds a team when addTeam is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    expect(result.current.state.teams).toHaveLength(1);
    expect(result.current.state.teams[0].name).toBe('Alpha Team');
    expect(result.current.state.teams[0].boardId).toBe('42');
  });

  it('removes a team when removeTeam is called', () => {
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    act(() => { result.current.actions.removeTeam(teamId); });
    expect(result.current.state.teams).toHaveLength(0);
  });

  it('loads sprint issues for a team when loadTeam resolves', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [{ id: 7, name: 'Sprint 7', state: 'active' }] })
      .mockResolvedValueOnce({ issues: [MOCK_ISSUE] });
    const { result } = renderHook(() => useArtData());
    act(() => { result.current.actions.addTeam('Alpha Team', '42'); });
    const teamId = result.current.state.teams[0].id;
    await act(async () => { await result.current.actions.loadTeam(teamId); });
    expect(result.current.state.teams[0].sprintIssues).toHaveLength(1);
    expect(result.current.state.teams[0].loadError).toBeNull();
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
    mockJiraGet.mockResolvedValue({
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
});
