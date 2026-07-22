// IssueComments.test.tsx — Verifies the connected comment window loads a thread and renders it all.

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraComment } from '../../types/jira.ts';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

// getMyself backs the self-mention highlight; stub it so these tests stay about the thread itself.
vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  getMyself: vi.fn().mockResolvedValue({ displayName: 'Reader', accountId: 'reader-1' }),
}));

import IssueComments from './IssueComments.tsx';

const THREAD: JiraComment[] = [
  { id: '1', author: { displayName: 'Ada' }, body: 'oldest comment', created: '2025-01-01T00:00:00.000Z' },
  { id: '2', author: { displayName: 'Ben' }, body: 'newest comment', created: '2025-01-09T00:00:00.000Z' },
];

describe('IssueComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the issue thread and renders every comment newest-first', async () => {
    mockJiraGet.mockResolvedValue({ comments: THREAD });

    render(<IssueComments issueKey="TBX-9" />);

    await waitFor(() => expect(screen.getByText('newest comment')).toBeInTheDocument());
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-9/comment');
    expect(screen.getByText('oldest comment')).toBeInTheDocument();

    const newest = screen.getByText('newest comment');
    const oldest = screen.getByText('oldest comment');
    // Newest is pinned above the oldest in DOM order.
    expect(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the shared empty state with an optional custom label', async () => {
    mockJiraGet.mockResolvedValue({ comments: [] });

    render(<IssueComments issueKey="TBX-9" emptyLabel="No Jira comments were returned for this issue." />);

    await waitFor(() =>
      expect(screen.getByText('No Jira comments were returned for this issue.')).toBeInTheDocument(),
    );
  });
});
