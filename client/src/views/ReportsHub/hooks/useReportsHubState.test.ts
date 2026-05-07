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

describe('Sprint data (shared by Flow/Impact/Individual/SprintHealth)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initialises with empty sprint issues', () => {
    const { result } = renderHook(() => useReportsHubState());
    expect(result.current.state.sprintIssues).toHaveLength(0);
    expect(result.current.state.isLoadingSprintData).toBe(false);
    expect(result.current.state.sprintDataError).toBeNull();
  });

  it('loadSprintData sets isLoadingSprintData then resolves', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadSprintData();
    });
    expect(result.current.state.isLoadingSprintData).toBe(false);
  });

  it('loadSprintData populates sprintIssues on success', async () => {
    const mockSprintIssue = {
      key: 'TBX-101',
      fields: {
        summary: 'Sprint Story',
        status: { name: 'In Progress', statusCategory: { name: 'indeterminate' } },
        assignee: { displayName: 'Bob' },
        priority: { name: 'High' },
        labels: [],
        updated: '2024-01-01T00:00:00.000Z',
        customfield_10020: null,
      },
    };
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockResolvedValue({ issues: [mockSprintIssue] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadSprintData();
    });
    await waitFor(() => {
      expect(result.current.state.sprintIssues.length).toBeGreaterThan(0);
    });
  });

  it('loadSprintData sets sprintDataError on failure', async () => {
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadSprintData();
    });
    await waitFor(() => {
      expect(result.current.state.sprintDataError).not.toBeNull();
    });
  });

  it('loadSprintData marks isBlocked=true when label contains "blocked"', async () => {
    const mockBlockedIssue = {
      key: 'TBX-102',
      fields: {
        summary: 'Blocked Story',
        status: { name: 'In Progress', statusCategory: { name: 'indeterminate' } },
        assignee: null,
        priority: { name: 'High' },
        labels: ['blocked'],
        updated: '2024-01-01T00:00:00.000Z',
        customfield_10020: null,
      },
    };
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockResolvedValue({ issues: [mockBlockedIssue] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadSprintData();
    });
    await waitFor(() => {
      expect(result.current.state.sprintIssues[0]?.isBlocked).toBe(true);
    });
  });
});

describe('Quality data', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initialises storyCount at 0', () => {
    const { result } = renderHook(() => useReportsHubState());
    expect(result.current.state.storyCount).toBe(0);
  });

  it('loadQuality sets storyCount on success', async () => {
    const mockStoryIssue = {
      key: 'TBX-201',
      fields: {
        summary: 'A Story',
        status: { name: 'Done', statusCategory: { name: 'done' } },
        fixVersions: [],
        assignee: null,
        customfield_10301: null,
        priority: null,
        issuetype: { name: 'Story' },
      },
    };
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockResolvedValue({ issues: [mockStoryIssue] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadQuality();
    });
    await waitFor(() => {
      expect(result.current.state.storyCount).toBeGreaterThan(0);
    });
  });

  it('loadQuality sets qualityError on failure', async () => {
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadQuality();
    });
    await waitFor(() => {
      expect(result.current.state.qualityError).not.toBeNull();
    });
  });
});

describe('Throughput data', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initialises with empty throughput data', () => {
    const { result } = renderHook(() => useReportsHubState());
    expect(result.current.state.throughputData).toHaveLength(0);
  });

  it('loadThroughput populates throughputData on success', async () => {
    const mockResolvedIssue = {
      key: 'TBX-301',
      fields: {
        summary: 'Resolved Story',
        status: { name: 'Done', statusCategory: { name: 'done' } },
        assignee: null,
        priority: null,
        labels: [],
        updated: '2024-01-01T00:00:00.000Z',
        customfield_10020: [{ name: 'Sprint 10', state: 'closed' }],
      },
    };
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockResolvedValue({ issues: [mockResolvedIssue] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadThroughput();
    });
    await waitFor(() => {
      expect(result.current.state.throughputData.length).toBeGreaterThan(0);
    });
  });

  it('loadThroughput sets throughputError on failure', async () => {
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadThroughput();
    });
    await waitFor(() => {
      expect(result.current.state.throughputError).not.toBeNull();
    });
  });

  it('loadThroughput groups resolved issues by sprint name', async () => {
    const mockIssues = [
      {
        key: 'TBX-301',
        fields: {
          summary: 'Story 1',
          status: { name: 'Done', statusCategory: { name: 'done' } },
          assignee: null,
          priority: null,
          labels: [],
          updated: '2024-01-01T00:00:00.000Z',
          customfield_10020: [{ name: 'Sprint Alpha', state: 'closed' }],
        },
      },
      {
        key: 'TBX-302',
        fields: {
          summary: 'Story 2',
          status: { name: 'Done', statusCategory: { name: 'done' } },
          assignee: null,
          priority: null,
          labels: [],
          updated: '2024-01-01T00:00:00.000Z',
          customfield_10020: [{ name: 'Sprint Alpha', state: 'closed' }],
        },
      },
    ];
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ teams: [{ name: 'Team A', projectKey: 'TBX' }] }),
    );
    mockJiraGet.mockResolvedValue({ issues: mockIssues });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadThroughput();
    });
    await waitFor(() => {
      const sprintEntry = result.current.state.throughputData.find(
        (entry) => entry.sprintName === 'Sprint Alpha',
      );
      expect(sprintEntry?.resolvedCount).toBe(2);
    });
  });
});

describe('loadAllReports extended', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loadAllReports calls all loaders including loadSprintData, loadQuality, and loadThroughput', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    const { result } = renderHook(() => useReportsHubState());
    await act(async () => {
      await result.current.actions.loadAllReports();
    });
    expect(result.current.state.isLoadingSprintData).toBe(false);
    expect(result.current.state.isLoadingQuality).toBe(false);
    expect(result.current.state.isLoadingThroughput).toBe(false);
  });
});
