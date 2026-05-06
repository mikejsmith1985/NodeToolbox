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
});
