// MentionsTab.test.tsx — Component tests for the Mentions report.
// The orchestration hook is mocked so these tests focus on rendering + actions.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraMention } from '../../utils/jiraMentions.ts';

const { mockUseMentionsState } = vi.hoisted(() => ({ mockUseMentionsState: vi.fn() }));

vi.mock('./hooks/useMentionsState.ts', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useMentionsState.ts')>('./hooks/useMentionsState.ts');
  return { ...actual, useMentionsState: mockUseMentionsState };
});

import MentionsTab from './MentionsTab.tsx';

function buildMention(mentionKey: string, summary: string): JiraMention {
  const [issueKey] = mentionKey.split('#');
  return {
    mentionKey,
    issueKey,
    commentId: mentionKey.split('#')[1],
    issueSummary: summary,
    authorDisplayName: 'Bob Jones',
    createdIso: '2026-06-24T10:00:00.000Z',
    excerpt: 'Please take a look when you can.',
    issue: { id: issueKey, key: issueKey, fields: {} } as unknown as JiraMention['issue'],
  };
}

const markAddressed = vi.fn().mockResolvedValue(undefined);

function buildHookState(overrides: Partial<ReturnType<typeof mockUseMentionsState>> = {}) {
  return {
    windowBusinessDays: 3,
    visibleMentions: [buildMention('TBX-1#101', 'Fix the login page')],
    addressedMap: {},
    showAddressed: false,
    isLoading: false,
    loadError: null,
    scannedIssueCount: 4,
    setWindowBusinessDays: vi.fn(),
    toggleShowAddressed: vi.fn(),
    markAddressed,
    reload: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMentionsState.mockReturnValue(buildHookState());
});

describe('MentionsTab', () => {
  it('renders a card for each visible mention', () => {
    render(<MentionsTab />);
    expect(screen.getByText('TBX-1')).toBeInTheDocument();
    expect(screen.getByText('Fix the login page')).toBeInTheDocument();
    expect(screen.getByText(/Tagged by Bob Jones/)).toBeInTheDocument();
  });

  it('marks a mention addressed when the button is clicked', async () => {
    const user = userEvent.setup();
    render(<MentionsTab />);

    await user.click(screen.getByRole('button', { name: /mark addressed/i }));

    expect(markAddressed).toHaveBeenCalledWith(
      expect.objectContaining({ mentionKey: 'TBX-1#101' }),
      true,
    );
  });

  it('shows the empty state when there are no outstanding mentions', () => {
    mockUseMentionsState.mockReturnValue(buildHookState({ visibleMentions: [] }));
    render(<MentionsTab />);
    expect(screen.getByText(/no outstanding mentions/i)).toBeInTheDocument();
  });

  it('shows an Undo button for an already-addressed mention', () => {
    mockUseMentionsState.mockReturnValue(
      buildHookState({
        showAddressed: true,
        addressedMap: { 'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' } },
      }),
    );
    render(<MentionsTab />);
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });
});
