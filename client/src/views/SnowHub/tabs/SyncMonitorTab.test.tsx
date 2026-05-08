// SyncMonitorTab.test.tsx — Unit tests for the PRB Sync Monitor tab UI.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSyncState, mockSyncActions } = vi.hoisted(() => ({
  mockSyncState: {
    isRunning: false,
    logEntries: [] as Array<{
      timestamp: string;
      type: 'info' | 'status' | 'comment' | 'error';
      jiraKey: string;
      prbNumber: string;
      detail: string;
    }>,
    settings: {
      jqlTemplate: 'issuetype = Problem AND status changed AFTER -{interval}h',
      intervalMin: 15,
      workNotePrefix: '[Jira Sync]',
      shouldSyncComments: true,
      lastCheckTime: null as string | null,
    },
    statusMap: {} as Record<string, string>,
    jiraStatuses: [] as string[],
    isFetchingStatuses: false,
    nextRunAt: null as number | null,
    trackedIssueCount: 0,
  },
  mockSyncActions: {
    startSync: vi.fn(),
    stopSync: vi.fn(),
    runNow: vi.fn().mockResolvedValue(undefined),
    clearLog: vi.fn(),
    updateSettings: vi.fn(),
    saveSettings: vi.fn(),
    fetchJiraStatuses: vi.fn().mockResolvedValue(undefined),
    saveStatusMappings: vi.fn(),
    exportPs1: vi.fn(),
  },
}));

vi.mock('../hooks/useSnowSyncEngine.ts', () => ({
  useSnowSyncEngine: () => ({ state: mockSyncState, actions: mockSyncActions }),
  SNOW_PROBLEM_STATES: {
    '101': 'New',
    '102': 'Assess',
    '103': 'Root Cause Analysis',
    '104': 'Fix in Progress',
    '106': 'Resolved',
    '107': 'Closed',
  },
}));

import SyncMonitorTab from './SyncMonitorTab.tsx';

function resetMockSyncState(): void {
  Object.assign(mockSyncState, {
    isRunning: false,
    logEntries: [],
    settings: {
      jqlTemplate: 'issuetype = Problem AND status changed AFTER -{interval}h',
      intervalMin: 15,
      workNotePrefix: '[Jira Sync]',
      shouldSyncComments: true,
      lastCheckTime: null,
    },
    statusMap: {},
    jiraStatuses: [],
    isFetchingStatuses: false,
    nextRunAt: null,
    trackedIssueCount: 0,
  });
}

describe('SyncMonitorTab', () => {
  beforeEach(() => {
    resetMockSyncState();
    Object.values(mockSyncActions).forEach((mockAction) => mockAction.mockReset());
    mockSyncActions.runNow.mockResolvedValue(undefined);
    mockSyncActions.fetchJiraStatuses.mockResolvedValue(undefined);
  });

  it('renders the Sync Monitor heading', () => {
    render(<SyncMonitorTab />);

    expect(screen.getByRole('heading', { name: 'PRB Sync Monitor' })).toBeInTheDocument();
  });

  it('shows Stopped badge when isRunning is false', () => {
    render(<SyncMonitorTab />);

    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('shows Running badge when isRunning is true', () => {
    mockSyncState.isRunning = true;
    render(<SyncMonitorTab />);

    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('clicking Start button calls startSync', async () => {
    const user = userEvent.setup();
    render(<SyncMonitorTab />);

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(mockSyncActions.startSync).toHaveBeenCalledTimes(1);
  });

  it('clicking Stop button calls stopSync when running', async () => {
    mockSyncState.isRunning = true;
    const user = userEvent.setup();
    render(<SyncMonitorTab />);

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(mockSyncActions.stopSync).toHaveBeenCalledTimes(1);
  });

  it('clicking Sync Now button calls runNow', async () => {
    const user = userEvent.setup();
    render(<SyncMonitorTab />);

    await user.click(screen.getByRole('button', { name: 'Sync Now' }));

    expect(mockSyncActions.runNow).toHaveBeenCalledTimes(1);
  });

  it('clicking Clear Log button calls clearLog', async () => {
    const user = userEvent.setup();
    render(<SyncMonitorTab />);

    await user.click(screen.getByRole('button', { name: 'Clear Log' }));

    expect(mockSyncActions.clearLog).toHaveBeenCalledTimes(1);
  });

  it('clicking Export PS1 button calls exportPs1', async () => {
    const user = userEvent.setup();
    render(<SyncMonitorTab />);

    await user.click(screen.getByRole('button', { name: 'Export PS1' }));

    expect(mockSyncActions.exportPs1).toHaveBeenCalledTimes(1);
  });

  it('shows the JQL template input with current value', () => {
    render(<SyncMonitorTab />);

    expect(
      screen.getByDisplayValue('issuetype = Problem AND status changed AFTER -{interval}h'),
    ).toBeInTheDocument();
  });

  it('shows status mapping table when jiraStatuses are populated', () => {
    mockSyncState.jiraStatuses = ['To Do', 'In Progress'];
    render(<SyncMonitorTab />);

    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('shows log entries in the activity log', () => {
    mockSyncState.logEntries = [
      {
        timestamp: '2026-05-01T10:00:00.000Z',
        type: 'info',
        jiraKey: 'PROJ-1',
        prbNumber: 'PRB0001234',
        detail: 'Now tracking PROJ-1 → PRB0001234',
      },
    ];
    render(<SyncMonitorTab />);

    expect(screen.getByText(/Now tracking PROJ-1/)).toBeInTheDocument();
  });

  it('shows empty state message when log is empty', () => {
    render(<SyncMonitorTab />);

    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });
});
