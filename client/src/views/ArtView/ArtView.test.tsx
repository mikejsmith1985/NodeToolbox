// ArtView.test.tsx — Unit tests for the ART View tabbed component (7 original + 2 new tabs + PI header + SoS drawer).

import { render, screen, fireEvent, within } from '@testing-library/react';
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
    saveTeams: vi.fn(),
    loadAllTeams: vi.fn().mockResolvedValue(undefined),
    loadTeam: vi.fn().mockResolvedValue(undefined),
    loadPiOptions: vi.fn().mockResolvedValue(undefined),
    toggleSosTeam: vi.fn(),
    loadBoardPrep: vi.fn().mockResolvedValue(undefined),
    setBoardPrepTeamFilter: vi.fn(),
    updateTeamSosKey: vi.fn(),
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

function createLocalYearMonth(): string {
  const currentDate = new Date();
  return `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
}

function createLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

  // ── SoS parity: richer impediment detection ──

  it('counts a flagged issue (customfield_10021) in the SoS Pulse impediment count', () => {
    mockState.activeTab = 'sos';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-30', key: 'ALPHA-30',
            fields: {
              // Summary does NOT contain "block" — only the flag field triggers impediment detection
              summary: 'Flagged task no block keyword',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              customfield_10021: true,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // Pulse should show 1 impediment because the flagged field triggers detection
    expect(screen.getByText(/1 impediment/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a label-blocked issue in the SoS accordion impediment list', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-31', key: 'ALPHA-31',
            fields: {
              summary: 'Label only impediment',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              labels: ['blocked'],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // The issue should appear in the accordion's impediment list
    expect(screen.getAllByText(/label only impediment/i).length).toBeGreaterThanOrEqual(1);
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── SoS parity: date picker ──

  it('renders a date selector in the SoS panel', () => {
    mockState.activeTab = 'sos';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /select sos date/i })).toBeInTheDocument();
  });

  it('reloads the stored SoS narrative when the selected SoS date changes', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    const currentDate = new Date();
    const todayDateString = createLocalDateString(currentDate);
    const previousDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 1);
    const previousDateString = createLocalDateString(previousDate);
    localStorage.setItem(
      `tbxSosNarrative_team-1_${todayDateString}`,
      JSON.stringify({
        yesterday: 'Yesterday update',
        today: 'Today update',
        blockers: 'None',
        risks: 'None',
        dependencies: 'None',
        editedAt: {},
      }),
    );
    localStorage.setItem(
      `tbxSosNarrative_team-1_${previousDateString}`,
      JSON.stringify({
        yesterday: 'Previous day update',
        today: 'Previous day plan',
        blockers: 'Waiting',
        risks: 'Low',
        dependencies: 'Platform',
        editedAt: {},
      }),
    );

    renderArtView();

    fireEvent.change(screen.getByRole('combobox', { name: /select sos date/i }), {
      target: { value: previousDateString },
    });

    expect(screen.getByRole('textbox', { name: /yesterday narrative for alpha team/i })).toHaveValue('Previous day update');
    expect(screen.getByRole('textbox', { name: /today narrative for alpha team/i })).toHaveValue('Previous day plan');

    localStorage.removeItem(`tbxSosNarrative_team-1_${todayDateString}`);
    localStorage.removeItem(`tbxSosNarrative_team-1_${previousDateString}`);
    mockState.sosExpandedTeams = [];
  });

  // ── SoS parity: copy SoS report ──

  it('renders a Copy SoS Report button in the SoS panel', () => {
    mockState.activeTab = 'sos';
    renderArtView();
    expect(screen.getByRole('button', { name: /copy sos report/i })).toBeInTheDocument();
  });

  // ── SoS parity: per-team completion badge in accordion header ──

  it('shows per-team issue count in the SoS accordion header', () => {
    mockState.activeTab = 'sos';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-32', key: 'ALPHA-32',
            fields: {
              summary: 'Some task',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
          {
            id: 'ALPHA-33', key: 'ALPHA-33',
            fields: {
              summary: 'Another task',
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
    // The accordion header button should display "2 issues" or similar completion info
    expect(screen.getByText(/2 issues/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
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

  // ── Monthly Report parity: pillar filter ──

  it('renders a pillar filter dropdown in the Monthly Report toolbar', () => {
    mockState.activeTab = 'monthly';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /filter by pillar/i })).toBeInTheDocument();
  });

  it('hides a card when the selected pillar does not match it', () => {
    mockState.activeTab = 'monthly';
    // Pre-seed localStorage so the Alpha Team card has a pillar of 'Growth'
    const yearMonth = createLocalYearMonth();
    localStorage.setItem(
      `tbxMonthlyReport_team-1_${yearMonth}`,
      JSON.stringify({ teamId: 'team-1', teamName: 'Alpha Team', accomplished: '', outcomes: '', risks: '', stakeholders: '', pillar: 'Growth' }),
    );
    mockState.teams = [
      { id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null },
      { id: 'team-2', name: 'Beta Team', boardId: '43', projectKey: '', sprintIssues: [], isLoading: false, loadError: null },
    ];
    renderArtView();
    const pillarFilter = screen.getByRole('combobox', { name: /filter by pillar/i });
    fireEvent.change(pillarFilter, { target: { value: 'Affordability' } });
    // Alpha Team's card has Growth pillar, not Affordability — the card editor should be hidden.
    // We check for the pillar select's aria-label which is unique to the card (not the filter dropdowns).
    expect(screen.queryByRole('combobox', { name: /pillar for alpha team/i })).not.toBeInTheDocument();
    localStorage.removeItem(`tbxMonthlyReport_team-1_${yearMonth}`);
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Monthly Report parity: draft indicator ──

  it('shows a draft indicator on a Monthly Report card that has content', () => {
    mockState.activeTab = 'monthly';
    const yearMonth = createLocalYearMonth();
    localStorage.setItem(
      `tbxMonthlyReport_team-1_${yearMonth}`,
      JSON.stringify({ teamId: 'team-1', teamName: 'Alpha Team', accomplished: 'Shipped feature X', outcomes: '', risks: '', stakeholders: '', pillar: '' }),
    );
    renderArtView();
    // A visual draft indicator (e.g. "Draft" text or checkmark) should be present
    expect(screen.getByTitle(/draft/i)).toBeInTheDocument();
    localStorage.removeItem(`tbxMonthlyReport_team-1_${yearMonth}`);
  });

  // ── Monthly Report parity: export text ──

  it('renders an Export Text button in the Monthly Report toolbar', () => {
    mockState.activeTab = 'monthly';
    renderArtView();
    expect(screen.getByRole('button', { name: /export text/i })).toBeInTheDocument();
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

  // ── Feature: handlePiFieldChange only reloads PI options when field ID is complete ──

  it('does not call loadPiOptions when PI field input has partial text in fallback path', async () => {
    // Make the Jira fields API fail so JiraFieldPicker renders the fallback text input
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.reject(new Error('Jira unavailable'));
      return Promise.resolve({ values: [] });
    });

    mockState.activeTab = 'settings';
    renderArtView();

    // Wait for the fallback input to appear after the fields API fails
    const piInput = await screen.findByRole('textbox', { name: /pi field/i });

    // Type a partial (incomplete) custom field ID — no reload should fire
    fireEvent.change(piInput, { target: { value: 'customfield_' } });
    expect(mockActions.loadPiOptions).not.toHaveBeenCalled();

    fireEvent.change(piInput, { target: { value: 'customfield_103' } });
    expect(mockActions.loadPiOptions).not.toHaveBeenCalled();
  });

  it('calls loadPiOptions when PI field is set to a complete custom field ID in fallback path', async () => {
    // Make the Jira fields API fail so JiraFieldPicker renders the fallback text input
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') return Promise.reject(new Error('Jira unavailable'));
      return Promise.resolve({ values: [] });
    });

    mockState.activeTab = 'settings';
    renderArtView();

    const piInput = await screen.findByRole('textbox', { name: /pi field/i });

    // A fully-formed field ID must trigger the reload exactly once
    fireEvent.change(piInput, { target: { value: 'customfield_10301' } });
    expect(mockActions.loadPiOptions).toHaveBeenCalledTimes(1);
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

  // ── Risk/Forecast: Impediments parity ──

  it('shows a flagged issue (customfield_10021) in the Impediments tab even without "block" in status', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-10', key: 'ALPHA-10',
            fields: {
              summary: 'Flagged story without block status',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              customfield_10021: true,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('ALPHA-10')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a blocked-link issue in the Impediments tab when an "is blocked by" link is present', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-11', key: 'ALPHA-11',
            fields: {
              summary: 'Story with blocked-by link',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              issuelinks: [
                {
                  type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
                  inwardIssue: { key: 'OTHER-1', fields: { summary: 'Blocking issue', status: { name: 'In Progress' } } },
                },
              ],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('ALPHA-11')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a label-blocked issue in the Impediments tab when labels include "blocked"', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-12', key: 'ALPHA-12',
            fields: {
              summary: 'Story labelled as blocked',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              labels: ['blocked', 'needs-review'],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('ALPHA-12')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a Reason column in the Impediments table', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-7', key: 'ALPHA-7',
            fields: {
              summary: 'Blocked release task',
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
    expect(screen.getByRole('columnheader', { name: /reason/i })).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows "Blocked Status" reason label for a status-blocked issue in the Impediments tab', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-7', key: 'ALPHA-7',
            fields: {
              summary: 'Blocked release task',
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
    expect(screen.getByText(/blocked status/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  // ── Risk/Forecast: Predictability parity ──

  it('shows the Predictability tab with a per-team metrics table', () => {
    mockState.activeTab = 'predictability';
    renderArtView();
    expect(screen.getByRole('columnheader', { name: /team/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /done/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /total/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows completion percentage per team in the Predictability tab', () => {
    mockState.activeTab = 'predictability';
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
              summary: 'Done story',
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
              summary: 'In progress story',
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
    // 1 done out of 2 total = 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows story points done when issues have story point estimates in Predictability tab', () => {
    mockState.activeTab = 'predictability';
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
              summary: 'Done story with points',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              customfield_10016: 5,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // Should show story points column header and at least one value of "5" (done = 5, total = 5)
    expect(screen.getByRole('columnheader', { name: /pts done/i })).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows "No teams loaded" empty state in Predictability tab when teams array is empty', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [];
    renderArtView();
    expect(screen.getByText(/no teams loaded/i)).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Risk/Forecast: Releases parity ──

  it('shows fix version name in the Releases tab when issues have fixVersions', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-20', key: 'ALPHA-20',
            fields: {
              summary: 'Feature for v2.0',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v2.0', releaseDate: '2025-06-01', released: false }],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('v2.0')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows release date in the Releases tab when available', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-21', key: 'ALPHA-21',
            fields: {
              summary: 'Release story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v2.1', releaseDate: '2025-07-15', released: false }],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('2025-07-15')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows done and total issue counts per fix version in the Releases tab', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-22', key: 'ALPHA-22',
            fields: {
              summary: 'Done story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v3.0', released: false }],
            },
          },
          {
            id: 'ALPHA-23', key: 'ALPHA-23',
            fields: {
              summary: 'In progress story',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v3.0', released: false }],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // 1 done, 2 total → "1 / 2"
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows an empty state message in Releases tab when no issues have fix versions', () => {
    mockState.activeTab = 'releases';
    renderArtView();
    expect(screen.getByText(/no release data found/i)).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows team name in Releases tab for a fix version', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-24', key: 'ALPHA-24',
            fields: {
              summary: 'Feature',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v4.0', released: false }],
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Settings parity: missing settings fields ──

  it('shows PI End Date input in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('textbox', { name: /pi end date/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows Sprint Window Days input in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('spinbutton', { name: /sprint window days/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows Story Points Auto-detect checkbox in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('checkbox', { name: /auto-detect story points/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows P-Code Field picker in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /p-code field/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows SoS Issue Key input per team in Settings team list', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    // The per-team SoS Issue Key input for "Alpha Team" should be present
    expect(screen.getByRole('textbox', { name: /sos issue key for alpha team/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('calls updateTeamSosKey when a team SoS Issue Key input changes', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    fireEvent.change(screen.getByRole('textbox', { name: /sos issue key for alpha team/i }), {
      target: { value: 'ALPHA-SOS' },
    });
    expect(mockActions.updateTeamSosKey).toHaveBeenCalledWith('team-1', 'ALPHA-SOS');
    mockState.activeTab = 'overview';
  });

  it('persists PI End Date to localStorage when the input value changes', () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    renderArtView();

    fireEvent.change(screen.getByRole('textbox', { name: /pi end date/i }), {
      target: { value: '2025-09-30' },
    });

    const stored = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as { piEndDate?: string };
    expect(stored.piEndDate).toBe('2025-09-30');

    localStorage.removeItem('tbxARTSettings');
    mockState.activeTab = 'overview';
  });

  it('persists Sprint Window Days to localStorage when the input value changes', () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    renderArtView();

    fireEvent.change(screen.getByRole('spinbutton', { name: /sprint window days/i }), {
      target: { value: '10' },
    });

    const stored = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as { sprintWindowDays?: number };
    expect(stored.sprintWindowDays).toBe(10);

    localStorage.removeItem('tbxARTSettings');
    mockState.activeTab = 'overview';
  });

  // ── art-overview-advanced: ART Summary Bar ──

  it('renders the ART summary bar region in the Overview tab when teams are configured', () => {
    renderArtView();
    expect(screen.getByRole('region', { name: /art summary/i })).toBeInTheDocument();
  });

  it('does not render the ART summary bar when no teams are configured', () => {
    mockState.teams = [];
    renderArtView();
    expect(screen.queryByTestId('art-summary-bar')).not.toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows 0 / 1 teams loaded in the ART summary bar when a team has no issues fetched yet', () => {
    // Default team has sprintIssues=[] so it counts as not loaded
    renderArtView();
    const summaryBar = screen.getByTestId('art-summary-bar');
    expect(within(summaryBar).getByText('0 / 1')).toBeInTheDocument();
  });

  it('shows 1 / 1 teams loaded in the ART summary bar when a team has at least one issue loaded', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-OVA-1', key: 'TBX-OVA-1',
            fields: {
              summary: 'A loaded story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
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
    // Scope to the teams-loaded cell to avoid collision with the issues-done cell, which also shows "1 / 1"
    const teamsCell = screen.getByTestId('art-summary-teams-loaded');
    expect(within(teamsCell).getByText('1 / 1')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows the blocked stat in the ART summary bar when impediments exist', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-OVA-2', key: 'TBX-OVA-2',
            fields: {
              summary: 'A blocked story',
              status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-01T00:00:00.000Z',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // The summary bar uses data-testid to avoid text clashing with the per-team card chips
    expect(screen.getByTestId('art-summary-blocked')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('does not show the blocked stat in the ART summary bar when there are no impediments', () => {
    // Default team has no issues loaded
    renderArtView();
    expect(screen.queryByTestId('art-summary-blocked')).not.toBeInTheDocument();
  });

  it('shows story points rollup in the ART summary bar when issues carry estimates', () => {
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-OVA-3', key: 'TBX-OVA-3',
            fields: {
              summary: 'Estimated story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-01T00:00:00.000Z',
              description: null,
              customfield_10016: 8,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByTestId('art-summary-story-points')).toBeInTheDocument();
    // 8 done out of 8 total
    const summaryBar = screen.getByTestId('art-summary-bar');
    expect(within(summaryBar).getByText('8 / 8')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('does not show story points in the ART summary bar when no issues carry estimates', () => {
    // Default team has no issues
    renderArtView();
    expect(screen.queryByTestId('art-summary-story-points')).not.toBeInTheDocument();
  });

  it('shows days remaining in the ART summary bar when piEndDate is configured', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const futureDateString = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piEndDate: futureDateString }));

    renderArtView();
    expect(screen.getByTestId('art-summary-days-remaining')).toBeInTheDocument();

    localStorage.removeItem('tbxARTSettings');
  });

  it('does not show days remaining in the ART summary bar when piEndDate is not configured', () => {
    localStorage.removeItem('tbxARTSettings');
    renderArtView();
    expect(screen.queryByTestId('art-summary-days-remaining')).not.toBeInTheDocument();
  });

  it('shows an overdue indicator in the ART summary bar when the PI end date has passed', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 3);
    const pastDateString = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-${String(pastDate.getDate()).padStart(2, '0')}`;
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piEndDate: pastDateString }));

    renderArtView();
    expect(screen.getByTestId('art-summary-days-remaining')).toHaveTextContent(/overdue/i);

    localStorage.removeItem('tbxARTSettings');
  });

  // ── art-overview-advanced: PI Progress Header days remaining ──

  it('shows a days-remaining badge in the PI progress header when piEndDate is configured', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const futureDateString = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piEndDate: futureDateString }));

    renderArtView();
    expect(screen.getByTestId('pi-days-remaining')).toBeInTheDocument();

    localStorage.removeItem('tbxARTSettings');
  });

  it('does not render a days-remaining badge in the PI progress header when piEndDate is not set', () => {
    localStorage.removeItem('tbxARTSettings');
    renderArtView();
    expect(screen.queryByTestId('pi-days-remaining')).not.toBeInTheDocument();
  });

  it('shows overdue label in the PI progress header when PI end date has passed', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    const pastDateString = `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-${String(pastDate.getDate()).padStart(2, '0')}`;
    localStorage.setItem('tbxARTSettings', JSON.stringify({ piEndDate: pastDateString }));

    renderArtView();
    expect(screen.getByTestId('pi-days-remaining')).toHaveTextContent(/overdue/i);

    localStorage.removeItem('tbxARTSettings');
  });
});


