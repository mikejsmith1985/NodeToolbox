// DevWorkspaceView.test.tsx — Unit tests for the Dev Workspace tabbed view component.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'hygiene' as 'hygiene' | 'time' | 'gitsync' | 'monitor' | 'settings',
    workLogTab: 'timers' as 'timers' | 'today' | 'history',
    issueTimers: [
      {
        issueKey: 'TBX-1',
        issueSummary: 'Test issue one',
        isRunning: false,
        elapsedSeconds: 120,
        sessionStartedAt: null as number | null,
      },
    ],
    workLogEntries: [],
    issueSearchKey: '',
    isSearchingIssue: false,
    issueSearchError: null as string | null,
    isSyncRunning: false,
    syncLog: [] as string[],
    monitorLog: [] as string[],
    lastSyncAt: null as string | null,
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setWorkLogTab: vi.fn(),
    setIssueSearchKey: vi.fn(),
    searchAndAddIssue: vi.fn().mockResolvedValue(undefined),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    tickAllRunningTimers: vi.fn(),
    removeTimer: vi.fn(),
    toggleSync: vi.fn(),
    appendSyncLog: vi.fn(),
    clearSyncLog: vi.fn(),
    appendMonitorLog: vi.fn(),
    clearMonitorLog: vi.fn(),
    logWorkEntry: vi.fn(),
  },
}));

const {
  mockFetchSchedulerConfig,
  mockFetchSchedulerResults,
  mockFetchSchedulerStatus,
  mockRunSchedulerNow,
  mockUpdateSchedulerConfig,
} = vi.hoisted(() => ({
  mockFetchSchedulerConfig: vi.fn(),
  mockFetchSchedulerResults: vi.fn(),
  mockFetchSchedulerStatus: vi.fn(),
  mockRunSchedulerNow: vi.fn(),
  mockUpdateSchedulerConfig: vi.fn(),
}));

vi.mock('./hooks/useDevWorkspaceState.ts', () => ({
  useDevWorkspaceState: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('../../services/schedulerApi.ts', () => ({
  fetchSchedulerConfig: mockFetchSchedulerConfig,
  fetchSchedulerResults: mockFetchSchedulerResults,
  fetchSchedulerStatus: mockFetchSchedulerStatus,
  runSchedulerNow: mockRunSchedulerNow,
  updateSchedulerConfig: mockUpdateSchedulerConfig,
}));

import DevWorkspaceView from './DevWorkspaceView.tsx';

describe('DevWorkspaceView', () => {
  beforeEach(() => {
    mockState.activeTab = 'time';
    mockState.workLogTab = 'timers';
    let currentSchedulerConfig = {
      repoMonitor: {
        enabled: true,
        repos: [] as string[],
        branchPattern: '^main$',
        intervalMin: 5,
        transitions: {
          branchCreated: '',
          commitPushed: '',
          prOpened: '',
          prMerged: '',
        },
      },
    };
    mockFetchSchedulerConfig.mockImplementation(async () => currentSchedulerConfig);
    mockFetchSchedulerStatus.mockResolvedValue({
      repoMonitor: {
        enabled: true,
        repos: [],
        intervalMin: 5,
        lastRunAt: null,
        nextRunAt: null,
        eventCount: 0,
      },
    });
    mockFetchSchedulerResults.mockResolvedValue({
      repoMonitor: { lastRunAt: null, nextRunAt: null, eventCount: 0, events: [] },
    });
    mockRunSchedulerNow.mockResolvedValue(undefined);
    mockUpdateSchedulerConfig.mockImplementation(async (nextSchedulerConfig: typeof currentSchedulerConfig) => {
      currentSchedulerConfig = nextSchedulerConfig;
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the 5 tab buttons', () => {
    render(<DevWorkspaceView />);
    expect(screen.getByRole('tab', { name: /hygiene/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /time tracking/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /git sync/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /repo monitor/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows the issue key input and Add Issue button on Time Tracking tab', () => {
    render(<DevWorkspaceView />);
    expect(screen.getByPlaceholderText(/issue key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add issue/i })).toBeInTheDocument();
  });

  it('shows the Git Sync tab content when Git Sync tab is clicked', () => {
    render(<DevWorkspaceView />);
    fireEvent.click(screen.getByRole('tab', { name: /git sync/i }));
    expect(mockActions.setActiveTab).toHaveBeenCalledWith('gitsync');
  });

  it('renders timer cards when issueTimers are present', () => {
    render(<DevWorkspaceView />);
    expect(screen.getByText('TBX-1')).toBeInTheDocument();
    expect(screen.getByText('Test issue one')).toBeInTheDocument();
  });

  it('shows the work log today entries when Today sub-tab is active', () => {
    mockState.workLogTab = 'today';
    render(<DevWorkspaceView />);
    expect(screen.getByRole('tab', { name: /today/i })).toBeInTheDocument();
  });

  it('shows monitor add controls in Settings tab for repo URLs', () => {
    mockState.activeTab = 'settings';
    render(<DevWorkspaceView />);

    expect(
      screen.getByLabelText(/primary sync repository \(owner\/repo or github url\)/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to monitor list/i })).toBeInTheDocument();
  });

  it('persists monitored repos when adding from the primary sync repository field', async () => {
    mockState.activeTab = 'settings';
    render(<DevWorkspaceView />);

    const primaryRepositoryInput = await screen.findByLabelText(
      /primary sync repository \(owner\/repo or github url\)/i,
    );
    fireEvent.change(primaryRepositoryInput, {
      target: { value: 'https://github.com/mikejsmith1985/NodeToolbox' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add to monitor list/i }));

    await waitFor(() => {
      expect(mockUpdateSchedulerConfig).toHaveBeenCalledWith({
        repoMonitor: expect.objectContaining({
          repos: expect.arrayContaining(['mikejsmith1985/NodeToolbox']),
        }),
      });
    });
  });
});

