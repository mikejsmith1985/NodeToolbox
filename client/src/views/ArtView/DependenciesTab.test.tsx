// DependenciesTab.test.tsx — Integration tests for the legacy-style ART dependency graph tab.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function queueSuccessfulDependencyHierarchy(): void {
  mockJiraGet
    .mockResolvedValueOnce({
      issues: [
        {
          id: 'ALPHA-1',
          key: 'ALPHA-1',
          fields: {
            summary: 'Deploy shared library',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Jane Doe' },
            project: { key: 'ALPHA' },
            customfield_10108: 'FEAT-10',
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
                  },
                },
              },
              {
                id: 'link-2',
                type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
                outwardIssue: {
                  key: 'GAMMA-9',
                  fields: {
                    summary: 'External partner dependency',
                    status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
                    issuetype: { name: 'Story' },
                  },
                },
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      issues: [
        {
          id: 'FEAT-10',
          key: 'FEAT-10',
          fields: {
            summary: 'Authentication hardening',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Feature' },
            customfield_10100: 'PE-1',
            issuelinks: [],
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      issues: [
        {
          id: 'PE-1',
          key: 'PE-1',
          fields: {
            summary: 'Platform resilience',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Program Epic' },
            issuelinks: [],
          },
        },
      ],
    })
    .mockResolvedValueOnce({ issues: [] })
    .mockResolvedValueOnce({ issues: [] })
    .mockResolvedValueOnce({
      issues: [
        {
          id: 'ALPHA-1',
          key: 'ALPHA-1',
          fields: {
            summary: 'Deploy shared library',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Jane Doe' },
            project: { key: 'ALPHA' },
            parent: null,
            customfield_10014: 'FEAT-10',
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
                  },
                },
              },
              {
                id: 'link-2',
                type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
                outwardIssue: {
                  key: 'GAMMA-9',
                  fields: {
                    summary: 'External partner dependency',
                    status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
                    issuetype: { name: 'Story' },
                  },
                },
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValueOnce({ issues: [] });
}

describe('DependenciesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('shows a warning when no PI is selected', () => {
    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="" />);
    expect(screen.getByText(/choose a pi from the selector above/i)).toBeInTheDocument();
  });

  it('renders the Load Dependencies button when a PI is selected', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));
    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByRole('button', { name: /load dependencies|loading|reload dependencies/i })).toBeInTheDocument();
  });

  it('auto-loads the dependency SVG graph after mount', async () => {
    queueSuccessfulDependencyHierarchy();

    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Dependency Graph' })).toBeInTheDocument();
    });

    expect(screen.getByText(/2 links/i)).toBeInTheDocument();
    expect(screen.getByText(/2 cross-team/i)).toBeInTheDocument();
    expect(screen.getByText(/1 off-train/i)).toBeInTheDocument();
  });

  it('opens the issue detail drawer when a graph node is clicked', async () => {
    queueSuccessfulDependencyHierarchy();

    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);

    const alphaNodeButton = await screen.findByRole('button', { name: /open details for alpha-1/i });
    fireEvent.click(alphaNodeButton);

    const detailDrawer = await screen.findByRole('complementary', { name: /dependency details/i });
    expect(within(detailDrawer).getByText('ALPHA-1')).toBeInTheDocument();
    expect(within(detailDrawer).getByText(/deploy shared library/i)).toBeInTheDocument();
    expect(within(detailDrawer).getByRole('link', { name: /open in jira/i })).toHaveAttribute('href', 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/ALPHA-1');
    expect(within(detailDrawer).getByText(/bETA-7/i)).toBeInTheDocument();
  });

  it('filters the graph to off-train edges only', async () => {
    queueSuccessfulDependencyHierarchy();

    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    await screen.findByRole('group', { name: 'Dependency Graph' });

    fireEvent.click(screen.getByLabelText(/off-train only/i));

    expect(screen.queryByRole('button', { name: /open details for beta-7/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for gamma-9/i })).toBeInTheDocument();
    expect(screen.getByText(/showing 1 of 2/i)).toBeInTheDocument();
  });

  it('honors configured dependency link types from ART settings', async () => {
    localStorage.setItem(
      'tbxARTSettings',
      JSON.stringify({ depLinkTypes: ['blocks'] }),
    );
    queueSuccessfulDependencyHierarchy();

    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);

    await waitFor(() => {
      expect(screen.getByText(/1 link/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /open details for gamma-9/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/1 off-train/i)).not.toBeInTheDocument();
  });

  it('renders a dependency graph legend with node and line keys', async () => {
    queueSuccessfulDependencyHierarchy();

    render(<DependenciesTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);

    const dependencyLegend = await screen.findByRole('group', { name: /dependency graph legend/i });
    expect(within(dependencyLegend).getByText('Program Epic')).toBeInTheDocument();
    expect(within(dependencyLegend).getByText('Bug / Defect')).toBeInTheDocument();
    expect(within(dependencyLegend).getByText('Cross-team')).toBeInTheDocument();
    expect(within(dependencyLegend).getByText('Blocking')).toBeInTheDocument();
    expect(within(dependencyLegend).getByText('Off-train')).toBeInTheDocument();
  });
});
