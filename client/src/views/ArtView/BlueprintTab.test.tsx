// BlueprintTab.test.tsx — Integration tests for the Program Epic → Feature → Story Blueprint tab.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function queueSuccessfulBlueprintHierarchy(): void {
  mockJiraGet
    .mockResolvedValueOnce({
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
            project: { key: 'ALPHA' },
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
            summary: 'User Authentication Feature',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Feature' },
            customfield_10100: 'PE-1',
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
            summary: 'Member Onboarding',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Program Epic' },
          },
        },
      ],
    })
    .mockResolvedValueOnce({ issues: [] })
    .mockResolvedValueOnce({ issues: [] })
    .mockResolvedValueOnce({ issues: [] })
    .mockResolvedValueOnce({ issues: [] });
}

describe('BlueprintTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  it('renders the Load Blueprint button', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByRole('button', { name: /load blueprint|loading|reload blueprint/i })).toBeInTheDocument();
  });

  it('shows a warning when no PI is selected', () => {
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="" />);
    expect(screen.getByText(/no pi selected/i)).toBeInTheDocument();
  });

  it('shows a warning when no teams are configured', () => {
    render(<BlueprintTab teams={[]} selectedPiName="PI 25.1" />);
    expect(screen.getByText(/no teams configured/i)).toBeInTheDocument();
  });

  it('renders four Blueprint view mode buttons', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByRole('button', { name: /full hierarchy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /by team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /features only/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /flat list/i })).toBeInTheDocument();
  });

  it('shows a loading indicator while the hierarchy is fetching', () => {
    mockJiraGet.mockReturnValue(new Promise(() => {}));
    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    expect(screen.getByText(/loading blueprint hierarchy/i)).toBeInTheDocument();
  });

  it('auto-loads Program Epic, Feature, and Story rows after mount', async () => {
    queueSuccessfulBlueprintHierarchy();

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);

    await waitFor(() => {
      expect(screen.getByText('PE-1 — Member Onboarding')).toBeInTheDocument();
      expect(screen.getByText('User Authentication Feature')).toBeInTheDocument();
      expect(screen.getByText('Build login form')).toBeInTheDocument();
    });
  });

  it('collapses feature children when the chevron is clicked', async () => {
    queueSuccessfulBlueprintHierarchy();

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    await waitFor(() => screen.getByText('Build login form'));

    fireEvent.click(screen.getByRole('button', { name: /collapse feat-10/i }));
    expect(screen.queryByText('Build login form')).not.toBeInTheDocument();
  });

  it('filters the hierarchy by the search term', async () => {
    queueSuccessfulBlueprintHierarchy();

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);
    await waitFor(() => screen.getByText('User Authentication Feature'));

    fireEvent.change(screen.getByPlaceholderText(/search program epics, features, or stories/i), {
      target: { value: 'missing' },
    });

    expect(screen.queryByText('User Authentication Feature')).not.toBeInTheDocument();
    expect(screen.getByText(/no program epics, features, or stories match/i)).toBeInTheDocument();
  });

  it('uses a PI-aware first query when the team has a project key', async () => {
    queueSuccessfulBlueprintHierarchy();

    render(<BlueprintTab teams={MOCK_TEAMS} selectedPiName="PI 25.1" />);

    await waitFor(() => screen.getByText('User Authentication Feature'));

    const firstCallUrl = mockJiraGet.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain('cf%5B');
    expect(firstCallUrl).toContain('PI%2025.1');
    expect(firstCallUrl).not.toContain('openSprints');
  });

  it('falls back to openSprints JQL when the team does not have a project key', async () => {
    const teamsWithoutProjectKey: ArtTeam[] = [
      { ...MOCK_TEAMS[0], projectKey: undefined },
    ];
    queueSuccessfulBlueprintHierarchy();

    render(<BlueprintTab teams={teamsWithoutProjectKey} selectedPiName="PI 25.1" />);

    await waitFor(() => screen.getByText('User Authentication Feature'));

    const firstCallUrl = mockJiraGet.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain('openSprints');
    expect(firstCallUrl).not.toContain('cf%5B');
  });

  it('renders add-to-canvas checkboxes in selection mode and reports the chosen keys', async () => {
    queueSuccessfulBlueprintHierarchy();
    const onAddToCanvas = vi.fn();
    const onToggle = vi.fn();

    render(
      <BlueprintTab
        teams={MOCK_TEAMS}
        selectedPiName="PI 25.1"
        selectionMode={{ onCanvasKeys: new Set(), selectedKeys: new Set(['FEAT-10']), onToggle, onAddToCanvas }}
      />,
    );

    // Selection mode defaults to the By-Team view, where the feature row carries a checkbox.
    await waitFor(() => expect(screen.getByLabelText('Add FEAT-10 to canvas')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Add FEAT-10 to canvas'));
    expect(onToggle).toHaveBeenCalledWith('FEAT-10');

    // The toolbar "Add to canvas (N)" reflects the selected count and fires the callback.
    fireEvent.click(screen.getByRole('button', { name: /Add to canvas \(1\)/ }));
    expect(onAddToCanvas).toHaveBeenCalled();
  });

  it('disables the checkbox for a feature already on the canvas', async () => {
    queueSuccessfulBlueprintHierarchy();
    render(
      <BlueprintTab
        teams={MOCK_TEAMS}
        selectedPiName="PI 25.1"
        selectionMode={{ onCanvasKeys: new Set(['FEAT-10']), selectedKeys: new Set(), onToggle: vi.fn(), onAddToCanvas: vi.fn() }}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Add FEAT-10 to canvas')).toBeInTheDocument());
    expect((screen.getByLabelText('Add FEAT-10 to canvas') as HTMLInputElement).disabled).toBe(true);
  });
});
