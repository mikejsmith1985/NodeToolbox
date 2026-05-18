// ArtView.test.tsx — Unit tests for the ART View tabbed component (7 original + 2 new tabs + PI header + SoS drawer).

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtTab, ArtTeam } from './hooks/useArtData.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { ToastProvider } from '../../components/Toast/ToastProvider.tsx';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'overview' as ArtTab,
    teams: [
      {
        id: 'team-1',
        name: 'Alpha Team',
          boardId: '42',
          boardName: 'Transformers Board',
          projectKey: '',
        sprintIssues: [] as JiraIssue[],
        isLoading: false,
        loadError: null as string | null,
      },
    ] as ArtTeam[],
    selectedPiName: 'PI-2025-Q1',
    availablePiNames: ['PI-2025-Q2', 'PI-2025-Q1'],
    isLoadingPiOptions: false,
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
    setSelectedPiName: vi.fn(),
    addTeam: vi.fn(),
    removeTeam: vi.fn(),
    loadAllTeams: vi.fn().mockResolvedValue(undefined),
    loadTeam: vi.fn().mockResolvedValue(undefined),
    loadPiOptions: vi.fn().mockResolvedValue(undefined),
    toggleSosTeam: vi.fn(),
    loadBoardPrep: vi.fn().mockResolvedValue(undefined),
    setBoardPrepTeamFilter: vi.fn(),
  },
}));

vi.mock('./hooks/useArtData.ts', () => ({
  useArtData: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
  jiraPut: vi.fn(),
}));

import ArtView from './ArtView.tsx';

function renderArtView() {
  return render(
    <ToastProvider>
      <ArtView />
    </ToastProvider>,
  );
}

