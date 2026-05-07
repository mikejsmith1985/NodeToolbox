// ArtView.test.tsx — Unit tests for the ART View tabbed component (7 original + 2 new tabs + PI header + SoS drawer).

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtTab, ArtPersona } from './hooks/useArtData.ts';
import type { JiraIssue } from '../../types/jira.ts';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'overview' as ArtTab,
    persona: 'sm' as ArtPersona,
    teams: [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        sprintIssues: [] as JiraIssue[],
        isLoading: false,
        loadError: null as string | null,
      },
    ],
    selectedPiName: 'PI-2025-Q1',
    isLoadingAllTeams: false,
    sosExpandedTeams: [] as string[],
    boardPrepIssues: [] as Array<{ teamName: string; key: string; summary: string; estimate: number | null; priority: string | null }>,
    isLoadingBoardPrep: false,
    boardPrepError: null as string | null,
    boardPrepTeamFilter: 'all',
    piProgressStats: {
      totalIssues: 10,
      doneCount: 4,
      inProgressCount: 3,
      toDoCount: 3,
      completionPercent: 40,
    },
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setPersona: vi.fn(),
    setSelectedPiName: vi.fn(),
    addTeam: vi.fn(),
    removeTeam: vi.fn(),
    loadAllTeams: vi.fn().mockResolvedValue(undefined),
    loadTeam: vi.fn().mockResolvedValue(undefined),
    toggleSosTeam: vi.fn(),
    loadBoardPrep: vi.fn().mockResolvedValue(undefined),
    setBoardPrepTeamFilter: vi.fn(),
  },
}));

vi.mock('./hooks/useArtData.ts', () => ({
  useArtData: () => ({ state: mockState, actions: mockActions }),
}));

import ArtView from './ArtView.tsx';

