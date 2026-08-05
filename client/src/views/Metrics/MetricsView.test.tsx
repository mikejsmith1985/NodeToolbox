// MetricsView.test.tsx — Render and interaction tests for the standalone Metrics dashboard.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useMetricsState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useMetricsState.ts')>('./hooks/useMetricsState.ts');
  return {
    ...actualModule,
    useMetricsState: vi.fn(),
  };
});

import MetricsView from './MetricsView.tsx';
import { useMetricsState, type UseMetricsState } from './hooks/useMetricsState.ts';

const mockUseMetricsState = vi.mocked(useMetricsState);

interface MetricsStateOverrides {
  boardId?: string;
  projectKey?: string;
  sprintWindow?: number;
  boardType?: UseMetricsState['boardType'];
  isLoading?: boolean;
  errorMessage?: string | null;
  predictability?: UseMetricsState['predictability'];
  averageCompletionPct?: number;
  throughput?: UseMetricsState['throughput'];
  kanbanThroughput?: UseMetricsState['kanbanThroughput'];
  cycleTime?: UseMetricsState['cycleTime'];
}

function buildMetricsState(overrides: MetricsStateOverrides = {}): UseMetricsState {
  const predictability = overrides.predictability ?? [];
  return {
    boardId: overrides.boardId ?? '',
    setBoardId: vi.fn(),
    projectKey: overrides.projectKey ?? '',
    setProjectKey: vi.fn(),
    sprintWindow: overrides.sprintWindow ?? 6,
    setSprintWindow: vi.fn(),
    boardType: overrides.boardType ?? null,
    isLoading: overrides.isLoading ?? false,
    errorMessage: overrides.errorMessage ?? null,
    predictability,
    averageCompletionPct: overrides.averageCompletionPct ?? 0,
    throughput: overrides.throughput ?? [],
    kanbanThroughput: overrides.kanbanThroughput ?? [],
    cycleTime: overrides.cycleTime ?? null,
    reload: vi.fn(),
  };
}

describe('MetricsView', () => {
  beforeEach(() => {
    mockUseMetricsState.mockReset();
  });

  it('renders the empty state when no board ID is configured', () => {
    mockUseMetricsState.mockReturnValue(buildMetricsState());

    render(<MetricsView />);

    expect(screen.getByRole('heading', { name: 'Metrics' })).toBeInTheDocument();
    expect(screen.getByLabelText('Board ID')).toBeInTheDocument();
    expect(screen.getByText('Enter a numeric board ID, then load Metrics to analyze recent delivery.')).toBeInTheDocument();
  });

  it('passes input edits and reload clicks to the state hook', () => {
    const metricsState = buildMetricsState({ boardId: '42' });
    mockUseMetricsState.mockReturnValue(metricsState);

    render(<MetricsView />);
    fireEvent.change(screen.getByLabelText('Board ID'), { target: { value: '77' } });
    fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'TBX' } });
    fireEvent.change(screen.getByLabelText('Sprint window'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load Metrics' }));

    expect(metricsState.setBoardId).toHaveBeenCalledWith('77');
    expect(metricsState.setProjectKey).toHaveBeenCalledWith('TBX');
    expect(metricsState.setSprintWindow).toHaveBeenCalledWith(9);
    expect(metricsState.reload).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while metrics are loading', () => {
    mockUseMetricsState.mockReturnValue(buildMetricsState({ boardId: '42', isLoading: true }));

    render(<MetricsView />);

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    expect(screen.getByText('Loading Metrics results…')).toBeInTheDocument();
  });

  it('renders predictability bars with the average percentage', () => {
    mockUseMetricsState.mockReturnValue(
      buildMetricsState({
        boardId: '42',
        predictability: [
          {
            sprintId: 1,
            sprintName: 'Sprint 1',
            committedPoints: 10,
            completedPoints: 8,
            completedItems: 4,
            committedItems: 5,
            completionPct: 80,
          },
        ],
        averageCompletionPct: 80,
      }),
    );

    render(<MetricsView />);

    expect(screen.getByText('Average completion: 80%')).toBeInTheDocument();
    expect(screen.getByText('Sprint 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Sprint 1 completion 80%')).toBeInTheDocument();
  });

  it('asks for a project key on Kanban boards when none is set', () => {
    mockUseMetricsState.mockReturnValue(buildMetricsState({ boardId: '42', boardType: 'kanban' }));

    render(<MetricsView />);

    expect(screen.getByText(/kanban flow metrics need a project key/i)).toBeInTheDocument();
  });

  it('renders weekly kanban throughput rows instead of sprint rows', () => {
    mockUseMetricsState.mockReturnValue(
      buildMetricsState({
        boardId: '42',
        projectKey: 'TBX',
        boardType: 'kanban',
        kanbanThroughput: [
          { weekStartIso: '2026-07-23', completedIssues: 5 },
          { weekStartIso: '2026-07-30', completedIssues: 8 },
        ],
      }),
    );

    render(<MetricsView />);

    expect(screen.getByText('Week of 2026-07-23')).toBeInTheDocument();
    expect(screen.getByText('5 issues')).toBeInTheDocument();
    expect(screen.getByText('8 issues')).toBeInTheDocument();
    expect(screen.getByText('Completed issues per rolling week.')).toBeInTheDocument();
  });

  it('renders flow predictability from cycle time on Kanban boards', () => {
    mockUseMetricsState.mockReturnValue(
      buildMetricsState({
        boardId: '42',
        projectKey: 'TBX',
        boardType: 'kanban',
        cycleTime: { sampleCount: 20, medianDays: 3, p90Days: 5, meanDays: 3.4 },
      }),
    );

    render(<MetricsView />);

    expect(screen.getByText('Flow predictability')).toBeInTheDocument();
    expect(screen.getByText('Steady')).toBeInTheDocument();
    // p90 ÷ median = 5/3 ≈ 1.7 rendered with one decimal.
    expect(screen.getByText(/1\.7× median/)).toBeInTheDocument();
  });

  it('renders throughput rows for closed sprints', () => {
    mockUseMetricsState.mockReturnValue(
      buildMetricsState({
        boardId: '42',
        throughput: [{ sprintId: 1, sprintName: 'Sprint 1', completedIssues: 7, completedPoints: 21 }],
      }),
    );

    render(<MetricsView />);

    expect(screen.getByText('Sprint 1')).toBeInTheDocument();
    expect(screen.getByText('7 issues')).toBeInTheDocument();
    expect(screen.getByText('21 pts')).toBeInTheDocument();
  });

  it('renders cycle time median, p90, and mean stats', () => {
    mockUseMetricsState.mockReturnValue(
      buildMetricsState({
        boardId: '42',
        projectKey: 'TBX',
        cycleTime: { sampleCount: 4, medianDays: 3.5, p90Days: 9, meanDays: 4.25 },
      }),
    );

    render(<MetricsView />);

    expect(screen.getByText('3.5d')).toBeInTheDocument();
    expect(screen.getByText('9.0d')).toBeInTheDocument();
    expect(screen.getByText('4.3d')).toBeInTheDocument();
    expect(screen.getByText('Cycle time uses created-to-resolution dates; full changelog parsing is deferred.')).toBeInTheDocument();
  });
});
