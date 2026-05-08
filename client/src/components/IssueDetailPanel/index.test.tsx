// index.test.tsx — Unit tests for the reusable inline Jira issue detail panel.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue, JiraTransition } from '../../types/jira.ts';

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
    mockJiraGet.mockResolvedValue({ transitions: TEST_TRANSITIONS });
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
});
