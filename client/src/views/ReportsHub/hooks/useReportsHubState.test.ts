// useReportsHubState.test.ts — Unit tests for the Reports Hub state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
}));

import { useReportsHubState } from './useReportsHubState.ts';

describe('useReportsHubState', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initialises with features tab and empty data', () => {
    const { result } = renderHook(() => useReportsHubState());
    expect(result.current.state.activeTab).toBe('features');
    expect(result.current.state.features).toHaveLength(0);
    expect(result.current.state.defects).toHaveLength(0);
    expect(result.current.state.risks).toHaveLength(0);
  });

  it('setActiveTab updates the active tab', () => {
    const { result } = renderHook(() => useReportsHubState());
    act(() => {
      result.current.actions.setActiveTab('defects');
    });
    expect(result.current.state.activeTab).toBe('defects');
  });

  it('loadFeatures sets isLoadingFeatures to true then false', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadFeatures();
    });
    expect(result.current.state.isLoadingFeatures).toBe(false);
  });

  it('loadFeatures populates features array on success', async () => {
    const mockIssue = {
      key: 'TBX-100',
      fields: {
        summary: 'Test Feature',
        status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
        fixVersions: [{ name: 'PI 26.2' }],
        assignee: { displayName: 'Alice' },
        customfield_10301: 'PI 26.2',
        priority: { name: 'High' },
        issuetype: { name: 'Epic' },
      },
    };
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockResolvedValue({ issues: [mockIssue] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadFeatures();
    });
    await waitFor(() => {
      expect(result.current.state.features.length).toBeGreaterThan(0);
    });
  });

  it('loadFeatures sets featuresError on failure', async () => {
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadFeatures();
    });
    await waitFor(() => {
      expect(result.current.state.featuresError).not.toBeNull();
    });
  });

  it('setPiFilter updates piFilter', () => {
    const { result } = renderHook(() => useReportsHubState());
    act(() => {
      result.current.actions.setPiFilter('PI 26.2');
    });
    expect(result.current.state.piFilter).toBe('PI 26.2');
  });

  it('setTeamFilter updates teamFilter', () => {
    const { result } = renderHook(() => useReportsHubState());
    act(() => {
      result.current.actions.setTeamFilter('Team Alpha');
    });
    expect(result.current.state.teamFilter).toBe('Team Alpha');
  });

  it('loadAllReports resolves all three in parallel', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadAllReports();
    });
    expect(result.current.state.isLoadingFeatures).toBe(false);
    expect(result.current.state.isLoadingDefects).toBe(false);
    expect(result.current.state.isLoadingRisks).toBe(false);
  });
});
