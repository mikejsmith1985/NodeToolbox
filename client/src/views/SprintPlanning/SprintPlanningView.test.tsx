// SprintPlanningView.test.tsx — Smoke tests for the Sprint Planning view.

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useSprintPlanningState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useSprintPlanningState.ts')>(
    './hooks/useSprintPlanningState.ts',
  );
  return {
    ...actualModule,
    useSprintPlanningState: vi.fn(),
  };
});

import SprintPlanningView from './SprintPlanningView.tsx';
import { useSprintPlanningState } from './hooks/useSprintPlanningState.ts';

const mockUseSprintPlanningState = vi.mocked(useSprintPlanningState);

interface OverrideHookState {
  backlog?: ReturnType<typeof useSprintPlanningState>['backlog'];
  pendingChanges?: Record<string, number>;
  isSaving?: boolean;
  loadError?: string | null;
  saveStatusMessage?: string | null;
  searchText?: string;
}

function buildHookState(overrides: OverrideHookState = {}): ReturnType<typeof useSprintPlanningState> {
  return {
    projectKey: '',
    searchText: overrides.searchText ?? '',
    backlog: overrides.backlog ?? [],
    pendingChanges: overrides.pendingChanges ?? {},
    isLoading: false,
    isSaving: overrides.isSaving ?? false,
    loadError: overrides.loadError ?? null,
    saveStatusMessage: overrides.saveStatusMessage ?? null,
    failedSaveKeys: [],
    setProjectKey: vi.fn(),
    setSearchText: vi.fn(),
    loadBacklog: vi.fn(),
    setStoryPoints: vi.fn(),
    saveChanges: vi.fn(),
    resetPendingChanges: vi.fn(),
  };
}

beforeEach(() => {
  mockUseSprintPlanningState.mockReset();
});

describe('SprintPlanningView', () => {
  it('renders the title and a load button', () => {
    mockUseSprintPlanningState.mockReturnValue(buildHookState());
    render(<SprintPlanningView />);

    expect(screen.getByRole('heading', { name: 'Sprint Planning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↻ Load Backlog' })).toBeInTheDocument();
  });

  it('renders backlog rows and the points input for each issue', () => {
    mockUseSprintPlanningState.mockReturnValue(
      buildHookState({
        backlog: [
          {
            key: 'TBX-10',
            summary: 'Implement Sprint Planning',
            issueType: 'Story',
            priority: 'High',
            assignee: 'Mike',
            storyPoints: 5,
          },
        ],
      }),
    );

    render(<SprintPlanningView />);

    expect(screen.getByText('TBX-10')).toBeInTheDocument();
    expect(screen.getByText('Implement Sprint Planning')).toBeInTheDocument();
    expect(screen.getByLabelText('Story points for TBX-10')).toHaveValue(5);
  });

  it('disables Save Changes when there are no pending edits', () => {
    mockUseSprintPlanningState.mockReturnValue(buildHookState());
    render(<SprintPlanningView />);

    expect(screen.getByRole('button', { name: '💾 Save Changes' })).toBeDisabled();
  });

  it('calls setStoryPoints when the input changes', () => {
    const hookState = buildHookState({
      backlog: [
        {
          key: 'TBX-1',
          summary: 'Sample',
          issueType: 'Story',
          priority: 'Medium',
          assignee: 'Sam',
          storyPoints: 0,
        },
      ],
    });
    mockUseSprintPlanningState.mockReturnValue(hookState);
    render(<SprintPlanningView />);

    const pointsInputElement = screen.getByLabelText('Story points for TBX-1');
    fireEvent.change(pointsInputElement, { target: { value: '8' } });

    expect(hookState.setStoryPoints).toHaveBeenCalledWith('TBX-1', '8');
  });

  it('shows the load error and the save status message when present', () => {
    mockUseSprintPlanningState.mockReturnValue(
      buildHookState({ loadError: 'Boom', saveStatusMessage: '✅ All changes saved' }),
    );
    render(<SprintPlanningView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByText('✅ All changes saved')).toBeInTheDocument();
  });
});
