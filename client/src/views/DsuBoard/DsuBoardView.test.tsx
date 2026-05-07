// DsuBoardView.test.tsx — Unit tests for the DSU Board view component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    projectKey: 'TBX',
    staleDays: 5,
    viewMode: 'cards' as 'cards' | 'table',
    sections: [
      { key: 'new', icon: '🆕', label: 'New Since Last Business Day', help: 'Created since 5 PM on the last business day', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: false },
      { key: 'stale', icon: '⚠️', label: 'Stale Issues', help: 'Open issues not updated in N or more days', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: false },
      { key: 'release', icon: '🚀', label: 'Current Release', help: 'Issues targeting the current fix version', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: false },
      { key: 'incidents', icon: '🔥', label: 'PRBs & Incidents', help: 'Issues with INC or PRB in the summary', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: false },
      {
        key: 'open', icon: '📋', label: 'Open Issues', help: 'All issues in To Do or In Progress',
        issues: [
          {
            id: 'TBX-1', key: 'TBX-1',
            fields: {
              summary: 'Fix the login bug',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: { name: 'High', iconUrl: '' },
              assignee: { accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@example.com', avatarUrls: {} },
              reporter: null,
              issuetype: { name: 'Bug', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z',
              updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
        ],
        isLoading: false, loadError: null as string | null, isCollapsed: false,
      },
      { key: 'watching', icon: '👁️', label: 'Watching', help: 'Issues you are currently watching', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: false },
      { key: 'roster-jira', icon: '👥', label: 'Team Active Issues', help: 'Open issues for roster members', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: false },
      { key: 'roster-snow', icon: '🌨️', label: 'Team SNow Tickets', help: 'Active SNow items for roster members', issues: [], isLoading: false, loadError: null as string | null, isCollapsed: true },
    ],
    activeFilters: [] as string[],
    snowUrl: '',
    selectedIssue: null as null | {
      id: string; key: string;
      fields: {
        summary: string;
        status: { name: string; statusCategory: { key: string } };
        priority: { name: string; iconUrl: string } | null;
        assignee: { accountId: string; displayName: string; emailAddress: string; avatarUrls: Record<string, string> } | null;
        reporter: null;
        issuetype: { name: string; iconUrl: string };
        created: string; updated: string; description: string | null;
      };
    },
    isDetailOverlayOpen: false,
    availableTransitions: [] as { id: string; name: string; to: { name: string } }[],
    isLoadingTransitions: false,
    isTransitioning: false,
    transitionError: null as string | null,
    standupNotes: { yesterday: '', today: '', blockers: '', snowUrl: '' },
    isStandupPanelCollapsed: false,
    snowRootCauseUrls: {} as Record<string, string>,
  },
  mockActions: {
    setProjectKey: vi.fn(),
    setStaleDays: vi.fn(),
    setViewMode: vi.fn(),
    toggleSectionCollapse: vi.fn(),
    toggleFilter: vi.fn(),
    setSnowUrl: vi.fn(),
    loadBoard: vi.fn().mockResolvedValue(undefined),
    openDetailOverlay: vi.fn(),
    closeDetailOverlay: vi.fn(),
    loadTransitions: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateStandupNotes: vi.fn(),
    setStandupPanelCollapsed: vi.fn(),
    copyStandupToClipboard: vi.fn(),
    setSnowRootCauseUrl: vi.fn(),
  },
}));

vi.mock('./hooks/useDsuBoardState.ts', () => ({
  useDsuBoardState: () => ({ state: mockState, actions: mockActions }),
}));

import DsuBoardView from './DsuBoardView.tsx';

describe('DsuBoardView', () => {
  beforeEach(() => {
    mockState.viewMode = 'cards';
    mockState.activeFilters = [];
    mockState.isDetailOverlayOpen = false;
    mockState.selectedIssue = null;
    vi.clearAllMocks();
  });

  it('renders the project key input and Refresh button', () => {
    render(<DsuBoardView />);
    expect(screen.getByDisplayValue('TBX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('renders all 8 section headers', () => {
    render(<DsuBoardView />);
    expect(screen.getByText('New Since Last Business Day')).toBeInTheDocument();
    expect(screen.getByText('Stale Issues')).toBeInTheDocument();
    expect(screen.getByText('Current Release')).toBeInTheDocument();
    expect(screen.getByText('PRBs & Incidents')).toBeInTheDocument();
    expect(screen.getByText('Open Issues')).toBeInTheDocument();
    expect(screen.getByText('Watching')).toBeInTheDocument();
    expect(screen.getByText('Team Active Issues')).toBeInTheDocument();
    expect(screen.getByText('Team SNow Tickets')).toBeInTheDocument();
  });

  it('shows a section as collapsed when its isCollapsed flag is true', () => {
    render(<DsuBoardView />);
    expect(screen.getByText('Team SNow Tickets')).toBeInTheDocument();
  });

  it('renders issue cards in cards view mode', () => {
    render(<DsuBoardView />);
    expect(screen.getByText('TBX-1')).toBeInTheDocument();
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument();
  });

  it('renders a table in table view mode', () => {
    mockState.viewMode = 'table';
    render(<DsuBoardView />);
    expect(screen.getAllByRole('columnheader', { name: /key/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: /summary/i })[0]).toBeInTheDocument();
  });

  it('shows the filter bar pills when activeFilters are set', () => {
    mockState.activeFilters = ['Alice'];
    render(<DsuBoardView />);
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
  });

  it('renders the Standup Notes panel by default', () => {
    render(<DsuBoardView />);
    expect(screen.getByText('Standup Notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Yesterday')).toBeInTheDocument();
    expect(screen.getByLabelText('Today')).toBeInTheDocument();
    expect(screen.getByLabelText('Blockers')).toBeInTheDocument();
  });

  it('renders a Copy to Clipboard button in the standup notes panel', () => {
    render(<DsuBoardView />);
    expect(screen.getByRole('button', { name: /copy to clipboard/i })).toBeInTheDocument();
  });

  it('renders the issue detail overlay when isDetailOverlayOpen is true', () => {
    mockState.isDetailOverlayOpen = true;
    mockState.selectedIssue = {
      id: 'TBX-1', key: 'TBX-1',
      fields: {
        summary: 'Fix the login bug',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        priority: { name: 'High', iconUrl: '' },
        assignee: { accountId: 'u1', displayName: 'Alice', emailAddress: 'alice@example.com', avatarUrls: {} },
        reporter: null,
        issuetype: { name: 'Bug', iconUrl: '' },
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-02T00:00:00.000Z',
        description: null,
      },
    };
    render(<DsuBoardView />);
    expect(screen.getByRole('dialog', { name: /issue detail/i })).toBeInTheDocument();
    expect(screen.getAllByText('TBX-1').length).toBeGreaterThan(0);
  });

  it('clicking an issue key button calls openDetailOverlay with the correct issue', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<DsuBoardView />);
    // The issue key is rendered as a button in the card
    const issueKeyButton = screen.getByRole('button', { name: 'TBX-1' });
    await user.click(issueKeyButton);
    expect(mockActions.openDetailOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'TBX-1' }),
    );
  });
});