describe('ArtView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.activeTab = 'overview';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardName: 'Transformers Board',
        projectKey: '',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    mockState.sosExpandedTeams = [];
    mockState.selectedPiName = 'PI-2025-Q1';
    mockState.availablePiNames = ['PI-2025-Q2', 'PI-2025-Q1'];
    mockState.isLoadingPiOptions = false;
    mockState.boardPrepIssues = [];
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') {
        return Promise.resolve([]);
      }
      if (path === '/rest/api/2/project') {
        return Promise.resolve([]);
      }

      return Promise.resolve({ values: [] });
    });
  });

  // ── Original 7-tab tests (must still pass) ──

  it('renders the original 7 tab buttons', () => {
    renderArtView();
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /impediments/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /predictability/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /releases/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /sos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /monthly/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders the 2 new tab buttons: Dependencies and Board Prep', () => {
    renderArtView();
    expect(screen.getByRole('tab', { name: /dependencies/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /board prep/i })).toBeInTheDocument();
  });

  it('shows the Overview tab with Load All Teams button', () => {
    renderArtView();
    expect(screen.getByRole('button', { name: /load all teams/i })).toBeInTheDocument();
  });

  it('renders a project key filter input above the overview team list', () => {
    renderArtView();

    expect(screen.getByRole('searchbox', { name: '' })).toHaveAttribute('placeholder', 'Filter by project key…');
  });

  it('renders a team card for each team in state', () => {
    renderArtView();
    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
  });

  it('filters overview team cards by project key text', () => {
    mockState.teams = [
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
        boardId: '99',
        projectKey: 'BETA',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];

    renderArtView();
    fireEvent.change(screen.getByPlaceholderText(/filter by project key/i), {
      target: { value: 'beta' },
    });

    expect(screen.getByText('Beta Team')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Team')).not.toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows the Settings tab with add-team form', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByPlaceholderText(/team name/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /board/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add team/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save teams/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows the Impediments tab', () => {
    mockState.activeTab = 'impediments';
    renderArtView();
    expect(screen.getByRole('tab', { name: /impediments/i })).toBeInTheDocument();
  });

  it('renders expand buttons on impediment rows', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: '',
        sprintIssues: [
          {
            id: 'ALPHA-7',
            key: 'ALPHA-7',
            fields: {
              summary: 'Blocked release task',
              status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
              priority: null,
              assignee: null,
              reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z',
              updated: '2025-01-02T00:00:00.000Z',
              description: 'Waiting on another team.',
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();

    expect(screen.getByRole('button', { name: /expand details for alpha-7/i })).toBeInTheDocument();

    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Feature 3: PI Progress Header ──

  it('renders the PI progress header above the tab bar with PI name', () => {
    renderArtView();
    expect(screen.getByRole('combobox', { name: /program increment/i })).toHaveValue('PI-2025-Q1');
  });

  it('renders a Program Increment selector in the header', () => {
    renderArtView();
    expect(screen.getByRole('combobox', { name: /program increment/i })).toBeInTheDocument();
  });

  it('updates the selected PI when the header selector changes', () => {
    renderArtView();

    fireEvent.change(screen.getByRole('combobox', { name: /program increment/i }), {
      target: { value: 'PI-2025-Q2' },
    });

    expect(mockActions.setSelectedPiName).toHaveBeenCalledWith('PI-2025-Q2');
  });

  it('renders PI progress header completion percentage', () => {
    renderArtView();
    expect(screen.getByText(/40%/i)).toBeInTheDocument();
  });

  it('renders done, in-progress, and to-do pills in PI header', () => {
    renderArtView();
    expect(screen.getByText(/4 done/i)).toBeInTheDocument();
    expect(screen.getByText(/3 in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/3 to do/i)).toBeInTheDocument();
  });

  it('shows "No PI selected" placeholder when selectedPiName is empty', () => {
    mockState.selectedPiName = '';
    renderArtView();
    expect(screen.getByText(/no pi selected/i)).toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
  });

  it('shows the board name on overview team cards when Jira metadata is available', () => {
    renderArtView();

    expect(screen.getByText('Transformers Board')).toBeInTheDocument();
    expect(screen.queryByText('Board 42')).not.toBeInTheDocument();
  });

  // ── Feature 1: Dependency Tab (table-based, no SVG) ──

  it('shows the Dependencies tab panel with a Load Dependencies button', () => {
    mockState.activeTab = 'dependencies';
    renderArtView();
    expect(screen.getByRole('button', { name: /load dependencies/i })).toBeInTheDocument();
  });

  it('does not render an SVG in the Dependencies tab — it is table-based', () => {
    mockState.activeTab = 'dependencies';
    renderArtView();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });

  // ── Feature 2: Board Prep Tab ──

  it('shows the Board Prep tab panel with a Load Board Prep button', () => {
    mockState.activeTab = 'boardprep';
    renderArtView();
    expect(screen.getByRole('button', { name: /load board prep/i })).toBeInTheDocument();
  });

  it('shows the Board Prep PI name input field', () => {
    mockState.activeTab = 'boardprep';
    renderArtView();
    expect(screen.getByRole('textbox', { name: /board prep pi name/i })).toHaveValue('PI-2025-Q1');
  });

  it('shows Board Prep table headers when issues are loaded', () => {
    mockState.activeTab = 'boardprep';
    mockState.boardPrepIssues = [
      { teamName: 'Alpha Team', key: 'ALPHA-1', summary: 'Ready story', estimate: 3, priority: 'Medium' },
    ];
    renderArtView();
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
    renderArtView();
    expect(screen.getByRole('button', { name: /export to csv/i })).toBeInTheDocument();
    mockState.boardPrepIssues = [];
  });

  // ── Feature 4: SoS Drawer (enhanced SoS panel) ──

  it('shows the SoS Pulse section when on SoS tab', () => {
    mockState.activeTab = 'sos';
    renderArtView();
    expect(screen.getByText(/pulse/i)).toBeInTheDocument();
  });

  it('shows per-team accordion buttons in SoS tab', () => {
    mockState.activeTab = 'sos';
    renderArtView();
    expect(screen.getByRole('button', { name: /alpha team/i })).toBeInTheDocument();
  });

  it('calls toggleSosTeam when a team accordion header is clicked', () => {
    mockState.activeTab = 'sos';
    renderArtView();
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
        projectKey: '',
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
    renderArtView();
    // When expanded, impediments (issues with 'block' in summary) should appear
    // getAllByText used because the auto-generated narrative textarea may also contain this text
    expect(screen.getAllByText(/blocked by something/i).length).toBeGreaterThanOrEqual(1);
    // Assignee list should appear
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Feature: Blueprint Tab ──

  it('renders a Blueprint tab button', () => {
    renderArtView();
    expect(screen.getByRole('tab', { name: /blueprint/i })).toBeInTheDocument();
  });

  it('shows no-PI warning when Blueprint tab is active and no PI is set', () => {
    mockState.activeTab = 'blueprint';
    mockState.selectedPiName = '';
    renderArtView();
    // Check for the specific message shown only by BlueprintTab (the PI header shows "No PI selected" too)
    expect(screen.getByText(/choose a pi name/i)).toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
  });

  it('shows the Load Blueprint button when a PI is selected', () => {
    mockState.activeTab = 'blueprint';
    mockState.selectedPiName = 'PI-2025-Q1';
    renderArtView();
    expect(screen.getByRole('button', { name: /load blueprint/i })).toBeInTheDocument();
  });

  // ── Feature: SoS Narrative Fields ──

  it('shows SoS narrative textarea fields when a team accordion is expanded', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    renderArtView();
    // All 5 narrative sections should have textareas
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(5);
    mockState.sosExpandedTeams = [];
  });

  // ── Feature: Monthly Report ──

  it('shows the Monthly Report tab with a month selector', () => {
    mockState.activeTab = 'monthly';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /select month/i })).toBeInTheDocument();
  });

  it('shows Copy All and Export HTML buttons in Monthly Report tab', () => {
    mockState.activeTab = 'monthly';
    renderArtView();
    expect(screen.getByRole('button', { name: /copy all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export html/i })).toBeInTheDocument();
  });

  // ── Feature: Advanced ART Settings ──

  it('shows PI Field picker in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /pi field/i })).toBeInTheDocument();
  });

  it('shows Story Points Field picker in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /story points field/i })).toBeInTheDocument();
  });

  it('shows Feature Link Field picker in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /feature link field/i })).toBeInTheDocument();
  });

  it('shows Stale Days Threshold input in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('spinbutton', { name: /stale days threshold/i })).toBeInTheDocument();
  });

  it('shows Project picker in Settings add-team form', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /project/i })).toBeInTheDocument();
  });

  it('shows the board name in the settings team list when Jira metadata is available', () => {
    mockState.activeTab = 'settings';
    renderArtView();

    expect(screen.getByText('Transformers Board')).toBeInTheDocument();
    expect(screen.queryByText('Board 42')).not.toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  // ── Overview parity: board type badge ──

  it('shows a SCRUM badge on team cards when boardType is scrum', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('SCRUM')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a KANBAN badge on team cards when boardType is kanban', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'kanban' as const,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('KANBAN')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('does not show a board type badge when boardType is absent', () => {
    // default beforeEach teams have no boardType set
    renderArtView();
    expect(screen.queryByText('SCRUM')).not.toBeInTheDocument();
    expect(screen.queryByText('KANBAN')).not.toBeInTheDocument();
  });

  it('shows the active sprint name on Scrum team cards when not in PI mode', () => {
    mockState.selectedPiName = '';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        activeSprintName: 'Sprint 14',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('Sprint 14')).toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('hides the sprint name on Scrum team cards when PI mode is active', () => {
    mockState.selectedPiName = 'PI 25.3';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        activeSprintName: 'Sprint 14',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.queryByText('Sprint 14')).not.toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows done and in-progress counts on team cards when issues are loaded', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-1', key: 'TBX-1',
            fields: {
              summary: 'Task A',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
          {
            id: 'TBX-2', key: 'TBX-2',
            fields: {
              summary: 'Task B',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText(/1 done/i)).toBeInTheDocument();
    expect(screen.getByText(/1 in progress/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a blocked badge on team cards when blocked issues are present', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-3', key: 'TBX-3',
            fields: {
              summary: 'Blocked story',
              status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText(/1 blocked/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a stale badge on team cards when in-progress issues have not been updated recently', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-4', key: 'TBX-4',
            fields: {
              summary: 'Stale story',
              // Very old update date guarantees staleness regardless of threshold setting
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2020-01-01T00:00:00.000Z', updated: '2020-01-01T00:00:00.000Z',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText(/1 stale/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });
});