describe('ArtView', () => {
  beforeEach(() => {
    mockState.activeTab = 'overview';
    mockState.sosExpandedTeams = [];
    vi.clearAllMocks();
  });

  // ── Original 7-tab tests (must still pass) ──

  it('renders the original 7 tab buttons', () => {
    render(<ArtView />);
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /impediments/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /predictability/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /releases/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /sos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /monthly/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders the 2 new tab buttons: Dependencies and Board Prep', () => {
    render(<ArtView />);
    expect(screen.getByRole('tab', { name: /dependencies/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /board prep/i })).toBeInTheDocument();
  });

  it('shows the persona strip with SM/PO/Dev/QA options', () => {
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /^sm$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^po$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^dev$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^qa$/i })).toBeInTheDocument();
  });

  it('shows the Overview tab with Load All Teams button', () => {
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /load all teams/i })).toBeInTheDocument();
  });

  it('renders a team card for each team in state', () => {
    render(<ArtView />);
    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
  });

  it('shows the Settings tab with add-team form', () => {
    mockState.activeTab = 'settings';
    render(<ArtView />);
    expect(screen.getByPlaceholderText(/team name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/board id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add team/i })).toBeInTheDocument();
  });

  it('shows the Impediments tab', () => {
    mockState.activeTab = 'impediments';
    render(<ArtView />);
    expect(screen.getByRole('tab', { name: /impediments/i })).toBeInTheDocument();
  });

  // ── Feature 3: PI Progress Header ──

  it('renders the PI progress header above the tab bar with PI name', () => {
    render(<ArtView />);
    expect(screen.getByText('PI-2025-Q1')).toBeInTheDocument();
  });

  it('renders PI progress header completion percentage', () => {
    render(<ArtView />);
    expect(screen.getByText(/40%/i)).toBeInTheDocument();
  });

  it('renders done, in-progress, and to-do pills in PI header', () => {
    render(<ArtView />);
    expect(screen.getByText(/4 done/i)).toBeInTheDocument();
    expect(screen.getByText(/3 in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/3 to do/i)).toBeInTheDocument();
  });

  it('shows "No PI selected" placeholder when selectedPiName is empty', () => {
    mockState.selectedPiName = '';
    render(<ArtView />);
    expect(screen.getByText(/no pi selected/i)).toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
  });

  // ── Feature 1: Dependency Map Tab ──

  it('shows the Dependencies tab panel with empty state when no teams have issues', () => {
    mockState.activeTab = 'dependencies';
    render(<ArtView />);
    expect(screen.getByText(/no cross-team dependencies detected/i)).toBeInTheDocument();
  });

  it('shows cross-team dependency SVG when issues reference other teams', () => {
    mockState.activeTab = 'dependencies';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        sprintIssues: [
          {
            id: 'ALPHA-1', key: 'ALPHA-1',
            fields: {
              summary: 'Feature work',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '', updated: '',
              description: 'This depends on BETA-5 to complete',
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
      {
        id: 'team-2',
        name: 'Beta Team',
        boardId: '43',
        sprintIssues: [
          {
            id: 'BETA-5', key: 'BETA-5',
            fields: {
              summary: 'Backend service',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '', updated: '',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    render(<ArtView />);
    // SVG should be rendered when cross-team deps are found
    const svgElement = document.querySelector('svg');
    expect(svgElement).toBeTruthy();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Feature 2: Board Prep Tab ──

  it('shows the Board Prep tab panel with a Load Board Prep button', () => {
    mockState.activeTab = 'boardprep';
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /load board prep/i })).toBeInTheDocument();
  });

  it('shows the Board Prep PI name input field', () => {
    mockState.activeTab = 'boardprep';
    render(<ArtView />);
    expect(screen.getByDisplayValue('PI-2025-Q1')).toBeInTheDocument();
  });

  it('shows Board Prep table headers when issues are loaded', () => {
    mockState.activeTab = 'boardprep';
    mockState.boardPrepIssues = [
      { teamName: 'Alpha Team', key: 'ALPHA-1', summary: 'Ready story', estimate: 3, priority: 'Medium' },
    ];
    render(<ArtView />);
    expect(screen.getByRole('columnheader', { name: /team/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /key/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /summary/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /estimate/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /priority/i })).toBeInTheDocument();
    mockState.boardPrepIssues = [];
  });

  it('shows Export to CSV button in Board Prep when issues are present', () => {
    mockState.activeTab = 'boardprep';
    mockState.boardPrepIssues = [
      { teamName: 'Alpha Team', key: 'ALPHA-1', summary: 'Ready story', estimate: null, priority: null },
    ];
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /export to csv/i })).toBeInTheDocument();
    mockState.boardPrepIssues = [];
  });

  // ── Feature 4: SoS Drawer (enhanced SoS panel) ──

  it('shows the SoS Pulse section when on SoS tab', () => {
    mockState.activeTab = 'sos';
    render(<ArtView />);
    expect(screen.getByText(/pulse/i)).toBeInTheDocument();
  });

  it('shows per-team accordion buttons in SoS tab', () => {
    mockState.activeTab = 'sos';
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /alpha team/i })).toBeInTheDocument();
  });

  it('calls toggleSosTeam when a team accordion header is clicked', () => {
    mockState.activeTab = 'sos';
    render(<ArtView />);
    fireEvent.click(screen.getByRole('button', { name: /alpha team/i }));
    expect(mockActions.toggleSosTeam).toHaveBeenCalledWith('team-1');
  });

  it('shows expanded SoS team content when team is in sosExpandedTeams', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        sprintIssues: [
          {
            id: 'ALPHA-1', key: 'ALPHA-1',
            fields: {
              summary: 'blocked by something',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null,
              assignee: { accountId: 'u1', displayName: 'Jane Doe', emailAddress: 'jane@example.com', avatarUrls: {} },
              reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '', updated: '',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    render(<ArtView />);
    // When expanded, impediments (issues with 'block' in summary) should appear
    expect(screen.getByText(/blocked by something/i)).toBeInTheDocument();
    // Assignee list should appear
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', sprintIssues: [], isLoading: false, loadError: null }];
  });
});
