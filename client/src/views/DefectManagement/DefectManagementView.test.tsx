// DefectManagementView.test.tsx — Render-layer tests for the standalone Defect Management view.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useDefectManagementState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useDefectManagementState.ts')>(
    './hooks/useDefectManagementState.ts',
  );
  return {
    ...actualModule,
    useDefectManagementState: vi.fn(),
  };
});

import DefectManagementView from './DefectManagementView.tsx';
import { useDefectManagementState, type UseDefectManagementState } from './hooks/useDefectManagementState.ts';

const mockUseDefectManagementState = vi.mocked(useDefectManagementState);

function buildViewState(overrides: Partial<UseDefectManagementState> = {}): UseDefectManagementState {
  return {
    projectKey: overrides.projectKey ?? '',
    setProjectKey: overrides.setProjectKey ?? vi.fn(),
    extraJql: overrides.extraJql ?? '',
    setExtraJql: overrides.setExtraJql ?? vi.fn(),
    filter: overrides.filter ?? { priority: '', statusCat: '', unassignedOnly: false },
    setFilter: overrides.setFilter ?? vi.fn(),
    sort: overrides.sort ?? 'priority-age',
    setSort: overrides.setSort ?? vi.fn(),
    isLoading: overrides.isLoading ?? false,
    errorMessage: overrides.errorMessage ?? null,
    defects: overrides.defects ?? [],
    rawIssueCount: overrides.rawIssueCount ?? 0,
    reload: overrides.reload ?? vi.fn(),
  };
}

beforeEach(() => {
  mockUseDefectManagementState.mockReset();
});

describe('DefectManagementView', () => {
  it('renders the empty state when no project key is set', () => {
    mockUseDefectManagementState.mockReturnValue(buildViewState());

    render(<DefectManagementView />);

    expect(screen.getByRole('heading', { name: 'Defect Management' })).toBeInTheDocument();
    expect(screen.getByText('Enter a Jira project key to load recent defects.')).toBeInTheDocument();
  });

  it('renders loading state while defects are loading', () => {
    mockUseDefectManagementState.mockReturnValue(buildViewState({ projectKey: 'TBX', isLoading: true }));

    render(<DefectManagementView />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading defects…');
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('renders error state when Jira loading fails', () => {
    mockUseDefectManagementState.mockReturnValue(buildViewState({ projectKey: 'TBX', errorMessage: 'Jira down' }));

    render(<DefectManagementView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Jira down');
  });

  it('renders a populated list with row count and linked keys', () => {
    mockUseDefectManagementState.mockReturnValue(
      buildViewState({
        projectKey: 'TBX',
        rawIssueCount: 2,
        defects: [
          {
            key: 'TBX-1',
            summary: 'Broken checkout',
            priority: 'High',
            status: 'In Progress',
            statusCat: 'indeterminate',
            assignee: '',
            issueType: 'Bug',
            created: '2024-04-01T00:00:00.000Z',
            updated: '2024-04-18T00:00:00.000Z',
            ageDays: 19,
            updatedDays: 2,
          },
        ],
      }),
    );

    render(<DefectManagementView />);

    expect(screen.getByText('Showing 1 of 2 defects')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TBX-1' })).toHaveAttribute('href', expect.stringContaining('TBX-1'));
    expect(screen.getByText('Broken checkout')).toBeInTheDocument();
    expect(screen.getByText('UNASSIGNED')).toBeInTheDocument();
    expect(screen.getByText('19d')).toBeInTheDocument();
    expect(screen.getByText('2d')).toBeInTheDocument();
  });

  it('calls reload when the load button is clicked', () => {
    const reload = vi.fn();
    mockUseDefectManagementState.mockReturnValue(buildViewState({ projectKey: 'TBX', reload }));

    render(<DefectManagementView />);
    fireEvent.click(screen.getByRole('button', { name: '↻ Load Defects' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reflects filter and sort control changes through the hook actions', () => {
    const setFilter = vi.fn();
    const setSort = vi.fn();
    mockUseDefectManagementState.mockReturnValue(buildViewState({ projectKey: 'TBX', setFilter, setSort }));

    render(<DefectManagementView />);
    fireEvent.change(screen.getByLabelText('Priority filter'), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText('Status category filter'), { target: { value: 'done' } });
    fireEvent.click(screen.getByLabelText('Unassigned defects only'));
    fireEvent.change(screen.getByLabelText('Sort defects'), { target: { value: 'updated' } });

    expect(setFilter).toHaveBeenCalledWith('priority', 'High');
    expect(setFilter).toHaveBeenCalledWith('statusCat', 'done');
    expect(setFilter).toHaveBeenCalledWith('unassignedOnly', true);
    expect(setSort).toHaveBeenCalledWith('updated');
  });

  it('provides accessible labels for all query, filter, and sort controls', () => {
    mockUseDefectManagementState.mockReturnValue(buildViewState({ projectKey: 'TBX' }));

    render(<DefectManagementView />);

    expect(screen.getByLabelText('Jira project key')).toBeInTheDocument();
    expect(screen.getByLabelText('Extra JQL')).toBeInTheDocument();
    expect(screen.getByLabelText('Priority filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Status category filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Unassigned defects only')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort defects')).toBeInTheDocument();
  });
});
