// PipelineView.test.tsx — Render and interaction tests for the standalone Pipeline View.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/usePipelineState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/usePipelineState.ts')>(
    './hooks/usePipelineState.ts',
  );
  return {
    ...actualModule,
    usePipelineState: vi.fn(),
  };
});

import PipelineView from './PipelineView.tsx';
import { usePipelineState, type EpicSummary } from './hooks/usePipelineState.ts';

const mockUsePipelineState = vi.mocked(usePipelineState);

const SAMPLE_EPIC: EpicSummary = {
  key: 'TBX-1',
  summary: 'Build pipeline view',
  status: 'In Dev',
  statusCategoryKey: 'indeterminate',
  assignee: 'Alex Morgan',
  storyPoints: 13,
  children: null,
  isLoadingChildren: false,
  rolledUpStoryPoints: 13,
  completionPercent: 0,
};

const SAMPLE_EPIC_WITH_CHILDREN: EpicSummary = {
  ...SAMPLE_EPIC,
  children: [
    {
      key: 'TBX-11',
      summary: 'Create rollup helpers',
      status: 'Done',
      statusCategoryKey: 'done',
      storyPoints: 5,
    },
    {
      key: 'TBX-12',
      summary: 'Create hook',
      status: 'In QA',
      statusCategoryKey: 'indeterminate',
      storyPoints: 3,
    },
  ],
  rolledUpStoryPoints: 8,
  completionPercent: 50,
};

interface OverrideHookState {
  epics?: EpicSummary[];
  projectKey?: string;
  statusCategoryFilter?: ReturnType<typeof usePipelineState>['statusCategoryFilter'];
  assigneeFilter?: string;
  isLoading?: boolean;
  errorMessage?: string | null;
}

function buildHookState(overrides: OverrideHookState = {}): ReturnType<typeof usePipelineState> {
  return {
    projectKey: overrides.projectKey ?? '',
    setProjectKey: vi.fn(),
    statusCategoryFilter: overrides.statusCategoryFilter ?? ['new', 'indeterminate', 'done'],
    toggleStatusCategory: vi.fn(),
    assigneeFilter: overrides.assigneeFilter ?? '',
    setAssigneeFilter: vi.fn(),
    isLoading: overrides.isLoading ?? false,
    errorMessage: overrides.errorMessage ?? null,
    epics: overrides.epics ?? [],
    reload: vi.fn(),
    loadChildren: vi.fn(),
  };
}

beforeEach(() => {
  mockUsePipelineState.mockReset();
});

describe('PipelineView', () => {
  it('renders title, project input, filters, and empty guidance', () => {
    mockUsePipelineState.mockReturnValue(buildHookState());

    render(<PipelineView />);

    expect(screen.getByRole('heading', { name: 'Pipeline View' })).toBeInTheDocument();
    expect(screen.getByLabelText('Jira project key')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by assignee')).toBeInTheDocument();
    expect(screen.getByText('Load a project pipeline or adjust filters to see epics.')).toBeInTheDocument();
  });

  it('shows the loading state while Jira epics are being fetched', () => {
    mockUsePipelineState.mockReturnValue(buildHookState({ isLoading: true }));

    render(<PipelineView />);

    expect(screen.getByText('Loading pipeline epics…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('shows the error state when the hook reports a Jira failure', () => {
    mockUsePipelineState.mockReturnValue(buildHookState({ errorMessage: 'Jira down' }));

    render(<PipelineView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Jira down');
  });

  it('renders populated epic cards with rollup, owner, child count, and completion percentage', () => {
    mockUsePipelineState.mockReturnValue(buildHookState({ epics: [SAMPLE_EPIC_WITH_CHILDREN] }));

    render(<PipelineView />);

    expect(screen.getByText('TBX-1')).toBeInTheDocument();
    expect(screen.getByText('Build pipeline view')).toBeInTheDocument();
    expect(screen.getByText('Alex Morgan')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('passes project, assignee, category, and load interactions to the hook', () => {
    const hookState = buildHookState();
    mockUsePipelineState.mockReturnValue(hookState);

    render(<PipelineView />);
    fireEvent.change(screen.getByLabelText('Jira project key'), { target: { value: 'TBX' } });
    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'alex' } });
    fireEvent.click(screen.getByLabelText('Done'));
    fireEvent.click(screen.getByRole('button', { name: '↻ Load Pipeline' }));

    expect(hookState.setProjectKey).toHaveBeenCalledWith('TBX');
    expect(hookState.setAssigneeFilter).toHaveBeenCalledWith('alex');
    expect(hookState.toggleStatusCategory).toHaveBeenCalledWith('done');
    expect(hookState.reload).toHaveBeenCalledTimes(1);
  });

  it('expands a loaded epic and displays its child issue details', () => {
    mockUsePipelineState.mockReturnValue(buildHookState({ epics: [SAMPLE_EPIC_WITH_CHILDREN] }));

    render(<PipelineView />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand TBX-1' }));

    expect(screen.getByText('1 of 2 children done')).toBeInTheDocument();
    expect(screen.getByText('TBX-11')).toBeInTheDocument();
    expect(screen.getByText('Create rollup helpers')).toBeInTheDocument();
  });

  it('lazy-loads children when an unloaded epic expands', () => {
    const hookState = buildHookState({ epics: [SAMPLE_EPIC] });
    mockUsePipelineState.mockReturnValue(hookState);

    render(<PipelineView />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand TBX-1' }));

    expect(hookState.loadChildren).toHaveBeenCalledWith('TBX-1');
    expect(screen.getByText('No child issues were returned for this epic.')).toBeInTheDocument();
  });

  it('shows child-level loading feedback while an expanded epic fetch is in flight', () => {
    const loadingEpic: EpicSummary = { ...SAMPLE_EPIC, isLoadingChildren: true };
    mockUsePipelineState.mockReturnValue(buildHookState({ epics: [loadingEpic] }));

    render(<PipelineView />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand TBX-1' }));

    expect(screen.getByText('Loading children…')).toBeInTheDocument();
  });

  it('groups visible epics under their Jira status categories', () => {
    const doneEpic: EpicSummary = {
      ...SAMPLE_EPIC,
      key: 'TBX-2',
      summary: 'Done epic',
      status: 'Done',
      statusCategoryKey: 'done',
      assignee: null,
    };
    mockUsePipelineState.mockReturnValue(buildHookState({ epics: [SAMPLE_EPIC, doneEpic] }));

    render(<PipelineView />);

    expect(screen.getByRole('region', { name: 'In Progress' })).toHaveTextContent('Build pipeline view');
    expect(screen.getByRole('region', { name: 'Done' })).toHaveTextContent('Done epic');
  });
});
