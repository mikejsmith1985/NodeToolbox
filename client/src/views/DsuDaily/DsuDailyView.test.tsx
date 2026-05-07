// DsuDailyView.test.tsx — Render tests for the standalone DSU Daily standup editor.

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useDsuDailyState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useDsuDailyState.ts')>(
    './hooks/useDsuDailyState.ts',
  );
  return {
    ...actualModule,
    useDsuDailyState: vi.fn(),
  };
});

import DsuDailyView from './DsuDailyView.tsx';
import { useDsuDailyState, type UseDsuDailyState } from './hooks/useDsuDailyState.ts';
import { formatStandupText, type DsuDraft } from './utils/dsuFormat.ts';

const mockUseDsuDailyState = vi.mocked(useDsuDailyState);

function buildFakeState(overrides: Partial<UseDsuDailyState> = {}): UseDsuDailyState {
  const draft = overrides.draft ?? { yesterday: '', today: '', blockers: '' };
  return {
    draft,
    setYesterday: vi.fn(),
    setToday: vi.fn(),
    setBlockers: vi.fn(),
    isLoading: false,
    errorMessage: null,
    postKey: '',
    setPostKey: vi.fn(),
    postStatus: 'idle',
    postError: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(true),
    postComment: vi.fn().mockResolvedValue(undefined),
    formattedText: formatStandupText(draft),
    ...overrides,
  };
}

function useInteractiveFakeState(): UseDsuDailyState {
  const [draft, setDraft] = useState<DsuDraft>({ yesterday: '', today: '', blockers: '' });
  return buildFakeState({
    draft,
    setYesterday: (text: string) => setDraft((currentDraft) => ({ ...currentDraft, yesterday: text })),
    setToday: (text: string) => setDraft((currentDraft) => ({ ...currentDraft, today: text })),
    setBlockers: (text: string) => setDraft((currentDraft) => ({ ...currentDraft, blockers: text })),
    formattedText: formatStandupText(draft),
  });
}

beforeEach(() => {
  mockUseDsuDailyState.mockReset();
});

describe('DsuDailyView', () => {
  it('renders three labelled textareas, preview, actions, and post input', () => {
    mockUseDsuDailyState.mockReturnValue(buildFakeState());

    render(<DsuDailyView />);

    expect(screen.getByRole('heading', { name: 'DSU Daily' })).toBeInTheDocument();
    expect(screen.getByLabelText('Yesterday')).toBeInTheDocument();
    expect(screen.getByLabelText('Today')).toBeInTheDocument();
    expect(screen.getByLabelText('Blockers')).toBeInTheDocument();
    expect(screen.getByLabelText('Standup preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '↻ Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '📋 Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post to Jira' })).toBeInTheDocument();
    expect(screen.getByLabelText('Issue key for Jira comment')).toBeInTheDocument();
  });

  it('renders the empty state when no draft has been loaded', () => {
    mockUseDsuDailyState.mockReturnValue(buildFakeState());

    render(<DsuDailyView />);

    expect(screen.getByText('No DSU draft yet — click Refresh to load your Jira activity.')).toBeInTheDocument();
  });

  it('renders the loading state during refresh', () => {
    mockUseDsuDailyState.mockReturnValue(buildFakeState({ isLoading: true }));

    render(<DsuDailyView />);

    expect(screen.getByText('Loading your activity…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('updates the live preview when the user edits fields', () => {
    mockUseDsuDailyState.mockImplementation(useInteractiveFakeState);

    render(<DsuDailyView />);
    fireEvent.change(screen.getByLabelText('Yesterday'), { target: { value: '• TBX-1 - Finished work' } });
    fireEvent.change(screen.getByLabelText('Today'), { target: { value: '• TBX-2 - Continue work' } });
    fireEvent.change(screen.getByLabelText('Blockers'), { target: { value: 'Need test data' } });

    expect(screen.getByText(/\*Yesterday\*/).textContent).toBe(
      '*Yesterday*\n• TBX-1 - Finished work\n\n*Today*\n• TBX-2 - Continue work\n\n*Blockers*\nNeed test data',
    );
  });

  it('shows Posting then a success message based on hook status', () => {
    mockUseDsuDailyState.mockReturnValue(buildFakeState({ postStatus: 'posting' }));
    const { rerender } = render(<DsuDailyView />);

    expect(screen.getAllByText('Posting…')).toHaveLength(2);

    mockUseDsuDailyState.mockReturnValue(buildFakeState({ postStatus: 'success' }));
    rerender(<DsuDailyView />);

    expect(screen.getByText('Comment posted to Jira.')).toBeInTheDocument();
  });
});
