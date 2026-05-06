// DevWorkspaceView.test.tsx — Unit tests for the Dev Workspace tabbed view component.

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'time' as 'time' | 'gitsync' | 'monitor' | 'settings',
    workLogTab: 'timers' as 'timers' | 'today' | 'history',
    gitSyncSubTab: 'sync' as 'sync' | 'manual' | 'hooks',
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
    lastSyncAt: null as string | null,
    manualPostInput: '',
    manualPostComment: '',
    manualPostResult: null as string | null,
    isManualPosting: false,
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setWorkLogTab: vi.fn(),
    setGitSyncSubTab: vi.fn(),
    setIssueSearchKey: vi.fn(),
    searchAndAddIssue: vi.fn().mockResolvedValue(undefined),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    tickAllRunningTimers: vi.fn(),
    removeTimer: vi.fn(),
    toggleSync: vi.fn(),
    appendSyncLog: vi.fn(),
    clearSyncLog: vi.fn(),
    setManualPostInput: vi.fn(),
    setManualPostComment: vi.fn(),
    postManualComment: vi.fn().mockResolvedValue(undefined),
    resetManualPost: vi.fn(),
    logWorkEntry: vi.fn(),
  },
}));

vi.mock('./hooks/useDevWorkspaceState.ts', () => ({
  useDevWorkspaceState: () => ({ state: mockState, actions: mockActions }),
}));

import DevWorkspaceView from './DevWorkspaceView.tsx';

describe('DevWorkspaceView', () => {
  beforeEach(() => {
    mockState.activeTab = 'time';
    mockState.workLogTab = 'timers';
    vi.clearAllMocks();
  });

  it('renders the 4 tab buttons', () => {
    render(<DevWorkspaceView />);
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
});
