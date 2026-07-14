// useSprintData.test.ts — Unit tests for the Sprint Dashboard state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockFetchPiNameSuggestions } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockFetchPiNameSuggestions: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

// Mocked at the module boundary so PI-suggestion lookups don't add jiraGet calls to the ordered
// mock sequences below; the dedicated test overrides its return value.
vi.mock('../../../services/piNameSuggestions.ts', () => ({
  fetchPiNameSuggestions: mockFetchPiNameSuggestions,
}));

import { useSprintData } from './useSprintData.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { useSettingsStore } from '../../../store/settingsStore.ts';

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
    mockFetchPiNameSuggestions.mockReset();
    mockFetchPiNameSuggestions.mockResolvedValue([]);
    localStorage.clear();
    useSettingsStore.setState({
      dsuProjectKey: '',
      sprintDashboardProjectKey: '',
      sprintDashboardBoardId: '',
      sprintDashboardActiveTab: 'overview',
      sprintDashboardScopeMode: 'sprint',
      sprintDashboardSelectedSprintId: '',
      sprintDashboardSelectedFixVersion: '',
      sprintDashboardSelectedPiValue: '',
      sprintDashboardActiveTeam: '',
    });
    useConnectionStore.setState({
      isJiraReady: false,
      isSnowReady: false,
      isJiraVerified: false,
      isSnowVerified: false,
      isConfluenceReady: false,
      isGitHubReady: false,
      proxyStatus: null,
      relayBridgeStatus: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.setState({
      dsuProjectKey: '',
      sprintDashboardProjectKey: '',
      sprintDashboardBoardId: '',
      sprintDashboardActiveTab: 'overview',
      sprintDashboardScopeMode: 'sprint',
      sprintDashboardSelectedSprintId: '',
      sprintDashboardSelectedFixVersion: '',
      sprintDashboardSelectedPiValue: '',
      sprintDashboardActiveTeam: '',
    });
    useConnectionStore.setState({
      isJiraReady: false,
      isSnowReady: false,
      isJiraVerified: false,
      isSnowVerified: false,
      isConfluenceReady: false,
      isGitHubReady: false,
      proxyStatus: null,
      relayBridgeStatus: null,
    });
  });

  it('initialises with empty projectKey and settings tab while setup is incomplete', () => {
    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.projectKey).toBe('');
    expect(result.current.state.activeTab).toBe('settings');
    expect(result.current.state.scopeMode).toBe('sprint');
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
    expect(localStorage.getItem('tbxSprintDashboardProjectKey')).toBe('TBX');
    expect(useSettingsStore.getState().dsuProjectKey).toBe('TBX');
  });

  it('sets activeTab when setActiveTab is called', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('blockers');
    });

    expect(result.current.state.activeTab).toBe('blockers');
    expect(localStorage.getItem('tbxSprintDashboardActiveTab')).toBe('blockers');
  });

  it('opens Settings by default until project, board, and Jira readiness are in place', () => {
    useSettingsStore.getState().setSprintDashboardProjectKey('ENFCT');
    useSettingsStore.getState().setSprintDashboardActiveTab('standup');
    useSettingsStore.getState().setSprintDashboardScopeMode('pi');
    useSettingsStore.getState().setSprintDashboardSelectedSprintId('13');
    useSettingsStore.getState().setSprintDashboardSelectedFixVersion('Release 24.1');
    useSettingsStore.getState().setSprintDashboardSelectedPiValue('PI-24.1');

    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.projectKey).toBe('ENFCT');
    expect(result.current.state.activeTab).toBe('settings');
    expect(result.current.state.scopeMode).toBe('pi');
    expect(result.current.state.selectedSprintId).toBe(13);
    expect(result.current.state.selectedFixVersionName).toBe('Release 24.1');
    expect(result.current.state.selectedPiValue).toBe('PI-24.1');
  });

  it('opens Overview by default once project, board, and Jira readiness are all configured', () => {
    useSettingsStore.getState().setSprintDashboardProjectKey('ENFCT');
    useSettingsStore.getState().setSprintDashboardBoardId('42');
    useSettingsStore.getState().setSprintDashboardActiveTab('standup');
    useConnectionStore.setState({ isJiraReady: true });

    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.projectKey).toBe('ENFCT');
    expect(result.current.state.boardId).toBe(42);
    expect(result.current.state.activeTab).toBe('overview');
  });

  it('falls back to the DSU project key when Sprint Dashboard has not saved its own project yet', () => {
    useSettingsStore.getState().setDsuProjectKey('TBX');

    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.projectKey).toBe('TBX');
  });

  it('supports the embedded story pointing tab', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('pointing');
    });

    expect(result.current.state.activeTab).toBe('pointing');
  });

  it('supports the Team Dashboard feature review tab', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('featurereview');
    });

    expect(result.current.state.activeTab).toBe('featurereview');
    expect(localStorage.getItem('tbxSprintDashboardActiveTab')).toBe('featurereview');
  });

  it('supports the Team Dashboard hygiene tab', () => {
    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setActiveTab('hygiene');
    });

    expect(result.current.state.activeTab).toBe('hygiene');
    expect(localStorage.getItem('tbxSprintDashboardActiveTab')).toBe('hygiene');
  });

  it('falls back to Settings when the stored active tab still points at the removed roster tab', () => {
    useSettingsStore.getState().setSprintDashboardActiveTab('roster');

    const { result } = renderHook(() => useSprintData());

    expect(result.current.state.activeTab).toBe('settings');
  });

  // ── Scrum board loading ──

  it('loads sprint and issues after loadSprint resolves for a scrum board', async () => {
    // Call sequence: boards → board info → versions → PI values → sprint list → issues
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })       // boards list
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)           // board info (type detection)
      .mockResolvedValueOnce([])                              // project versions
      .mockResolvedValueOnce({ issues: [] })                  // PI values
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })       // board scope sprints
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
      expect(result.current.state.selectedSprintId).toBe(7);
      expect(result.current.state.selectedBoardName).toBe('Board 42');
    });
  });

  it('narrows available PI values to the planning window and includes field-only future PIs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1)); // 2026-06-01: PI 26.3 is the current increment

    const piIssue = (piName: string) => ({
      id: piName,
      key: piName,
      fields: { ...createMockIssue(piName, piName).fields, customfield_10301: piName },
    });

    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })   // boards list
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)       // board info
      .mockResolvedValueOnce([])                          // project versions
      .mockResolvedValueOnce({ issues: [                  // PI values found on issues
        piIssue('PI 25.6 (11/20/25 - 01/28/26)'),
        piIssue('PI 26.2 (02/26/26 - 04/29/26)'),
        piIssue('PI 26.3 (05/21/26 - 07/29/26)'),
      ] })
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })   // board scope sprints
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });    // sprint issues

    // The PI field also offers a future PI that no issue references yet.
    mockFetchPiNameSuggestions.mockResolvedValue([
      'PI 26.3 (05/21/26 - 07/29/26)',
      'PI 26.4 (08/13/26 - 10/28/26)',
    ]);

    const { result } = renderHook(() => useSprintData());
    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadSprint(); });

    const { availablePiValues } = result.current.state;
    expect(availablePiValues).toContain('PI 26.3 (05/21/26 - 07/29/26)'); // current
    expect(availablePiValues).toContain('PI 26.4 (08/13/26 - 10/28/26)'); // future (field-only)
    expect(availablePiValues).toContain('PI 26.2 (02/26/26 - 04/29/26)'); // one prior kept
    expect(availablePiValues).not.toContain('PI 25.6 (11/20/25 - 01/28/26)'); // older dropped

    vi.useRealTimers();
  });

  it('saves the selected boardId to localStorage after loading', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());

    act(() => { result.current.actions.setProjectKey('TBX'); });
    await act(async () => { await result.current.actions.loadSprint(); });

    expect(localStorage.getItem('tbxSprintDashboardBoardId')).toBe('42');
  });

  it('uses a saved boardId from localStorage without re-fetching the board list', async () => {
    useSettingsStore.getState().setSprintDashboardBoardId('42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());
    await act(async () => { await result.current.actions.loadSprint(); });

    await waitFor(() => {
      expect(result.current.state.sprintIssues).toHaveLength(2);
      expect(result.current.state.boardId).toBe(42);
      expect(result.current.state.availableBoards).toEqual([MOCK_BOARD]);
    });
    expect(mockJiraGet).toHaveBeenCalledTimes(6);
  });

  it('backfills the project key from board metadata when loading a saved board', async () => {
    useSettingsStore.getState().setSprintDashboardBoardId('42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ values: [MOCK_SPRINT] })
      .mockResolvedValueOnce({ issues: MOCK_ISSUES });

    const { result } = renderHook(() => useSprintData());

    await act(async () => {
      await result.current.actions.loadSprint();
    });

    await waitFor(() => {
      expect(result.current.state.projectKey).toBe('TBX');
    });
    expect(localStorage.getItem('tbxSprintDashboardProjectKey')).toBe('TBX');
    expect(useSettingsStore.getState().dsuProjectKey).toBe('TBX');
  });

  it('clears the saved board when the project changes so the next load uses the new project boards', () => {
    useSettingsStore.getState().setSprintDashboardProjectKey('TBX');
    useSettingsStore.getState().setSprintDashboardBoardId('42');

    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setProjectKey('ENFCT');
    });

    expect(result.current.state.projectKey).toBe('ENFCT');
    expect(result.current.state.boardId).toBeNull();
    expect(useSettingsStore.getState().sprintDashboardBoardId).toBe('');
  });

  // ── Kanban board loading ──

  it('loads board issues directly when the board is a kanban board', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_KANBAN_BOARD] })  // boards list
      .mockResolvedValueOnce(MOCK_BOARD_INFO_KANBAN)            // board info → kanban
      .mockResolvedValueOnce([])                                // project versions
      .mockResolvedValueOnce({ issues: [] })                    // PI values
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

  it('explains how to recover when a scrum board has no active sprint', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ values: [] });

    const { result } = renderHook(() => useSprintData());

    act(() => {
      result.current.actions.setProjectKey('TBX');
    });

    await act(async () => {
      await result.current.actions.loadSprint();
    });

    await waitFor(() => {
      expect(result.current.state.loadError).toBe(
        'No active sprint found on this board. Try selecting a different scrum board in Settings, or switch to a kanban board.',
      );
      expect(result.current.state.isLoadingSprint).toBe(false);
    });
  });

  // ── Board selection ──

  it('selectBoard saves boardId to localStorage and reloads the dashboard', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
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
    useSettingsStore.getState().setSprintDashboardBoardId('42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
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
    useSettingsStore.getState().setSprintDashboardBoardId('42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
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
    useSettingsStore.getState().setSprintDashboardBoardId('42');
    mockJiraGet
      .mockResolvedValueOnce(MOCK_BOARD_INFO_SCRUM)
      .mockResolvedValueOnce({ values: [MOCK_BOARD] })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ issues: [] })
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

  describe('unsaved team-change tracking', () => {
    it('starts with no unsaved team changes', () => {
      const { result } = renderHook(() => useSprintData());

      expect(result.current.state.hasUnsavedTeamChanges).toBe(false);
    });

    it('flags unsaved changes when the user edits the project key', () => {
      const { result } = renderHook(() => useSprintData());

      act(() => {
        result.current.actions.setProjectKey('TBX');
      });

      expect(result.current.state.hasUnsavedTeamChanges).toBe(true);
    });

    it('does NOT flag unsaved changes merely from switching tabs', () => {
      const { result } = renderHook(() => useSprintData());

      act(() => {
        result.current.actions.setActiveTab('blockers');
      });

      expect(result.current.state.hasUnsavedTeamChanges).toBe(false);
    });

    it('does NOT flag unsaved changes when picking a PI/sprint to view (a view choice, not team config)', async () => {
      mockJiraGet.mockResolvedValue({ issues: [], values: [] });
      const { result } = renderHook(() => useSprintData());

      // Choosing which PI to look at must not read as an edit to the team's saved configuration.
      await act(async () => {
        await result.current.actions.selectPiScope('PI 26.4 (08/13/26 - 10/28/26)');
      });
      expect(result.current.state.hasUnsavedTeamChanges).toBe(false);

      await act(async () => {
        await result.current.actions.setScopeMode('sprint');
      });
      expect(result.current.state.hasUnsavedTeamChanges).toBe(false);
    });

    it('clears the flag when markTeamChangesSaved is called', () => {
      const { result } = renderHook(() => useSprintData());

      act(() => {
        result.current.actions.setProjectKey('TBX');
      });
      expect(result.current.state.hasUnsavedTeamChanges).toBe(true);

      act(() => {
        result.current.actions.markTeamChangesSaved();
      });
      expect(result.current.state.hasUnsavedTeamChanges).toBe(false);
    });

    it('re-hydrates and clears the flag when the hydration nonce changes (Revert)', () => {
      const { result, rerender } = renderHook(
        ({ nonce }) => useSprintData('team-a', '', nonce),
        { initialProps: { nonce: 0 } },
      );

      act(() => {
        result.current.actions.setProjectKey('TBX');
      });
      expect(result.current.state.hasUnsavedTeamChanges).toBe(true);

      // A revert bumps the nonce; the hook must reset its working state.
      rerender({ nonce: 1 });
      expect(result.current.state.hasUnsavedTeamChanges).toBe(false);
    });
  });
});
