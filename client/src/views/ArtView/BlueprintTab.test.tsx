// BlueprintTab.test.tsx — TDD tests for the Blueprint tab: PI→Feature→Story hierarchy viewer.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import BlueprintTab from './BlueprintTab.tsx';
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
];

const MOCK_SPRINT_ISSUES_RESPONSE = {
  issues: [
    {
      id: 'ALPHA-1',
      key: 'ALPHA-1',
      fields: {
        summary: 'Build login form',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Story' },
        assignee: { displayName: 'Jane Doe' },
        customfield_10108: 'FEAT-10',
        parent: null,
      },
    },
    {
      id: 'ALPHA-2',
      key: 'ALPHA-2',
      fields: {
        summary: 'Write unit tests',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        issuetype: { name: 'Story' },
        assignee: null,
        customfield_10108: 'FEAT-10',
        parent: null,
      },
    },
  ],
};

const MOCK_FEATURE_RESPONSE = {
  issues: [
    {
      id: 'FEAT-10',
      key: 'FEAT-10',
      fields: {
        summary: 'User Authentication Feature',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Feature' },
        assignee: { displayName: 'Bob Smith' },
      },
    },
  ],
};

describe('BlueprintTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the Load Blueprint button', () => {
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByRole('button', { name: /load blueprint/i })).toBeInTheDocument();
  });

  it('shows a warning when no PI is selected', () => {
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="" />);
    expect(screen.getByText(/no pi selected/i)).toBeInTheDocument();
  });

  it('shows a warning when no teams are configured', () => {
    render(<BlueprintTab teams={[]} selectedPiName="PI 25.1" />);
    expect(screen.getByText(/no teams/i)).toBeInTheDocument();
  });

  it('renders four view mode buttons', () => {
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByRole('button', { name: /full hierarchy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /by team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /features only/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /flat list/i })).toBeInTheDocument();
  });

  it('renders a search bar', () => {
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('shows loading indicator while fetching', () => {
    // Never resolves so we stay in loading state
    mockJiraGet.mockReturnValue(new Promise(() => {}));
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));
    expect(screen.getByText(/loading blueprint/i)).toBeInTheDocument();
  });

  it('renders feature rows after data loads', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_SPRINT_ISSUES_RESPONSE)
      .mockResolvedValueOnce(MOCK_FEATURE_RESPONSE);

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));

    await waitFor(() => {
      expect(screen.getByText('User Authentication Feature')).toBeInTheDocument();
    });
  });

  it('shows story count in feature row after data loads', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_SPRINT_ISSUES_RESPONSE)
      .mockResolvedValueOnce(MOCK_FEATURE_RESPONSE);

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 stories/i)).toBeInTheDocument();
    });
  });

  it('shows completion percentage in the feature health ring', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_SPRINT_ISSUES_RESPONSE)
      .mockResolvedValueOnce(MOCK_FEATURE_RESPONSE);

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));

    await waitFor(() => {
      // 1 of 2 stories done = 50%
      expect(screen.getByText(/50%/)).toBeInTheDocument();
    });
  });

  it('collapses feature children when chevron is clicked', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_SPRINT_ISSUES_RESPONSE)
      .mockResolvedValueOnce(MOCK_FEATURE_RESPONSE);

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));

    await waitFor(() => screen.getByText('User Authentication Feature'));

    // Children are visible initially
    expect(screen.getByText('Build login form')).toBeInTheDocument();

    // Click the collapse button
    const collapseBtn = screen.getByRole('button', { name: /collapse feat-10/i });
    fireEvent.click(collapseBtn);

    // Children should be hidden after collapse
    expect(screen.queryByText('Build login form')).not.toBeInTheDocument();
  });

  it('expands collapsed feature when chevron is clicked again', async () => {
    mockJiraGet
      .mockResolvedValueOnce(MOCK_SPRINT_ISSUES_RESPONSE)
      .mockResolvedValueOnce(MOCK_FEATURE_RESPONSE);

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));
    await waitFor(() => screen.getByText('User Authentication Feature'));

    const collapseBtn = screen.getByRole('button', { name: /collapse feat-10/i });
    fireEvent.click(collapseBtn);
    fireEvent.click(screen.getByRole('button', { name: /expand feat-10/i }));

    expect(screen.getByText('Build login form')).toBeInTheDocument();
  });

  it('filters feature list by search term', async () => {
    const twoFeaturesResponse = {
      issues: [
        ...MOCK_SPRINT_ISSUES_RESPONSE.issues,
        {
          id: 'ALPHA-3',
          key: 'ALPHA-3',
          fields: {
            summary: 'Setup CI pipeline',
            status: { name: 'To Do', statusCategory: { key: 'new' } },
            issuetype: { name: 'Story' },
            assignee: null,
            customfield_10108: 'FEAT-20',
            parent: null,
          },
        },
      ],
    };
    const twoFeaturesDetails = {
      issues: [
        ...MOCK_FEATURE_RESPONSE.issues,
        {
          id: 'FEAT-20',
          key: 'FEAT-20',
          fields: {
            summary: 'CI/CD Infrastructure Feature',
            status: { name: 'To Do', statusCategory: { key: 'new' } },
            issuetype: { name: 'Feature' },
            assignee: null,
          },
        },
      ],
    };

    mockJiraGet
      .mockResolvedValueOnce(twoFeaturesResponse)
      .mockResolvedValueOnce(twoFeaturesDetails);

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));
    await waitFor(() => screen.getByText('User Authentication Feature'));

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'authentication' } });

    expect(screen.getByText('User Authentication Feature')).toBeInTheDocument();
    expect(screen.queryByText('CI/CD Infrastructure Feature')).not.toBeInTheDocument();
  });

  it('shows an error message when the API call fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Network error'));

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('shows empty state message when no feature links found', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ issues: [] })
      .mockResolvedValueOnce({ issues: [] });

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    fireEvent.click(screen.getByRole('button', { name: /load blueprint/i }));

    await waitFor(() => {
      expect(screen.getByText(/no features found/i)).toBeInTheDocument();
    });
  });
});
