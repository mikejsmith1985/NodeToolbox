// useSprintData.test.ts — Unit tests for the Sprint Dashboard state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import { useSprintData } from './useSprintData.ts';

function createMockSprint(sprintId: number) {
  return {
    id: sprintId,
    name: `Sprint ${sprintId}`,
    state: 'active' as const,
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-14T00:00:00.000Z',
  };
}

function createMockBoard(boardId: number) {
  return {
    id: boardId,
    name: `Board ${boardId}`,
    type: 'scrum' as const,
    projectKey: 'TBX',
  };
}

function createMockIssue(issueKey: string, summary: string) {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium', iconUrl: 'priority.png' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
    },
  };
}

const MOCK_BOARD = createMockBoard(42);
const MOCK_SPRINT = createMockSprint(7);
const MOCK_ISSUES = [
  createMockIssue('TBX-10', 'Wire up the backend'),
  createMockIssue('TBX-11', 'Polish the UI'),
];

describe('useSprintData', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('initialises with empty projectKey and overview tab', () => {
    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.projectKey).toBe('');
    expect(result.current.state.activeTab).toBe('overview');
  });

  it('sets projectKey when setProjectKey is called', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setProjectKey('TBX');
    });

    expect(result.current.state.projectKey).toBe('TBX');
  });

  it('sets activeTab when setActiveTab is called', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('blockers');
    });

    expect(result.current.state.activeTab).toBe('blockers');
  });

  it('loads sprint and issues after loadSprint resolves', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })   // boards call
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })  // sprint call
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });   // issues call

    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setProjectKey('TBX');
    });

    await act(async () => {
      await result.current.actions.loadSprint();
    });

    await waitFor(() => {
      expect(result.current.state.sprintIssues).toHaveLength(2);
      expect(result.current.state.sprintInfo).not.toBeNull();
      expect(result.current.state.isLoadingSprint).toBe(false);
    });
  });

  it('sets loadError when loadSprint rejects', async () => {
    mockJiraGet.mockRejectedValue(new Error('Sprint fetch failed'));
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setProjectKey('TBX');
    });

    await act(async () => {
      await result.current.actions.loadSprint();
    });

    await waitFor(() => {
      expect(result.current.state.loadError).toBe('Sprint fetch failed');
      expect(result.current.state.isLoadingSprint).toBe(false);
    });
  });

  it('decrements timerSecondsRemaining when tickTimer is called', () => {
    const { result } = renderHook(() => useSprintData());

    const initialSeconds = result.current.state.timerSecondsRemaining;

    act(() => {
      result.current.actions.tickTimer();
    });

    expect(result.current.state.timerSecondsRemaining).toBe(initialSeconds - 1);
  });

  it('resets timer to STANDUP_TIMER_SECONDS when resetTimer is called', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.tickTimer();
      result.current.actions.tickTimer();
      result.current.actions.resetTimer();
    });

    // 900 is the STANDUP_TIMER_SECONDS constant
    expect(result.current.state.timerSecondsRemaining).toBe(900);
  });

  it('sets isTimerRunning=true on startTimer and false on stopTimer', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.startTimer();
    });

    expect(result.current.state.isTimerRunning).toBe(true);

    act(() => {
      result.current.actions.stopTimer();
    });

    expect(result.current.state.isTimerRunning).toBe(false);
  });
});
