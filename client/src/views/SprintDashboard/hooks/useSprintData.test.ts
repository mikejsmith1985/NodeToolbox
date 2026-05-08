// useSprintData.test.ts — Unit tests for the Sprint Dashboard state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function createMockBoard(boardId: number, boardType: 'scrum' | 'kanban' = 'scrum') {
  return {
    id: boardId,
    name: `Board ${boardId}`,
    type: boardType,
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
const MOCK_KANBAN_BOARD = createMockBoard(99, 'kanban');
const MOCK_BOARD_INFO_SCRUM = { type: 'scrum', location: { projectKey: 'TBX' } };
const MOCK_BOARD_INFO_KANBAN = { type: 'kanban', location: { projectKey: 'TBX' } };
const MOCK_SPRINT = createMockSprint(7);
const MOCK_ISSUES = [
  createMockIssue('TBX-10', 'Wire up the backend'),
  createMockIssue('TBX-11', 'Polish the UI'),
];

describe('useSprintData', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initialises with empty projectKey and overview tab', () => {
    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.projectKey).toBe('');
    expect(result.current.state.activeTab).toBe('overview');
  });

  it('initialises with null boardId and null boardType', () => {
    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.boardId).toBeNull();
    expect(result.current.state.boardType).toBeNull();
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

  it('supports the embedded story pointing tab', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('pointing');
    });

    expect(result.current.state.activeTab).toBe('pointing');
  });

  // ── Scrum board loading ──

  it('loads sprint and issues after loadSprint resolves for a scrum board', async () => {
    // Call sequence: boards → board info → sprint → issues
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })       // boards list
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)           // board info (type detection)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })       // active sprint
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });        // sprint issues

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
      expect(result.current.state.boardType).toBe('scrum');
    });
  });

  it('saves the selected boardId to localStorage after loading', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());

    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadSprint(); });

    expect(localStorage.getItem('tbxSprintDashboardBoardId')).toBe('42');
  });

  it('uses a saved boardId from localStorage without re-fetching the board list', async () => {
    localStorage.setItem('tbxSprintDashboardBoardId', '42');
    // Only board info + sprint + issues — no boards list call.
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());
    await act(async () => { await result.current.actions.loadSprint(); });

    await waitFor(() => {
      expect(result.current.state.sprintIssues).toHaveLength(2);
      expect(result.current.state.boardId).toBe(42);
    });
    // Board list call (4th mock) should not have been used.
    expect(mockJiraGet).toHaveBeenCalledTimes(3);
  });

  // ── Kanban board loading ──

  it('loads board issues directly when the board is a kanban board', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_KANBAN_BOARD] })  // boards list
      .mockResolvedValueOnce(MOCK_BOARD_INFO_KANBAN)            // board info → kanban
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });          // board issues

    const { result } = renderHook(() => useSprintData());

    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadSprint(); });

    await waitFor(() => {
      expect(result.current.state.boardType).toBe('kanban');
      expect(result.current.state.sprintInfo).toBeNull();
      expect(result.current.state.sprintIssues).toHaveLength(2);
      expect(result.current.state.isLoadingSprint).toBe(false);
    });
  });

  // ── Board selection ──

  it('selectBoard saves boardId to localStorage and reloads the dashboard', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());
    await act(async () => { await result.current.actions.selectBoard(42); });

    await waitFor(() => {
      expect(result.current.state.boardId).toBe(42);
    });
    expect(localStorage.getItem('tbxSprintDashboardBoardId')).toBe('42');
  });

  // ── Available sprints ──

  it('loadAvailableSprints fetches and caches active+future sprints', async () => {
    const futureSprint = { ...MOCK_SPRINT, id: 8, state: 'future' as const };

    const { result } = renderHook(() => useSprintData());

    // Seed the boardId so loadAvailableSprints knows which board to query.
    act(() => {
      result.current.actions.setProjectKey('TBX');
    });
    localStorage.setItem('tbxSprintDashboardBoardId', '42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES })
      .mockResolvedValueOnce({ values: [MOCK_SPRINT, futureSprint] }); // availableSprints call

    await act(async () => { await result.current.actions.loadSprint(); });
    await act(async () => { await result.current.actions.loadAvailableSprints(); });

    await waitFor(() => {
      expect(result.current.state.availableSprints).toHaveLength(2);
    });
  });

  it('loadAvailableSprints is a no-op when availableSprints is already loaded', async () => {
    localStorage.setItem('tbxSprintDashboardBoardId', '42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES })
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] }); // first availableSprints fetch

    const { result } = renderHook(() => useSprintData());
    await act(async () => { await result.current.actions.loadSprint(); });
    await act(async () => { await result.current.actions.loadAvailableSprints(); });
    const callCountAfterFirst = mockJiraGet.mock.calls.length;

    // Calling again should not trigger another fetch.
    await act(async () => { await result.current.actions.loadAvailableSprints(); });
    expect(mockJiraGet).toHaveBeenCalledTimes(callCountAfterFirst);
  });

  // ── Move to sprint ──

  it('moveIssueToSprint removes the issue from sprintIssues on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);

    // Seed two issues in state by going through a successful load.
    localStorage.setItem('tbxSprintDashboardBoardId', '42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());
    await act(async () => { await result.current.actions.loadSprint(); });
    expect(result.current.state.sprintIssues).toHaveLength(2);

    await act(async () => { await result.current.actions.moveIssueToSprint('TBX-10', 8); });

    expect(result.current.state.sprintIssues).toHaveLength(1);
    expect(result.current.state.sprintIssues[0].key).toBe('TBX-11');
    vi.unstubAllGlobals();
  });

  it('moveIssueToSprint throws when the server returns a non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useSprintData());

    await expect(
      act(async () => {
        await result.current.actions.moveIssueToSprint('TBX-10', 8);
      }),
    ).rejects.toThrow('Move failed: 400');
    vi.unstubAllGlobals();
  });

  // ── Error handling ──

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

  // ── Timer ──

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

  it('accepts "metrics" as a valid activeTab value', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('metrics');
    });

    expect(result.current.state.activeTab).toBe('metrics');
  });

  it('accepts "pipeline" as a valid activeTab value', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('pipeline');
    });

    expect(result.current.state.activeTab).toBe('pipeline');
  });

  it('accepts "planning" as a valid activeTab value', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('planning');
    });

    expect(result.current.state.activeTab).toBe('planning');
  });

  it('accepts "releases" as a valid activeTab value', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('releases');
    });

    expect(result.current.state.activeTab).toBe('releases');
  });
});
