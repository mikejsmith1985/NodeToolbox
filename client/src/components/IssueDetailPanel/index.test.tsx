// index.test.tsx — Unit tests for the reusable inline Jira issue detail panel.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraComment, JiraIssue, JiraTransition } from '../../types/jira.ts';

const { mockJiraGet, mockJiraPost, mockJiraPut } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
  mockJiraPut: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
  jiraPut: mockJiraPut,
}));

import IssueDetailPanel from './index.tsx';

const TEST_TRANSITIONS: JiraTransition[] = [
  { id: '31', name: 'In Review', to: { name: 'In Review', statusCategory: { name: 'In Progress' } } },
];

const TEST_COMMENTS: JiraComment[] = [
  {
    id: '901',
    author: { displayName: 'Jordan Reviewer' },
    body: 'Please add acceptance criteria before sprint.',
    created: '2025-01-03T00:00:00.000Z',
  },
];

// Comments and transitions share the same jiraGet mock, so route by URL suffix.
function mockJiraGetByPath(comments: JiraComment[] = TEST_COMMENTS) {
  mockJiraGet.mockImplementation((path: string) => {
    if (path.endsWith('/comment')) {
      return Promise.resolve({ comments });
    }
    return Promise.resolve({ transitions: TEST_TRANSITIONS });
  });
}

const TEST_ISSUE: JiraIssue = {
  id: 'TBX-101',
  key: 'TBX-101',
  fields: {
    summary: 'Add inline Jira actions',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: { name: 'High', iconUrl: 'priority.png' },
    assignee: {
      accountId: 'user-1',
      displayName: 'Taylor Dev',
      emailAddress: 'taylor@example.com',
      avatarUrls: {},
    },
    reporter: null,
    issuetype: { name: 'Story', iconUrl: 'story.png' },
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-02T00:00:00.000Z',
    description: 'This issue needs inline transitions, comments, and story-point editing.',
    customfield_10016: 8,
  },
};

function renderIssueDetailPanel() {
  return render(<IssueDetailPanel isEmbedded issue={TEST_ISSUE} />);
}

describe('IssueDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJiraGetByPath();
    mockJiraPost.mockResolvedValue({});
    mockJiraPut.mockResolvedValue(undefined);
  });

  it('renders the issue key and summary', () => {
    renderIssueDetailPanel();

    expect(screen.getByText('TBX-101')).toBeInTheDocument();
    expect(screen.getByText('Add inline Jira actions')).toBeInTheDocument();
  });

  it('loads transitions on mount', async () => {
    renderIssueDetailPanel();

    await waitFor(() => {
      expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/transitions');
    });
  });

  it('posts a comment when the comment form is submitted', async () => {
    const user = userEvent.setup();
    renderIssueDetailPanel();

    await user.type(screen.getByLabelText(/add comment/i), 'Looks good to me.');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/comment', {
        body: 'Looks good to me.',
      });
    });
  });

  it('shows the story points input using the issue estimate', () => {
    renderIssueDetailPanel();

    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
  });

  it('shows the posted success message after a successful comment', async () => {
    const user = userEvent.setup();
    renderIssueDetailPanel();

    await user.type(screen.getByLabelText(/add comment/i), 'Posted from the detail panel.');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(screen.getByText('✓ Posted')).toBeInTheDocument();
    });
  });

  it('loads existing comments on mount', async () => {
    renderIssueDetailPanel();

    await waitFor(() => {
      expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/comment');
    });
  });

  it('displays existing comments with their author and body', async () => {
    renderIssueDetailPanel();

    expect(await screen.findByText('Please add acceptance criteria before sprint.')).toBeInTheDocument();
    expect(screen.getByText('Jordan Reviewer')).toBeInTheDocument();
  });

  it('shows all comments newest-first regardless of the fetched order', async () => {
    // Deliberately supply the thread oldest-first; the panel must render newest at the top.
    mockJiraGetByPath([
      { id: '801', author: { displayName: 'Older Author' }, body: 'older comment body', created: '2025-01-01T00:00:00.000Z' },
      { id: '802', author: { displayName: 'Newer Author' }, body: 'newer comment body', created: '2025-01-05T00:00:00.000Z' },
    ]);
    renderIssueDetailPanel();

    const firstBody = await screen.findByText('newer comment body');
    const secondBody = screen.getByText('older comment body');
    // The newer comment appears before the older one in DOM order (newest pinned at top).
    expect(firstBody.compareDocumentPosition(secondBody) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows an empty state when the issue has no comments', async () => {
    mockJiraGetByPath([]);
    renderIssueDetailPanel();

    expect(await screen.findByText(/no comments yet/i)).toBeInTheDocument();
  });

  it('invokes onCommentPosted after a successful comment post', async () => {
    const user = userEvent.setup();
    const onCommentPosted = vi.fn();
    render(<IssueDetailPanel isEmbedded issue={TEST_ISSUE} onCommentPosted={onCommentPosted} />);

    await user.type(screen.getByLabelText(/add comment/i), 'Replying to the mention.');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(onCommentPosted).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes the comments list after posting a new comment', async () => {
    const user = userEvent.setup();
    renderIssueDetailPanel();

    // One comment fetch happens on mount; posting must trigger a second to show the new comment.
    await waitFor(() => {
      expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/comment');
    });
    const commentFetchCountAfterMount = mockJiraGet.mock.calls.filter(
      ([path]) => typeof path === 'string' && path.endsWith('/comment'),
    ).length;

    await user.type(screen.getByLabelText(/add comment/i), 'Adding criteria now.');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      const commentFetchCountAfterPost = mockJiraGet.mock.calls.filter(
        ([path]) => typeof path === 'string' && path.endsWith('/comment'),
      ).length;
      expect(commentFetchCountAfterPost).toBeGreaterThan(commentFetchCountAfterMount);
    });
  });
});
