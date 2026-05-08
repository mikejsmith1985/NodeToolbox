// DependenciesTab.test.tsx — TDD tests for the dependency table that replaces the legacy SVG map.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import DependenciesTab from './DependenciesTab.tsx';
import type { ArtTeam } from './hooks/useArtData.ts';

const MOCK_TEAMS: ArtTeam[] = [
  {
    id: 'team-1',
    name: 'Alpha Team',
    boardId: '42',
    projectKey: 'ALPHA',
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  },
  {
    id: 'team-2',
    name: 'Beta Team',
    boardId: '55',
    projectKey: 'BETA',
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  },
];

// A sprint issue from ALPHA that blocks a BETA issue
const MOCK_ISSUES_WITH_LINKS_RESPONSE = {
  issues: [
    {
      id: 'ALPHA-5',
      key: 'ALPHA-5',
      fields: {
        summary: 'Deploy shared library',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Story' },
        assignee: { displayName: 'Alice' },
        issuelinks: [
          {
            id: 'link-1',
            type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
            outwardIssue: {
              key: 'BETA-7',
              fields: {
                summary: 'Integrate shared library',
                status: { name: 'To Do', statusCategory: { key: 'new' } },
                issuetype: { name: 'Story' },
                assignee: null,
              },
            },
          },
        ],
      },
    },
    {
      id: 'ALPHA-6',
      key: 'ALPHA-6',
      fields: {
        summary: 'Another story',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        issuetype: { name: 'Story' },
        assignee: null,
        issuelinks: [],
      },
    },
    {
      id: 'BETA-7',
      key: 'BETA-7',
      fields: {
        summary: 'Integrate shared library',
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        issuetype: { name: 'Story' },
        assignee: null,
        issuelinks: [
          {
            id: 'link-1',
            type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
            inwardIssue: {
              key: 'ALPHA-5',
              fields: {
                summary: 'Deploy shared library',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                issuetype: { name: 'Story' },
                assignee: { displayName: 'Alice' },
              },
            },
          },
        ],
      },
    },
  ],
};

describe('DependenciesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the Load Dependencies button', () => {
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    expect(screen.getByRole('button', { name: /load dependencies/i })).toBeInTheDocument();
  });

  it('shows empty state message before loading', () => {
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    expect(screen.getByText(/click.*load dependencies/i)).toBeInTheDocument();
  });

  it('shows loading indicator while fetching', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));
    expect(screen.getByText(/loading cross-team dependencies/i)).toBeInTheDocument();
  });

  it('renders a table after loading', async () => {
    mockJiraGet.mockResolvedValue(MOCK_ISSUES_WITH_LINKS_RESPONSE);
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  it('renders the from-issue key in the dependency row', async () => {
    mockJiraGet.mockResolvedValue(MOCK_ISSUES_WITH_LINKS_RESPONSE);
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getByText('ALPHA-5')).toBeInTheDocument();
    });
  });

  it('renders the to-issue key in the dependency row', async () => {
    mockJiraGet.mockResolvedValue(MOCK_ISSUES_WITH_LINKS_RESPONSE);
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getByText('BETA-7')).toBeInTheDocument();
    });
  });

  it('renders the link type label in the row', async () => {
    mockJiraGet.mockResolvedValue(MOCK_ISSUES_WITH_LINKS_RESPONSE);
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/blocks/i).length).toBeGreaterThan(0);
    });
  });

  it('renders team name columns', async () => {
    mockJiraGet.mockResolvedValue(MOCK_ISSUES_WITH_LINKS_RESPONSE);
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getByText('Alpha Team')).toBeInTheDocument();
      expect(screen.getByText('Beta Team')).toBeInTheDocument();
    });
  });

  it('shows no-dependencies message when there are none', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getByText(/no cross-team dependencies/i)).toBeInTheDocument();
    });
  });

  it('renders team filter dropdown', () => {
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    expect(screen.getByRole('combobox', { name: /filter by team/i })).toBeInTheDocument();
  });

  it('renders link type filter dropdown', () => {
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    expect(screen.getByRole('combobox', { name: /filter by link type/i })).toBeInTheDocument();
  });

  it('filters rows by team when team filter is changed', async () => {
    mockJiraGet.mockResolvedValue(MOCK_ISSUES_WITH_LINKS_RESPONSE);
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));
    await waitFor(() => screen.getByRole('table'));

    const teamFilter = screen.getByRole('combobox', { name: /filter by team/i });
    fireEvent.change(teamFilter, { target: { value: 'BETA' } });

    // Should show the row where BETA is involved
    expect(screen.getByText('ALPHA-5')).toBeInTheDocument();
    expect(screen.getByText('BETA-7')).toBeInTheDocument();
  });

  it('shows an error message when the API call fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Connection refused'));
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    fireEvent.click(screen.getByRole('button', { name: /load dependencies/i }));

    await waitFor(() => {
      expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
    });
  });

  it('does not render a table or SVG — is purely tabular', () => {
    render(<DependenciesTab teams={MOCK_TEAMS} />);
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });
});
