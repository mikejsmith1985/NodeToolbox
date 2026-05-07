// StoryPointingView.test.tsx — Render and interaction tests for the Story Pointing view.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useStoryPointingState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useStoryPointingState.ts')>(
    './hooks/useStoryPointingState.ts',
  );
  return {
    ...actualModule,
    useStoryPointingState: vi.fn(),
  };
});

import StoryPointingView from './StoryPointingView.tsx';
import { useStoryPointingState, type StoryPointingIssue } from './hooks/useStoryPointingState.ts';

const mockUseStoryPointingState = vi.mocked(useStoryPointingState);

const SAMPLE_ISSUE: StoryPointingIssue = {
  key: 'TBX-101',
  summary: 'Build Story Pointing view',
  description: 'Facilitators can estimate one issue at a time.',
  issueType: 'Story',
  status: 'Ready',
  priority: 'High',
  assignee: 'Alex',
  storyPoints: 0,
};

interface OverrideHookState {
  deck?: StoryPointingIssue[];
  currentIssue?: StoryPointingIssue | null;
  currentIssueIndex?: number;
  selectedVote?: ReturnType<typeof useStoryPointingState>['selectedVote'];
  isRevealed?: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
  loadError?: string | null;
  saveStatusMessage?: string | null;
}

function buildHookState(overrides: OverrideHookState = {}): ReturnType<typeof useStoryPointingState> {
  const deck = overrides.deck ?? (overrides.currentIssue ? [overrides.currentIssue] : []);
  return {
    queryText: 'statusCategory != Done',
    deck,
    currentIssue: overrides.currentIssue ?? null,
    currentIssueIndex: overrides.currentIssueIndex ?? 0,
    selectedVote: overrides.selectedVote ?? null,
    isRevealed: overrides.isRevealed ?? false,
    isLoading: overrides.isLoading ?? false,
    isSaving: overrides.isSaving ?? false,
    loadError: overrides.loadError ?? null,
    saveStatusMessage: overrides.saveStatusMessage ?? null,
    session: { pointedCount: 0, skippedCount: 0 },
    canRevealVote: overrides.selectedVote !== undefined && overrides.selectedVote !== null,
    canPersistVote: typeof overrides.selectedVote === 'number' && overrides.isRevealed === true,
    setQueryText: vi.fn(),
    loadIssues: vi.fn(),
    selectVote: vi.fn(),
    revealVotes: vi.fn(),
    resetVote: vi.fn(),
    skipIssue: vi.fn(),
    goToPreviousIssue: vi.fn(),
    goToIssue: vi.fn(),
    saveRevealedVote: vi.fn(),
    clearDeck: vi.fn(),
  };
}

beforeEach(() => {
  mockUseStoryPointingState.mockReset();
});

describe('StoryPointingView', () => {
  it('renders the title, query field, and empty-state guidance', () => {
    mockUseStoryPointingState.mockReturnValue(buildHookState());

    render(<StoryPointingView />);

    expect(screen.getByRole('heading', { name: 'Story Pointing' })).toBeInTheDocument();
    expect(screen.getByLabelText('Jira issue search')).toBeInTheDocument();
    expect(screen.getByText('Load a JQL search or comma-separated issue keys to start pointing.')).toBeInTheDocument();
  });

  it('renders the current issue card, metadata, and point cards', () => {
    mockUseStoryPointingState.mockReturnValue(
      buildHookState({ currentIssue: SAMPLE_ISSUE, deck: [SAMPLE_ISSUE] }),
    );

    render(<StoryPointingView />);

    expect(screen.getByText('TBX-101')).toBeInTheDocument();
    expect(screen.getByText('Build Story Pointing view')).toBeInTheDocument();
    expect(screen.getByText('Facilitators can estimate one issue at a time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote 13 story points' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vote unknown story points' })).toBeInTheDocument();
  });

  it('passes query edits and load clicks to the state hook', () => {
    const hookState = buildHookState();
    mockUseStoryPointingState.mockReturnValue(hookState);

    render(<StoryPointingView />);
    fireEvent.change(screen.getByLabelText('Jira issue search'), { target: { value: 'TBX-101' } });
    fireEvent.click(screen.getByRole('button', { name: '↻ Load Issues' }));

    expect(hookState.setQueryText).toHaveBeenCalledWith('TBX-101');
    expect(hookState.loadIssues).toHaveBeenCalledTimes(1);
  });

  it('selects point cards and enables reveal when a vote exists', () => {
    const hookState = buildHookState({ currentIssue: SAMPLE_ISSUE, selectedVote: 8 });
    mockUseStoryPointingState.mockReturnValue(hookState);

    render(<StoryPointingView />);
    fireEvent.click(screen.getByRole('button', { name: 'Vote 8 story points' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Vote' }));

    expect(hookState.selectVote).toHaveBeenCalledWith(8);
    expect(hookState.revealVotes).toHaveBeenCalledTimes(1);
  });

  it('shows the revealed vote and saves numeric consensus back to Jira', () => {
    const hookState = buildHookState({ currentIssue: SAMPLE_ISSUE, selectedVote: 5, isRevealed: true });
    mockUseStoryPointingState.mockReturnValue(hookState);

    render(<StoryPointingView />);

    expect(screen.getByText('Revealed vote: 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '💾 Save 5 points' }));

    expect(hookState.saveRevealedVote).toHaveBeenCalledTimes(1);
  });

  it('routes reset, skip, previous, and jump controls through hook actions', () => {
    const secondIssue = { ...SAMPLE_ISSUE, key: 'TBX-102', summary: 'Second issue' };
    const hookState = buildHookState({ currentIssue: SAMPLE_ISSUE, deck: [SAMPLE_ISSUE, secondIssue] });
    mockUseStoryPointingState.mockReturnValue(hookState);

    render(<StoryPointingView />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Vote' }));
    fireEvent.click(screen.getByRole('button', { name: '? Skip' }));
    fireEvent.click(screen.getByRole('button', { name: '← Previous' }));
    fireEvent.change(screen.getByLabelText('Jump to issue'), { target: { value: '1' } });

    expect(hookState.resetVote).toHaveBeenCalledTimes(1);
    expect(hookState.skipIssue).toHaveBeenCalledTimes(1);
    expect(hookState.goToPreviousIssue).toHaveBeenCalledTimes(1);
    expect(hookState.goToIssue).toHaveBeenCalledWith(1);
  });

  it('renders load and save status messages for operational feedback', () => {
    mockUseStoryPointingState.mockReturnValue(
      buildHookState({ loadError: 'Jira down', saveStatusMessage: '✅ Saved TBX-101 as 5 points' }),
    );

    render(<StoryPointingView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Jira down');
    expect(screen.getByText('✅ Saved TBX-101 as 5 points')).toBeInTheDocument();
  });
});
