// StandupBoardView.test.tsx — Render and interaction tests for the standalone Standup Board view.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StandupIssue } from './utils/boardStats.ts';

vi.mock('./hooks/useStandupBoardState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useStandupBoardState.ts')>('./hooks/useStandupBoardState.ts');
  return {
    ...actualModule,
    useStandupBoardState: vi.fn(),
  };
});

vi.mock('./hooks/useStandupTimer.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useStandupTimer.ts')>('./hooks/useStandupTimer.ts');
  return {
    ...actualModule,
    useStandupTimer: vi.fn(),
  };
});

import StandupBoardView from './StandupBoardView.tsx';
import { useStandupBoardState } from './hooks/useStandupBoardState.ts';
import { STANDUP_TIMER_TOTAL_SECONDS, useStandupTimer } from './hooks/useStandupTimer.ts';

const mockUseStandupBoardState = vi.mocked(useStandupBoardState);
const mockUseStandupTimer = vi.mocked(useStandupTimer);

function buildIssue(overrides: Partial<StandupIssue> = {}): StandupIssue {
  return {
    key: 'TBX-101',
    summary: 'Review the release readiness checklist with the team',
    status: 'In Progress',
    statusCategoryKey: 'indeterminate',
    assignee: 'Alex',
    ageDays: 4,
    isBlocked: false,
    ...overrides,
  };
}

function buildBoardState(overrides: Partial<ReturnType<typeof useStandupBoardState>> = {}): ReturnType<typeof useStandupBoardState> {
  const issues = overrides.issues ?? [buildIssue()];
  return {
    jql: 'assignee in (currentUser())',
    setJql: vi.fn(),
    hideDone: true,
    setHideDone: vi.fn(),
    isLoading: false,
    errorMessage: null,
    issues,
    flowStats: { wip: 1, stale: 0, blocked: 0, avgAgeDays: 4 },
    reload: vi.fn(),
    ...overrides,
  };
}

function buildTimerState(overrides: Partial<ReturnType<typeof useStandupTimer>> = {}): ReturnType<typeof useStandupTimer> {
  return {
    remainingSeconds: STANDUP_TIMER_TOTAL_SECONDS,
    isRunning: false,
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseStandupBoardState.mockReset();
  mockUseStandupTimer.mockReset();
  mockUseStandupTimer.mockReturnValue(buildTimerState());
});

describe('StandupBoardView', () => {
  it('renders the timer display at fifteen minutes initially', () => {
    mockUseStandupBoardState.mockReturnValue(buildBoardState());

    render(<StandupBoardView />);

    expect(screen.getByLabelText('Standup timer')).toHaveTextContent('15:00');
    expect(screen.getByRole('button', { name: '▶ Start' })).toBeInTheDocument();
  });

  it('renders the flow stats bar with all four metrics', () => {
    mockUseStandupBoardState.mockReturnValue(
      buildBoardState({ flowStats: { wip: 3, stale: 2, blocked: 1, avgAgeDays: 5.5 } }),
    );

    render(<StandupBoardView />);

    expect(screen.getByLabelText('Flow stats')).toHaveTextContent('WIP');
    expect(screen.getByLabelText('Flow stats')).toHaveTextContent('Stale');
    expect(screen.getByLabelText('Flow stats')).toHaveTextContent('Blocked');
    expect(screen.getByLabelText('Flow stats')).toHaveTextContent('Avg Age');
    expect(screen.getByText('5.5d')).toBeInTheDocument();
  });

  it('renders three columns when Hide-Done is disabled', () => {
    mockUseStandupBoardState.mockReturnValue(
      buildBoardState({ hideDone: false, issues: [buildIssue(), buildIssue({ key: 'TBX-102', status: 'Done', statusCategoryKey: 'done' })] }),
    );

    render(<StandupBoardView />);

    expect(screen.getByRole('heading', { name: '✅ Done' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '🔄 In Progress' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '📋 To Do' })).toBeInTheDocument();
  });

  it('renders two columns when Hide-Done is enabled', () => {
    mockUseStandupBoardState.mockReturnValue(buildBoardState({ hideDone: true }));

    render(<StandupBoardView />);

    expect(screen.queryByRole('heading', { name: '✅ Done' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '🔄 In Progress' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '📋 To Do' })).toBeInTheDocument();
  });

  it('Hide-Done checkbox toggles column visibility through board state', () => {
    const firstBoardState = buildBoardState({ hideDone: false });
    const secondBoardState = buildBoardState({ hideDone: true });
    mockUseStandupBoardState.mockReturnValue(firstBoardState);
    const { rerender } = render(<StandupBoardView />);

    fireEvent.click(screen.getByLabelText('Hide Done'));
    mockUseStandupBoardState.mockReturnValue(secondBoardState);
    rerender(<StandupBoardView />);

    expect(firstBoardState.setHideDone).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('heading', { name: '✅ Done' })).not.toBeInTheDocument();
  });

  it('shows empty, loading, and error states', () => {
    mockUseStandupBoardState.mockReturnValue(buildBoardState({ issues: [], flowStats: { wip: 0, stale: 0, blocked: 0, avgAgeDays: 0 } }));
    const { rerender } = render(<StandupBoardView />);
    expect(screen.getByText('No Jira issues match the current standup JQL.')).toBeInTheDocument();

    mockUseStandupBoardState.mockReturnValue(buildBoardState({ isLoading: true, issues: [] }));
    rerender(<StandupBoardView />);
    expect(screen.getByText('Loading Standup Board issues…')).toBeInTheDocument();

    mockUseStandupBoardState.mockReturnValue(buildBoardState({ errorMessage: 'Jira down', issues: [] }));
    rerender(<StandupBoardView />);
    expect(screen.getByRole('alert')).toHaveTextContent('Jira down');
  });
});
