// WorkLogView.test.tsx — Smoke tests for the Work Log view.

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useWorkLogState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useWorkLogState.ts')>(
    './hooks/useWorkLogState.ts',
  );
  return {
    ...actualModule,
    useWorkLogState: vi.fn(),
  };
});

import WorkLogView from './WorkLogView.tsx';
import {
  computeElapsedSecondsFor,
  formatDurationFromSeconds,
  parseFreeFormTimeText,
  useWorkLogState,
} from './hooks/useWorkLogState.ts';

const mockUseWorkLogState = vi.mocked(useWorkLogState);

function buildFakeHookState(
  overrides: Partial<ReturnType<typeof useWorkLogState>> = {},
): ReturnType<typeof useWorkLogState> {
  return {
    timers: [],
    history: [],
    searchKey: '',
    searchStatus: null,
    isPosting: false,
    postError: null,
    tickCounter: 0,
    setSearchKey: vi.fn(),
    addTimerByIssueKey: vi.fn(),
    startTimer: vi.fn(),
    pauseTimer: vi.fn(),
    removeTimer: vi.fn(),
    postWorkLog: vi.fn(),
    parseTimeInput: parseFreeFormTimeText,
    formatDuration: formatDurationFromSeconds,
    computeElapsedSeconds: computeElapsedSecondsFor,
    ...overrides,
  };
}

beforeEach(() => {
  mockUseWorkLogState.mockReset();
});

describe('WorkLogView', () => {
  it('renders the empty state when no timers exist', () => {
    mockUseWorkLogState.mockReturnValue(buildFakeHookState());
    render(<WorkLogView />);

    expect(screen.getByRole('heading', { name: 'Work Log' })).toBeInTheDocument();
    expect(screen.getByText('No active timers — add an issue key to start tracking.')).toBeInTheDocument();
  });

  it('renders a timer card with elapsed display and Start button when paused', () => {
    mockUseWorkLogState.mockReturnValue(
      buildFakeHookState({
        timers: [
          {
            issueKey: 'TBX-7',
            summary: 'Implement Work Log',
            status: '',
            issueType: '',
            isRunning: false,
            startedAtMs: null,
            accumulatedMilliseconds: 65_000,
          },
        ],
      }),
    );

    render(<WorkLogView />);

    expect(screen.getByText('TBX-7')).toBeInTheDocument();
    expect(screen.getByText('Implement Work Log')).toBeInTheDocument();
    expect(screen.getByLabelText('Elapsed time for TBX-7')).toHaveTextContent('1m 5s');
    expect(screen.getByRole('button', { name: '▶ Start' })).toBeInTheDocument();
  });

  it('calls addTimerByIssueKey when the Add Timer button is clicked', () => {
    const fakeState = buildFakeHookState();
    mockUseWorkLogState.mockReturnValue(fakeState);
    render(<WorkLogView />);

    fireEvent.click(screen.getByRole('button', { name: '➕ Add Timer' }));

    expect(fakeState.addTimerByIssueKey).toHaveBeenCalledTimes(1);
  });

  it('opens the post dialog when the Log button is clicked', () => {
    mockUseWorkLogState.mockReturnValue(
      buildFakeHookState({
        timers: [
          {
            issueKey: 'L-1',
            summary: 'Log me',
            status: '',
            issueType: '',
            isRunning: false,
            startedAtMs: null,
            accumulatedMilliseconds: 120_000,
          },
        ],
      }),
    );
    render(<WorkLogView />);

    fireEvent.click(screen.getByRole('button', { name: '📝 Log' }));

    expect(screen.getByRole('dialog', { name: 'Log work' })).toBeInTheDocument();
    expect(screen.getByLabelText('Worklog duration')).toHaveValue('2m 0s');
  });
});
