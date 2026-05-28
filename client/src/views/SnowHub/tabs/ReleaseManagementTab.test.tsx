// ReleaseManagementTab.test.tsx — Unit tests for the ServiceNow release management tab.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    chgNumber: '',
    loadedChg: null as {
      sysId: string;
      number: string;
      shortDescription: string;
      state: string;
      assignedTo: { sysId: string; name: string; email: string } | null;
      plannedStartDate: string;
      plannedEndDate: string;
      risk: string;
      impact: string;
    } | null,
    isLoadingChg: false,
    loadError: null as string | null,
    myActiveChanges: [] as Array<{
      sysId: string;
      number: string;
      shortDescription: string;
      state: string;
      plannedStartDate: string;
      plannedEndDate: string;
      alertSeverity: 'healthy' | 'warning' | 'error';
      alertMessage: string | null;
    }>,
    isLoadingMyChanges: false,
    myChangesError: null as string | null,
    activityLog: [] as Array<{
      timestamp: string;
      message: string;
      level: 'info' | 'success' | 'warning' | 'error';
    }>,
    monitorSettings: {
      shouldAlertOnPlannedStartMiss: true,
      shouldAlertOnPlannedEndMiss: true,
    },
  },
  mockActions: {
    setChgNumber: vi.fn(),
    loadChg: vi.fn().mockResolvedValue(undefined),
    loadMyActiveChanges: vi.fn().mockResolvedValue(undefined),
    appendLogEntry: vi.fn(),
    clearLog: vi.fn(),
    clearLoadedChg: vi.fn(),
    setMonitorSetting: vi.fn(),
  },
}));

vi.mock('../hooks/useReleaseManagement.ts', () => ({
  useReleaseManagement: () => ({ state: mockState, actions: mockActions }),
}));

import ReleaseManagementTab from './ReleaseManagementTab.tsx';

function resetMockState(): void {
  Object.assign(mockState, {
    chgNumber: '',
    loadedChg: null,
    isLoadingChg: false,
    loadError: null,
    myActiveChanges: [],
    isLoadingMyChanges: false,
    myChangesError: null,
    activityLog: [],
    monitorSettings: {
      shouldAlertOnPlannedStartMiss: true,
      shouldAlertOnPlannedEndMiss: true,
    },
  });
}

describe('ReleaseManagementTab', () => {
  beforeEach(() => {
    resetMockState();
    Object.values(mockActions).forEach((mockAction) => mockAction.mockReset());
    mockActions.loadChg.mockResolvedValue(undefined);
    mockActions.loadMyActiveChanges.mockResolvedValue(undefined);
  });

  it('calls loadMyActiveChanges on mount', () => {
    render(<ReleaseManagementTab />);

    expect(mockActions.loadMyActiveChanges).toHaveBeenCalledTimes(1);
  });

  it('refreshes active changes when Refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<ReleaseManagementTab />);
    mockActions.loadMyActiveChanges.mockClear();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(mockActions.loadMyActiveChanges).toHaveBeenCalledTimes(1);
  });

  it('renders the CHG number input', () => {
    render(<ReleaseManagementTab />);

    expect(screen.getByLabelText('CHG Number')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Change' })).toBeInTheDocument();
  });

  it('shows the CHG details card when loadedChg is present', () => {
    mockState.loadedChg = {
      sysId: 'change-1',
      number: 'CHG0001234',
      shortDescription: 'Release the payment patch',
      state: 'Implement',
      assignedTo: { sysId: 'user-1', name: 'Casey Engineer', email: 'casey@example.com' },
      plannedStartDate: '2026-05-01 10:00:00',
      plannedEndDate: '2026-05-01 12:00:00',
      risk: 'Moderate',
      impact: 'Medium',
    };

    render(<ReleaseManagementTab />);

    expect(screen.getByText('CHG0001234')).toBeInTheDocument();
    expect(screen.getByText('Release the payment patch')).toBeInTheDocument();
    expect(screen.getByText('Casey Engineer')).toBeInTheDocument();
  });

  it('shows activity log entries when the activity log is non-empty', () => {
    mockState.activityLog = [
      { timestamp: '2026-05-01T10:00:00.000Z', message: 'Loaded change CHG0001234.', level: 'success' },
    ];

    render(<ReleaseManagementTab />);

    expect(screen.getByText('Loaded change CHG0001234.')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('calls clearLog when the Clear Log button is clicked', async () => {
    const user = userEvent.setup();
    mockState.activityLog = [
      { timestamp: '2026-05-01T10:00:00.000Z', message: 'Loaded change CHG0001234.', level: 'success' },
    ];

    render(<ReleaseManagementTab />);

    await user.click(screen.getByRole('button', { name: 'Clear Log' }));

    expect(mockActions.clearLog).toHaveBeenCalledTimes(1);
  });

  it('updates monitor setting when planned-start checkbox is toggled', async () => {
    const user = userEvent.setup();
    render(<ReleaseManagementTab />);

    await user.click(screen.getByRole('checkbox', { name: 'Alert when planned start is missed and work has not started' }));

    expect(mockActions.setMonitorSetting).toHaveBeenCalledWith('shouldAlertOnPlannedStartMiss', false);
  });

  it('shows the active changes summary table when change summaries are present', () => {
    mockState.myActiveChanges = [
      {
        sysId: 'change-1',
        number: 'CHG0001234',
        shortDescription: 'Release the payment patch',
        state: 'Scheduled',
        plannedStartDate: '2026-05-01 10:00:00',
        plannedEndDate: '2026-05-01 12:00:00',
        alertSeverity: 'warning',
        alertMessage: 'Planned start has passed and this change has not started.',
      },
    ];

    render(<ReleaseManagementTab />);

    expect(screen.getByRole('columnheader', { name: 'Number' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Short Description' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'State' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Planned Start' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Planned End' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Alert' })).toBeInTheDocument();
    expect(screen.getByText('CHG0001234')).toBeInTheDocument();
    expect(screen.getByText('Release the payment patch')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });
});
