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
    }>,
    isLoadingMyChanges: false,
    myChangesError: null as string | null,
    activityLog: [] as Array<{
      timestamp: string;
      message: string;
      level: 'info' | 'success' | 'warning' | 'error';
    }>,
  },
  mockActions: {
    setChgNumber: vi.fn(),
    loadChg: vi.fn().mockResolvedValue(undefined),
    loadMyActiveChanges: vi.fn().mockResolvedValue(undefined),
    appendLogEntry: vi.fn(),
    clearLog: vi.fn(),
    clearLoadedChg: vi.fn(),
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
});
