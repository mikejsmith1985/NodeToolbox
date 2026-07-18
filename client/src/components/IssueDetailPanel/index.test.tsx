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

// Comments, transitions, and edit metadata share the same jiraGet mock, so route by URL suffix.
// The default editmeta carries a plain numeric legacy points field, the most common shape.
function mockJiraGetByPath(
  comments: JiraComment[] = TEST_COMMENTS,
  editMetaFields: Record<string, unknown> = { customfield_10016: { name: 'Story Points' } },
) {
  mockJiraGet.mockImplementation((path: string) => {
    if (path.endsWith('/comment')) {
      return Promise.resolve({ comments });
    }
    if (path.endsWith('/editmeta')) {
      return Promise.resolve({ fields: editMetaFields });
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
    window.localStorage.clear();
    mockJiraGetByPath();
    mockJiraPost.mockResolvedValue({});
    mockJiraPut.mockResolvedValue(undefined);
  });

  it('renders the issue key and summary', () => {
    renderIssueDetailPanel();

    expect(screen.getByText('TBX-101')).toBeInTheDocument();
    expect(screen.getByText('Add inline Jira actions')).toBeInTheDocument();
  });

  it('renders the header facts as semantic chips readable at a glance (spec 019 US1)', () => {
    renderIssueDetailPanel();

    // Status chip toned by category, priority badge with direction, type icon, avatar + FULL name.
    expect(screen.getByText('In Progress')).toHaveAttribute('data-tone', 'progress');
    const priorityBadge = screen.getByText(/High/);
    expect(priorityBadge).toHaveAttribute('data-tone', 'warning');
    expect(priorityBadge.textContent).toContain('↑');
    expect(screen.getByText('📗').parentElement?.textContent).toContain('Story');
    expect(screen.getByText('TD')).toBeInTheDocument();
    expect(screen.getByText('Taylor Dev')).toBeInTheDocument();
  });

  it('renders a distinct Unassigned identity when the issue has no assignee', () => {
    const unassignedIssue = {
      ...TEST_ISSUE,
      fields: { ...TEST_ISSUE.fields, assignee: null },
    } as unknown as JiraIssue;
    render(<IssueDetailPanel isEmbedded issue={unassignedIssue} />);

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  // ── Spec 019 US2: the whole decision picture, straight off the issue payload ──

  it('renders linked issues with their relation, key, summary, and the OTHER issue\'s status chip', () => {
    const linkedIssue = {
      ...TEST_ISSUE,
      fields: {
        ...TEST_ISSUE.fields,
        issuelinks: [
          {
            type: { name: 'Relates', outward: 'links to', inward: 'is linked by' },
            outwardIssue: {
              key: 'ENCUC-2070',
              fields: {
                summary: 'Incorrect TCO Effective Dates Being Sent to ESI',
                status: { name: 'Ready for Testing', statusCategory: { key: 'indeterminate' } },
              },
            },
          },
          {
            type: { name: 'Blocks', outward: 'blocks', inward: 'is blocked by' },
            inwardIssue: {
              key: 'ENCUC-1999',
              fields: { summary: 'Upstream blocker', status: { name: 'Done', statusCategory: { key: 'done' } } },
            },
          },
        ],
      },
    } as unknown as JiraIssue;
    render(<IssueDetailPanel isEmbedded issue={linkedIssue} />);

    expect(screen.getByText('Linked Issues')).toBeInTheDocument();
    expect(screen.getByText('links to')).toBeInTheDocument();
    expect(screen.getByText('ENCUC-2070')).toBeInTheDocument();
    expect(screen.getByText('Incorrect TCO Effective Dates Being Sent to ESI')).toBeInTheDocument();
    expect(screen.getByText('Ready for Testing')).toHaveAttribute('data-tone', 'progress');
    // Inward links use the inward wording.
    expect(screen.getByText('is blocked by')).toBeInTheDocument();
    expect(screen.getByText('Done')).toHaveAttribute('data-tone', 'success');
  });

  it('renders labels and fix versions as chips when present', () => {
    const contextIssue = {
      ...TEST_ISSUE,
      fields: {
        ...TEST_ISSUE.fields,
        labels: ['Component', 'Component_Testing'],
        fixVersions: [{ name: 'Release 24.1' }],
      },
    } as unknown as JiraIssue;
    render(<IssueDetailPanel isEmbedded issue={contextIssue} />);

    expect(screen.getByText('Component')).toBeInTheDocument();
    expect(screen.getByText('Component_Testing')).toBeInTheDocument();
    expect(screen.getByText('Release 24.1')).toBeInTheDocument();
  });

  it('omits every context block entirely when its data is absent — no empty placeholder boxes', () => {
    renderIssueDetailPanel();

    expect(screen.queryByText('Linked Issues')).not.toBeInTheDocument();
    expect(screen.queryByText('Labels')).not.toBeInTheDocument();
    expect(screen.queryByText('Fix Versions')).not.toBeInTheDocument();
    expect(screen.queryByText('Sprint')).not.toBeInTheDocument();
  });

  it('renders planning context rows (PI, sprint, feature) only when the host supplies them', () => {
    render(
      <IssueDetailPanel
        isEmbedded
        issue={TEST_ISSUE}
        programIncrement="PI 26.3 (05/21/26 - 07/29/26)"
        sprintName="ENCUC Sprint 26.3.4"
        featureLinkKey="ENCUC-1500"
      />,
    );

    expect(screen.getByText('PI 26.3 (05/21/26 - 07/29/26)')).toBeInTheDocument();
    expect(screen.getByText('ENCUC Sprint 26.3.4')).toBeInTheDocument();
    expect(screen.getByText('ENCUC-1500')).toBeInTheDocument();
  });

  it('renders the description with its structure — run-in headings and lists, not a flat wall', () => {
    const structuredIssue = {
      ...TEST_ISSUE,
      fields: {
        ...TEST_ISSUE.fields,
        description: 'Steps to Reproduce:\nUsing a NON migrated member\nDay one:\n- Export to Facets',
      },
    } as unknown as JiraIssue;
    render(<IssueDetailPanel isEmbedded issue={structuredIssue} />);

    expect(screen.getByText('Steps to Reproduce:').tagName).toBe('H4');
    expect(screen.getByText('Day one:').tagName).toBe('H4');
    expect(screen.getByText('Export to Facets').tagName).toBe('LI');
    expect(screen.getByText('Using a NON migrated member')).toBeInTheDocument();
  });

  it('loads transitions on mount, asking Jira for each transition\'s required screen fields', async () => {
    renderIssueDetailPanel();

    await waitFor(() => {
      expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/transitions?expand=transitions.fields');
    });
  });

  it('applies a transition with no required fields as a bare transition post', async () => {
    const user = userEvent.setup();
    renderIssueDetailPanel();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'In Review' })).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByLabelText(/change status/i), '31');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    await waitFor(() => {
      expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/transitions', {
        transition: { id: '31' },
      });
    });
  });

  it('collects a transition\'s required screen fields inline and submits them with the transition (GH #177 follow-up)', async () => {
    // Real-world 400: "The following fields are required: Application Component Selection,
    // Defect Root Cause". The panel must gate Apply until both are answered, then post them.
    mockJiraGet.mockImplementation((path: string) => {
      if (path.endsWith('/comment')) return Promise.resolve({ comments: TEST_COMMENTS });
      if (path.endsWith('/editmeta')) return Promise.resolve({ fields: { customfield_10016: { name: 'Story Points' } } });
      return Promise.resolve({
        transitions: [
          {
            id: '41',
            name: 'Close Defect',
            to: { name: 'Closed', statusCategory: { name: 'Done' } },
            fields: {
              cfRootCause: {
                required: true,
                name: 'Defect Root Cause',
                schema: { type: 'option' },
                allowedValues: [{ id: '900', value: 'Code' }, { id: '901', value: 'Config' }],
              },
              cfComponent: {
                required: true,
                name: 'Application Component Selection',
                schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect' },
                allowedValues: [{ id: '800', value: 'Facets', children: [{ id: '810', value: 'Eligibility' }] }],
              },
              cfOptional: { required: false, name: 'Ignored Optional Field', schema: { type: 'string' } },
            },
          },
        ],
      });
    });
    const user = userEvent.setup();
    renderIssueDetailPanel();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Close Defect' })).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByLabelText(/change status/i), '41');

    // Apply stays disabled until every required field is answered — no more blind 400s.
    const applyButton = screen.getByRole('button', { name: /^apply$/i });
    expect(applyButton).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Defect Root Cause'), '900');
    expect(applyButton).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Application Component Selection'), '800');
    await user.selectOptions(screen.getByLabelText('Application Component Selection — detail'), '810');
    expect(applyButton).toBeEnabled();

    await user.click(applyButton);

    await waitFor(() => {
      expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101/transitions', {
        transition: { id: '41' },
        fields: {
          cfRootCause: { id: '900' },
          cfComponent: { id: '800', child: { id: '810' } },
        },
      });
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

  it('shows the points from a dropdown-style field, unwrapping the option object to its label', () => {
    // Teams whose points live in a Select field store an option object, not a number; the input
    // must show its label instead of falling back to a blank (or the wrong legacy field).
    const dropdownIssue = {
      ...TEST_ISSUE,
      fields: { ...TEST_ISSUE.fields, customfield_10028: { id: '9013', value: '13' } },
    } as unknown as JiraIssue;
    render(<IssueDetailPanel isEmbedded issue={dropdownIssue} />);

    expect(screen.getByDisplayValue('13')).toBeInTheDocument();
  });

  it('saves story points through the editmeta-aware writer (numeric field)', async () => {
    const user = userEvent.setup();
    renderIssueDetailPanel();

    const storyPointsField = screen.getByDisplayValue('8');
    await user.clear(storyPointsField);
    await user.type(storyPointsField, '5');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101', {
        fields: { customfield_10016: 5 },
      });
    });
  });

  it('saves story points as the matching OPTION when the project models points as a dropdown (GH #177)', async () => {
    // A raw number 400s on Select fields ("Could not find valid 'id' or 'value' in the Parent
    // Option object") — the shared writer must map 5 to the field's allowed option.
    mockJiraGetByPath(TEST_COMMENTS, {
      customfield_10028: {
        name: 'Story Points',
        allowedValues: [{ id: '9005', value: '5' }],
      },
    });
    const user = userEvent.setup();
    renderIssueDetailPanel();

    const storyPointsField = screen.getByDisplayValue('8');
    await user.clear(storyPointsField);
    await user.type(storyPointsField, '5');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockJiraPut).toHaveBeenCalledWith('/rest/api/2/issue/TBX-101', {
        fields: { customfield_10028: { id: '9005' } },
      });
    });
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
