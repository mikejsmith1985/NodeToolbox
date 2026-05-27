// ArtView.test.tsx — Unit tests for the ART View tabbed component (7 original + 2 new tabs + PI header + SoS drawer + Jira sync).

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtTab, ArtTeam } from './hooks/useArtData.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { ToastProvider } from '../../components/Toast/ToastProvider.tsx';

const {
  mockCreateConfluenceDatabase,
  mockJiraGet,
  mockJiraPost,
  mockFetchConfluencePage,
  mockLoadSharedArtWorkspace,
  mockSaveSharedArtWorkspace,
  mockUpdateConfluencePage,
} = vi.hoisted(() => ({
  mockCreateConfluenceDatabase: vi.fn(),
  mockJiraGet: vi.fn(),
  // Hoisted so tests can assert on calls to the Jira comment post endpoint.
  mockJiraPost: vi.fn(),
  mockFetchConfluencePage: vi.fn(),
  mockLoadSharedArtWorkspace: vi.fn(),
  mockSaveSharedArtWorkspace: vi.fn(),
  mockUpdateConfluencePage: vi.fn(),
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
    replaceTeams: vi.fn(),
    removeTeam: vi.fn(),
    saveTeams: vi.fn(),
    loadAllTeams: vi.fn().mockResolvedValue(undefined),
    loadTeam: vi.fn().mockResolvedValue(undefined),
    loadPiOptions: vi.fn().mockResolvedValue(undefined),
    toggleSosTeam: vi.fn(),
    loadBoardPrep: vi.fn().mockResolvedValue(undefined),
    setBoardPrepTeamFilter: vi.fn(),
    updateTeamSosKey: vi.fn(),
    updateTeamPiReviewPageUrl: vi.fn(),
  },
}));

vi.mock('./hooks/useArtData.ts', () => ({
  useArtData: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
  jiraPut: vi.fn(),
}));

vi.mock('../../services/confluenceApi.ts', () => ({
  createConfluenceDatabase: mockCreateConfluenceDatabase,
  fetchConfluencePage: mockFetchConfluencePage,
  fetchConfluencePageByReference: mockFetchConfluencePage,
  loadSharedArtWorkspace: mockLoadSharedArtWorkspace,
  resolveConfluencePageIdFromReference: vi.fn(),
  saveSharedArtWorkspace: mockSaveSharedArtWorkspace,
  updateConfluencePage: mockUpdateConfluencePage,
}));

import ArtView from './ArtView.tsx';

const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);
const SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY = 'tbxSharedArtSyncSnapshots';

class MockClipboardItem {
  items: Record<string, Blob>;

  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

function renderArtView() {
  return render(
    <ToastProvider>
      <ArtView />
    </ToastProvider>,
  );
}

function seedSharedArtWorkspaceSettings(sharedArtSettings: {
  sharedArtName?: string;
  sharedArtKey?: string;
  sharedArtDatabaseId?: string;
  sharedArtSpaceId?: string;
  sharedArtParentId?: string;
}) {
  localStorage.setItem('tbxARTSettings', JSON.stringify(sharedArtSettings));
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
    localStorage.clear();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        write: mockClipboardWrite,
        writeText: mockClipboardWriteText,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'ClipboardItem', {
      value: MockClipboardItem,
      configurable: true,
    });
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
    mockCreateConfluenceDatabase.mockResolvedValue({
      id: 'db-123',
      type: 'database',
      title: 'Systems Team',
      spaceId: '77',
    });
    mockLoadSharedArtWorkspace.mockResolvedValue({
      schemaVersion: 1,
      artKey: 'S2E',
      artName: 'Systems Team',
      updatedAt: '2026-05-20T12:00:00.000Z',
      teams: [
        {
          id: 'shared-team-1',
          name: 'Shared Alpha',
          boardId: '42',
          boardName: 'Transformers Board',
          projectKey: 'ALPHA',
          sosIssueKey: 'ALPHA-1',
        },
      ],
      settings: {
        piFieldId: 'customfield_10301',
        depLinkTypes: ['blocks'],
        staleDays: 5,
        sprintWindowDays: 10,
      },
    });
    mockSaveSharedArtWorkspace.mockResolvedValue({
      id: 'prop-1',
      key: 'nodetoolbox-shared-art',
      version: { number: 1 },
      value: undefined,
    });
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') {
        return Promise.resolve([]);
      }
      if (path === '/rest/api/2/project') {
        return Promise.resolve([]);
      }
      if (path === '/rest/api/2/issueLinkType') {
        return Promise.resolve({ issueLinkTypes: [] });
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

  it('renders the additional ART tab buttons with PI Review as the capacity planning home', () => {
    renderArtView();
    expect(screen.getByRole('tab', { name: /pi review/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /capacity/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /dependencies/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /board prep/i })).toBeInTheDocument();
  });

  it('auto-loads overview teams and shows a Refresh All Teams button', () => {
    renderArtView();
    expect(mockActions.loadAllTeams).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /refresh all teams/i })).toBeInTheDocument();
  });

  it('reloads ART data when the PI changes outside the Overview tab', () => {
    mockState.activeTab = 'predictability';
    const { rerender } = renderArtView();

    expect(mockActions.loadAllTeams).toHaveBeenCalledTimes(1);
    mockActions.loadAllTeams.mockClear();

    mockState.selectedPiName = 'PI-2025-Q2';
    rerender(
      <ToastProvider>
        <ArtView />
      </ToastProvider>,
    );

    expect(mockActions.loadAllTeams).toHaveBeenCalledTimes(1);
    mockState.activeTab = 'overview';
    mockState.selectedPiName = 'PI-2025-Q1';
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

  // ── Feature 1: Dependency Tab ──

  it('shows the Dependencies tab panel with an available load action when a PI is selected', () => {
    mockState.activeTab = 'dependencies';
    renderArtView();
    expect(screen.getByRole('button', { name: /loading|reload dependencies|load dependencies/i })).toBeInTheDocument();
  });

  it('shows the no-PI warning in the Dependencies tab when no PI is selected', () => {
    mockState.activeTab = 'dependencies';
    mockState.selectedPiName = '';
    renderArtView();
    expect(screen.getByText(/enable the dependency map/i)).toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
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
    expect(screen.getByText(/choose a pi from the selector above/i)).toBeInTheDocument();
    mockState.selectedPiName = 'PI-2025-Q1';
  });

  it('shows the Blueprint tab with an available load action when a PI is selected', () => {
    mockState.activeTab = 'blueprint';
    mockState.selectedPiName = 'PI-2025-Q1';
    renderArtView();
    expect(screen.getByRole('button', { name: /loading|reload blueprint|load blueprint/i })).toBeInTheDocument();
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

  it('loads dependency link type checkboxes in ART settings', async () => {
    mockState.activeTab = 'settings';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/issueLinkType') {
        return Promise.resolve({
          issueLinkTypes: [
            { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          ],
        });
      }

      if (path === '/rest/api/2/field') {
        return Promise.resolve([]);
      }

      if (path === '/rest/api/2/project') {
        return Promise.resolve([]);
      }

      return Promise.resolve({ values: [] });
    });

    renderArtView();

    const dependencyLinkTypeCheckboxes = await screen.findAllByLabelText(/dependency link type blocks/i);
    expect(dependencyLinkTypeCheckboxes.length).toBeGreaterThan(0);
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

  it('renders the exact monthly accomplishment template rows from the approved format', () => {
    mockState.activeTab = 'monthly';
    renderArtView();
    expect(screen.getByLabelText(/team name \(salesforce: xx or enrollment: xx\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what is the name of the initiative\/project/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/included product areas/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what was accomplished\?/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what are the business outcomes or desired benefits\?/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date delivered accomplished/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sme \/ point of contact \(po\)/i)).toBeInTheDocument();
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
      JSON.stringify({ teamId: 'team-1', teamName: 'Alpha Team', reportTeamName: 'Alpha Team', accomplished: '', outcomes: '', stakeholders: '', pillar: 'Growth' }),
    );
    mockState.teams = [
      { id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null },
      { id: 'team-2', name: 'Beta Team', boardId: '43', projectKey: '', sprintIssues: [], isLoading: false, loadError: null },
    ];
    renderArtView();
    const pillarFilter = screen.getByRole('combobox', { name: /filter by pillar/i });
    fireEvent.change(pillarFilter, { target: { value: 'Affordability' } });
    expect(screen.queryByLabelText(/what is the name of the initiative\/project/i)).not.toBeInTheDocument();
    localStorage.removeItem(`tbxMonthlyReport_team-1_${yearMonth}`);
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  // ── Monthly Report parity: draft indicator ──

  it('shows a draft indicator on a Monthly Report card that has content', () => {
    mockState.activeTab = 'monthly';
    const yearMonth = createLocalYearMonth();
    localStorage.setItem(
      `tbxMonthlyReport_team-1_${yearMonth}`,
      JSON.stringify({ teamId: 'team-1', teamName: 'Alpha Team', reportTeamName: 'Alpha Team', accomplished: 'Shipped feature X', outcomes: '', stakeholders: '', pillar: '' }),
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

  it('copies the monthly report as the email and teams table format', async () => {
    mockState.activeTab = 'monthly';
    const yearMonth = createLocalYearMonth();
    localStorage.setItem(
      `tbxMonthlyReport_team-1_${yearMonth}`,
      JSON.stringify({
        teamId: 'team-1',
        teamName: 'Alpha Team',
        reportTeamName: 'Salesforce: Alpha Team',
        initiativeName: 'Unified Intake',
        code: 'P-123',
        productAreas: 'SalesOps',
        accomplished: 'Delivered the intake workflow',
        outcomes: 'Reduced manual touchpoints',
        stakeholders: 'Members',
        pillar: 'Growth',
        deliveredDate: '2026-05-15',
        pointOfContact: 'Jane Doe',
      }),
    );

    renderArtView();
    fireEvent.click(screen.getByRole('button', { name: /copy all/i }));

    expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
    const clipboardItems = mockClipboardWrite.mock.calls[0][0] as MockClipboardItem[];
    const clipboardItem = clipboardItems[0];
    const htmlContent = await clipboardItem.items['text/html'].text();
    const textContent = await clipboardItem.items['text/plain'].text();

    expect(htmlContent).toContain('Team Name (Salesforce: xx or Enrollment: xx)');
    expect(htmlContent).toContain('What is the name of the initiative/project?');
    expect(htmlContent).toContain('Salesforce: Alpha Team');
    expect(htmlContent).toContain('Unified Intake');
    expect(textContent).toContain('Date Delivered Accomplished');
    expect(textContent).toContain('• 2026-05-15');

    localStorage.removeItem(`tbxMonthlyReport_team-1_${yearMonth}`);
  });

  // ── Monthly Report Jira parity: CSV export ──

  it('renders an Export CSV button in the Monthly Report toolbar', () => {
    mockState.activeTab = 'monthly';
    renderArtView();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
  });

  // ── Monthly Report Jira parity: stats bar ──

  it('shows the Jira stats bar when the team has loaded sprint issues', () => {
    mockState.activeTab = 'monthly';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: '',
        sprintIssues: [
          {
            id: 'TBX-1',
            key: 'TBX-1',
            fields: {
              summary: 'Done story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null,
              assignee: null,
              reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z',
              updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
        ] as JiraIssue[],
        isLoading: false,
        loadError: null,
      },
    ] as ArtTeam[];
    renderArtView();
    // The stats bar appears and shows "1/1 done" for one done issue.
    expect(screen.getByTestId('jira-stats-team-1')).toBeInTheDocument();
    expect(screen.getByText(/1\/1 done/i)).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows the "Generate from Jira" button when the team has loaded sprint issues', () => {
    mockState.activeTab = 'monthly';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: '',
        sprintIssues: [
          {
            id: 'TBX-1',
            key: 'TBX-1',
            fields: {
              summary: 'Done story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null,
              assignee: null,
              reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z',
              updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
        ] as JiraIssue[],
        isLoading: false,
        loadError: null,
      },
    ] as ArtTeam[];
    renderArtView();
    expect(screen.getByRole('button', { name: /generate from jira/i })).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows the "load team" hint and no stats bar when the team has no sprint issues loaded', () => {
    mockState.activeTab = 'monthly';
    // Default mockState.teams has an empty sprintIssues array.
    renderArtView();
    expect(screen.queryByTestId('jira-stats-team-1')).not.toBeInTheDocument();
    expect(screen.getByText(/load this team from the overview tab/i)).toBeInTheDocument();
  });

  it('pre-fills the accomplishment row when "Generate from Jira" is clicked', () => {
    mockState.activeTab = 'monthly';
    const yearMonth = createLocalYearMonth();
    // Start with empty card (no localStorage content).
    localStorage.removeItem(`tbxMonthlyReport_team-1_${yearMonth}`);
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: '',
        sprintIssues: [
          {
            id: 'TBX-10',
            key: 'TBX-10',
            fields: {
              summary: 'Finished the widget',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null,
              assignee: null,
              reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z',
              updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
        ] as JiraIssue[],
        isLoading: false,
        loadError: null,
      },
    ] as ArtTeam[];
    renderArtView();
    fireEvent.click(screen.getByRole('button', { name: /generate from jira/i }));
    const accomplishedTextarea = screen.getByLabelText(/what was accomplished\?/i) as HTMLTextAreaElement;
    expect(accomplishedTextarea.value).toContain('TBX-10');
    expect(accomplishedTextarea.value).toContain('Finished the widget');
    localStorage.removeItem(`tbxMonthlyReport_team-1_${yearMonth}`);
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
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

  it('shows the optional Feature Project Filter input in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('textbox', { name: /feature project filter/i })).toBeInTheDocument();
  });

  it('shows PI Review target date field pickers in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /pi review target start field/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /pi review target end field/i })).toBeInTheDocument();
  });

  it('falls back to the default PI Review target date field IDs when settings are blank', async () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') {
        return Promise.reject(new Error('Jira unavailable'));
      }

      return Promise.resolve({ values: [] });
    });
    renderArtView();

    expect(await screen.findByRole('textbox', { name: /pi review target start field/i })).toHaveValue('customfield_10101');
    expect(screen.getByRole('textbox', { name: /pi review target end field/i })).toHaveValue('customfield_10102');
  });

  it('shows Stale Days Threshold input in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('spinbutton', { name: /stale days threshold/i })).toBeInTheDocument();
  });

  it('shows the default PI Review page URL input in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    expect(screen.getByRole('textbox', { name: /default pi review confluence page url or id/i })).toBeInTheDocument();
  });

  it('renders dependency link types as pressed-state buttons and persists toggles', async () => {
    mockState.activeTab = 'settings';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') {
        return Promise.resolve([]);
      }
      if (path === '/rest/api/2/project') {
        return Promise.resolve([]);
      }
      if (path === '/rest/api/2/issueLinkType') {
        return Promise.resolve({
          issueLinkTypes: [
            { name: 'blocks' },
            { name: 'Cloners' },
          ],
        });
      }

      return Promise.resolve({ values: [] });
    });

    renderArtView();

    const clonersButton = await screen.findByRole('button', { name: /dependency link type cloners/i });
    expect(clonersButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(clonersButton);

    expect(clonersButton).toHaveAttribute('aria-pressed', 'true');
    const storedSettings = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as { depLinkTypes?: string[] };
    expect(storedSettings.depLinkTypes).toContain('Cloners');
  });

  it('shows separate shared ART setup and sync guidance in Settings tab', () => {
    mockState.activeTab = 'settings';
    renderArtView();

    expect(screen.getByRole('heading', { name: /1\. first-time setup/i })).toBeInTheDocument();
    expect(
      screen.getByText(/toolbox creates the workspace and fills in the shared art database id for future sync/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2\. sync an existing workspace/i })).toBeInTheDocument();
    expect(
      screen.getByText(/load pulls shared settings into this browser, while push publishes your local art settings/i),
    ).toBeInTheDocument();

    expect(screen.getByRole('textbox', { name: /shared art database id/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /art short name/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create new shared art workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /push local settings to workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load shared settings from workspace/i })).toBeInTheDocument();
  });

  it('prefills first-install Shared ART workspace defaults in Settings tab', () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    renderArtView();

    expect(screen.getByDisplayValue('Sales to Enrollment')).toBeInTheDocument();
    expect(screen.getByDisplayValue('S2E')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sales To Enrollment ART (684163133)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('256344064')).toBeInTheDocument();
    expect(screen.getByDisplayValue('685473797')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /shared art database id/i })).toHaveAttribute('readonly');
  });

  it('uses saved Shared ART workspace settings instead of first-install defaults', () => {
    mockState.activeTab = 'settings';
    seedSharedArtWorkspaceSettings({
      sharedArtName: 'Platform ART',
      sharedArtKey: 'PLAT',
      sharedArtDatabaseId: 'db-999',
      sharedArtSpaceId: 'space-888',
      sharedArtParentId: 'parent-777',
    });
    renderArtView();

    expect(screen.getByDisplayValue('Platform ART')).toBeInTheDocument();
    expect(screen.getByDisplayValue('PLAT')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Platform ART (db-999)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('space-888')).toBeInTheDocument();
    expect(screen.getByDisplayValue('parent-777')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Sales to Enrollment')).not.toBeInTheDocument();
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
    // 1 done out of 2 total = 50% (shown in both rollup bar and table row; check at least one appears)
    expect(screen.getAllByText('50%').length).toBeGreaterThanOrEqual(1);
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

  // ── art-predictability-advanced: ART rollup, Scrum/Kanban sections, sprint name, throughput ──

  it('shows ART predictability rollup region in the Predictability tab', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-P1', key: 'TBX-P1',
            fields: {
              summary: 'Done issue',
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
    // The rollup summary bar should be visible
    expect(screen.getByRole('region', { name: /art predictability rollup/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows ART overall predictability percentage in the Predictability tab rollup', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-P2', key: 'TBX-P2',
            fields: {
              summary: 'Done',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
            },
          },
          {
            id: 'TBX-P3', key: 'TBX-P3',
            fields: {
              summary: 'Not done',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
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
    // 1 done out of 2 total = 50% ART predictability
    const rollupBar = screen.getByRole('region', { name: /art predictability rollup/i });
    expect(within(rollupBar).getByText('50%')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows story points in the ART predictability rollup when estimates are present', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        sprintIssues: [
          {
            id: 'TBX-P4', key: 'TBX-P4',
            fields: {
              summary: 'Done with pts',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              customfield_10016: 13,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // ART rollup should show total points done
    expect(screen.getByTestId('art-predictability-pts-rollup')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows active sprint name for Scrum teams in the Predictability tab', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        activeSprintName: 'Sprint 12',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // Sprint column should show the active sprint name for Scrum teams
    expect(screen.getByText('Sprint 12')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows active sprint name for Scrum teams in Predictability when a PI is selected', () => {
    mockState.activeTab = 'predictability';
    mockState.selectedPiName = 'PI-2025-Q2';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        boardType: 'scrum' as const,
        activeSprintName: 'Sprint 9',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];

    renderArtView();

    expect(screen.getByText('Sprint 9')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.selectedPiName = 'PI-2025-Q1';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows throughput column in the Predictability tab for Kanban teams', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Kanban Team',
        boardId: '77',
        boardType: 'kanban' as const,
        sprintIssues: [
          {
            id: 'TBX-KAN-1', key: 'TBX-KAN-1',
            fields: {
              summary: 'Done kanban issue',
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
    // Throughput column header should appear
    expect(screen.getByRole('columnheader', { name: /throughput/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows separate Scrum and Kanban section sub-headers when both board types exist', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-scrum',
        name: 'Scrum Team',
        boardId: '10',
        boardType: 'scrum' as const,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
      {
        id: 'team-kanban',
        name: 'Kanban Team',
        boardId: '20',
        boardType: 'kanban' as const,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // Both section sub-headers should be visible
    expect(screen.getByText(/scrum teams/i)).toBeInTheDocument();
    // Use specific "flow teams" wording to avoid matching the rollup label "Scrum / Kanban"
    expect(screen.getByText(/kanban \/ flow teams/i)).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('does not show section sub-headers when all teams are the same board type', () => {
    mockState.activeTab = 'predictability';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Scrum A',
        boardId: '10',
        boardType: 'scrum' as const,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
      {
        id: 'team-2',
        name: 'Scrum B',
        boardId: '11',
        boardType: 'scrum' as const,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // No section sub-headers when all teams share the same board type
    expect(screen.queryByText(/scrum teams/i)).not.toBeInTheDocument();
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

  it('calls updateTeamPiReviewPageUrl when a team PI Review page URL input changes', () => {
    mockState.activeTab = 'settings';
    renderArtView();
    fireEvent.change(screen.getByRole('textbox', { name: /pi review page url for alpha team/i }), {
      target: { value: 'https://example.atlassian.net/wiki/pages/12345/Alpha' },
    });
    expect(mockActions.updateTeamPiReviewPageUrl).toHaveBeenCalledWith(
      'team-1',
      'https://example.atlassian.net/wiki/pages/12345/Alpha',
    );
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

  it('persists the default PI Review page URL to localStorage when the input value changes', () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    renderArtView();

    fireEvent.change(screen.getByRole('textbox', { name: /default pi review confluence page url or id/i }), {
      target: { value: 'https://example.atlassian.net/wiki/pages/12345/Shared' },
    });

    const stored = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as { piReviewPageUrl?: string };
    expect(stored.piReviewPageUrl).toBe('https://example.atlassian.net/wiki/pages/12345/Shared');

    localStorage.removeItem('tbxARTSettings');
    mockState.activeTab = 'overview';
  });

  it('persists normalized feature project filters to localStorage when the input value changes', () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    renderArtView();

    fireEvent.change(screen.getByRole('textbox', { name: /feature project filter/i }), {
      target: { value: ' denp, enfct , denp ' },
    });

    const stored = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as { featureProjectKeys?: string[] };
    expect(stored.featureProjectKeys).toEqual(['DENP', 'ENFCT']);

    localStorage.removeItem('tbxARTSettings');
    mockState.activeTab = 'overview';
  });

  it('persists PI Review target date field IDs to localStorage when the picker values change', async () => {
    mockState.activeTab = 'settings';
    localStorage.removeItem('tbxARTSettings');
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') {
        return Promise.reject(new Error('Jira unavailable'));
      }

      return Promise.resolve({ values: [] });
    });
    renderArtView();

    fireEvent.change(await screen.findByRole('textbox', { name: /pi review target start field/i }), {
      target: { value: 'customfield_12345' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /pi review target end field/i }), {
      target: { value: 'customfield_12346' },
    });

    const stored = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as {
      piReviewTargetStartFieldId?: string;
      piReviewTargetEndFieldId?: string;
    };
    expect(stored.piReviewTargetStartFieldId).toBe('customfield_12345');
    expect(stored.piReviewTargetEndFieldId).toBe('customfield_12346');

    localStorage.removeItem('tbxARTSettings');
    mockState.activeTab = 'overview';
  });

  it('creates a shared ART workspace and stores the returned database ID locally', async () => {
    mockState.activeTab = 'settings';
    renderArtView();

    fireEvent.change(screen.getByRole('textbox', { name: /shared art name/i }), {
      target: { value: 'Systems Team' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /art short name/i }), {
      target: { value: 'S2E' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /confluence space id/i }), {
      target: { value: '77' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /parent content id/i }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create new shared art workspace/i }));

    await waitFor(() => {
      expect(mockCreateConfluenceDatabase).toHaveBeenCalledWith({
        spaceId: '77',
        title: 'Systems Team',
        parentId: undefined,
      });
    });
    await waitFor(() => {
      expect(mockSaveSharedArtWorkspace).toHaveBeenCalledWith(
        'db-123',
        expect.objectContaining({
          artKey: 'S2E',
          artName: 'Systems Team',
        }),
      );
    });

    const storedSettings = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as {
      sharedArtDatabaseId?: string;
    };
    expect(storedSettings.sharedArtDatabaseId).toBe('db-123');
    mockState.activeTab = 'overview';
  });

  it('creates a shared ART workspace without an ART short name', async () => {
    mockState.activeTab = 'settings';
    renderArtView();

    fireEvent.change(screen.getByRole('textbox', { name: /shared art name/i }), {
      target: { value: 'Systems Team' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /art short name/i }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /confluence space id/i }), {
      target: { value: '77' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /parent content id/i }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create new shared art workspace/i }));

    await waitFor(() => {
      expect(mockSaveSharedArtWorkspace).toHaveBeenCalledWith(
        'db-123',
        expect.objectContaining({
          artKey: 'Systems Team',
          artName: 'Systems Team',
        }),
      );
    });

    mockState.activeTab = 'overview';
  });

  it('loads shared ART settings and replaces the local ART roster', async () => {
    mockState.activeTab = 'settings';
    seedSharedArtWorkspaceSettings({
      sharedArtName: 'Systems Team',
      sharedArtKey: 'S2E',
      sharedArtDatabaseId: 'db-123',
    });
    renderArtView();

    fireEvent.click(screen.getByRole('button', { name: /load shared settings from workspace/i }));

    await waitFor(() => {
      expect(mockLoadSharedArtWorkspace).toHaveBeenCalledWith('db-123');
    });
    await waitFor(() => {
      expect(mockActions.replaceTeams).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'shared-team-1',
          name: 'Shared Alpha',
          boardId: '42',
        }),
      ]);
    });

    const storedSettings = JSON.parse(localStorage.getItem('tbxARTSettings') ?? '{}') as {
      sharedArtKey?: string;
      sharedArtDatabaseId?: string;
    };
    expect(storedSettings.sharedArtKey).toBe('S2E');
    expect(storedSettings.sharedArtDatabaseId).toBe('db-123');
    mockState.activeTab = 'overview';
  });

  it('stores the loaded shared ART snapshot for future merge-aware push', async () => {
    mockState.activeTab = 'settings';
    seedSharedArtWorkspaceSettings({
      sharedArtName: 'Systems Team',
      sharedArtKey: 'S2E',
      sharedArtDatabaseId: 'db-123',
    });
    renderArtView();

    fireEvent.click(screen.getByRole('button', { name: /load shared settings from workspace/i }));

    await waitFor(() => {
      const storedSnapshots = JSON.parse(localStorage.getItem(SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY) ?? '{}') as Record<
        string,
        { artName: string; artKey: string; updatedAt: string }
      >;
      expect(storedSnapshots['db-123']).toEqual(
        expect.objectContaining({
          artName: 'Systems Team',
          artKey: 'S2E',
          updatedAt: '2026-05-20T12:00:00.000Z',
        }),
      );
    });
  });

  it('merges non-conflicting local and remote shared ART changes on publish', async () => {
    mockState.activeTab = 'settings';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Local Alpha',
        boardId: '42',
        boardName: 'Transformers Board',
        projectKey: 'ALPHA',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];

    localStorage.setItem(
      SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY,
      JSON.stringify({
        'db-123': {
          schemaVersion: 1,
          artKey: 'S2E',
          artName: 'Systems Team',
          updatedAt: '2026-05-20T12:00:00.000Z',
          teams: [
            {
              id: 'team-1',
              name: 'Shared Alpha',
              boardId: '42',
              boardName: 'Transformers Board',
              projectKey: 'ALPHA',
            },
          ],
          settings: {
            piFieldId: 'customfield_10301',
            depLinkTypes: ['blocks'],
            staleDays: 5,
            sprintWindowDays: 10,
          },
        },
      }),
    );

    mockLoadSharedArtWorkspace.mockResolvedValueOnce({
      schemaVersion: 1,
      artKey: 'S2E',
      artName: 'Systems Team',
      updatedAt: '2026-05-21T12:00:00.000Z',
      teams: [
        {
          id: 'team-1',
          name: 'Shared Alpha',
          boardId: '84',
          boardName: 'Transformers Board',
          projectKey: 'ALPHA',
        },
      ],
      settings: {
        piFieldId: 'customfield_10301',
        depLinkTypes: ['blocks'],
        staleDays: 5,
        sprintWindowDays: 10,
      },
    });

    seedSharedArtWorkspaceSettings({
      sharedArtName: 'Systems Team',
      sharedArtKey: 'S2E',
      sharedArtDatabaseId: 'db-123',
    });
    renderArtView();
    fireEvent.change(screen.getByRole('textbox', { name: /shared art name/i }), {
      target: { value: 'Systems Team' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /art short name/i }), {
      target: { value: 'S2E' },
    });
    fireEvent.click(screen.getByRole('button', { name: /push local settings to workspace/i }));

    await waitFor(() => {
      expect(mockSaveSharedArtWorkspace).toHaveBeenCalledWith(
        'db-123',
        expect.objectContaining({
          teams: [
            expect.objectContaining({
              id: 'team-1',
              name: 'Local Alpha',
              boardId: '84',
            }),
          ],
        }),
      );
    });
  });

  it('stops publish when local and remote shared ART changes conflict', async () => {
    mockState.activeTab = 'settings';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Shared Alpha',
        boardId: '77',
        boardName: 'Transformers Board',
        projectKey: 'ALPHA',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];

    localStorage.setItem(
      SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY,
      JSON.stringify({
        'db-123': {
          schemaVersion: 1,
          artKey: 'S2E',
          artName: 'Systems Team',
          updatedAt: '2026-05-20T12:00:00.000Z',
          teams: [
            {
              id: 'team-1',
              name: 'Shared Alpha',
              boardId: '42',
              boardName: 'Transformers Board',
              projectKey: 'ALPHA',
            },
          ],
          settings: {
            piFieldId: 'customfield_10301',
            depLinkTypes: ['blocks'],
            staleDays: 5,
            sprintWindowDays: 10,
          },
        },
      }),
    );

    mockLoadSharedArtWorkspace.mockResolvedValueOnce({
      schemaVersion: 1,
      artKey: 'S2E',
      artName: 'Systems Team',
      updatedAt: '2026-05-21T12:00:00.000Z',
      teams: [
        {
          id: 'team-1',
          name: 'Shared Alpha',
          boardId: '84',
          boardName: 'Transformers Board',
          projectKey: 'ALPHA',
        },
      ],
      settings: {
        piFieldId: 'customfield_10301',
        depLinkTypes: ['blocks'],
        staleDays: 5,
        sprintWindowDays: 10,
      },
    });

    seedSharedArtWorkspaceSettings({
      sharedArtName: 'Systems Team',
      sharedArtKey: 'S2E',
      sharedArtDatabaseId: 'db-123',
    });
    renderArtView();
    fireEvent.change(screen.getByRole('textbox', { name: /shared art name/i }), {
      target: { value: 'Systems Team' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /art short name/i }), {
      target: { value: 'S2E' },
    });
    fireEvent.click(screen.getByRole('button', { name: /push local settings to workspace/i }));

    await waitFor(() => {
      expect(mockSaveSharedArtWorkspace).not.toHaveBeenCalled();
      expect(screen.getAllByText(/shared art push found conflicts/i)).toHaveLength(2);
    });
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

  // ── art-impediments-advanced: reason filter dropdown ──

  it('renders a reason filter dropdown in the Impediments toolbar', () => {
    mockState.activeTab = 'impediments';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /filter by reason/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows "All Reasons" as the default option in the reason filter', () => {
    mockState.activeTab = 'impediments';
    renderArtView();
    expect(screen.getByRole('combobox', { name: /filter by reason/i })).toHaveValue('all');
    mockState.activeTab = 'overview';
  });

  it('hides a Flagged-only issue when reason filter is set to "Blocked Status"', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-40', key: 'ALPHA-40',
            fields: {
              summary: 'Flagged only issue',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              customfield_10021: true,
            },
          },
          {
            id: 'ALPHA-41', key: 'ALPHA-41',
            fields: {
              summary: 'Status blocked issue',
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

    fireEvent.change(screen.getByRole('combobox', { name: /filter by reason/i }), {
      target: { value: 'Blocked Status' },
    });

    // Only the status-blocked issue should be visible; the flagged-only one is filtered out.
    expect(screen.getByText('ALPHA-41')).toBeInTheDocument();
    expect(screen.queryByText('ALPHA-40')).not.toBeInTheDocument();

    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows all impediment issues again when reason filter is reset to "all"', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-42', key: 'ALPHA-42',
            fields: {
              summary: 'Flagged issue',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              customfield_10021: true,
            },
          },
          {
            id: 'ALPHA-43', key: 'ALPHA-43',
            fields: {
              summary: 'Blocked issue',
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

    const reasonFilter = screen.getByRole('combobox', { name: /filter by reason/i });
    fireEvent.change(reasonFilter, { target: { value: 'Flagged' } });
    fireEvent.change(reasonFilter, { target: { value: 'all' } });

    // Both issues should be visible after resetting the filter.
    expect(screen.getByText('ALPHA-42')).toBeInTheDocument();
    expect(screen.getByText('ALPHA-43')).toBeInTheDocument();

    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  // ── art-impediments-advanced: grouped/collapsible team sections ──

  it('shows a collapsible team section header button for each team with impediments', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-50', key: 'ALPHA-50',
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
    // The team section header should appear as a button containing the team name.
    expect(screen.getByRole('button', { name: /alpha team/i })).toBeInTheDocument();

    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('hides issue rows when a team section header is clicked to collapse it', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-51', key: 'ALPHA-51',
            fields: {
              summary: 'Visible blocked story',
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

    // Issue should be visible initially (team section expanded by default).
    expect(screen.getByText('ALPHA-51')).toBeInTheDocument();

    // Click the team header to collapse the section.
    fireEvent.click(screen.getByRole('button', { name: /alpha team/i }));

    // The issue row should no longer be visible.
    expect(screen.queryByText('ALPHA-51')).not.toBeInTheDocument();

    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('does not show a team section for teams with no impediments', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        // No impediments — clean sprint
        sprintIssues: [
          {
            id: 'ALPHA-52', key: 'ALPHA-52',
            fields: {
              summary: 'Normal in-progress story',
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

    // No team section header button should appear since there are no impediments.
    expect(screen.queryByRole('button', { name: /alpha team/i })).not.toBeInTheDocument();

    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  // ── art-impediments-advanced: Days column with stale tier ──

  it('shows a Days column header in the Impediments table', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-55', key: 'ALPHA-55',
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
    expect(screen.getByRole('columnheader', { name: /days/i })).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a stale tier badge when an impediment issue has a very old updated date', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-56', key: 'ALPHA-56',
            fields: {
              summary: 'Ancient blocked story',
              status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2020-01-01T00:00:00.000Z',
              // Very old date guarantees critical tier regardless of configured threshold
              updated: '2020-01-01T00:00:00.000Z',
              description: null,
            },
          },
        ],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    // The stale tier badge should indicate "critical" staleness for a very old impediment.
    expect(screen.getByTestId('impediment-stale-badge-ALPHA-56')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  // ── art-impediments-advanced: detection legend ──

  it('renders the impediment detection legend section in the Impediments panel', () => {
    mockState.activeTab = 'impediments';
    renderArtView();
    // The legend toggle button should always be visible even when the legend body is collapsed.
    expect(screen.getByRole('button', { name: /detection signals/i })).toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows all four detection signal descriptions when the legend is opened', () => {
    mockState.activeTab = 'impediments';
    // Use default teams with no impediments so the legend is the only source of reason text.
    renderArtView();

    // The legend starts collapsed; click to open it before asserting on content.
    fireEvent.click(screen.getByRole('button', { name: /detection signals/i }));

    expect(screen.getByText(/blocked status/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked link/i)).toBeInTheDocument();
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
    // "Label" appears as both a table column header and legend term when issues exist,
    // but with no impediment issues in mock state there is only the legend term.
    expect(screen.getAllByText(/label/i).length).toBeGreaterThanOrEqual(1);
    mockState.activeTab = 'overview';
  });

  // ── art-impediments-advanced: actionable prompts ──

  it('shows an actionable prompt for a Flagged impediment', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-60', key: 'ALPHA-60',
            fields: {
              summary: 'Flagged impediment story',
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
    // Actionable prompt for "Flagged" reason should be visible in the row.
    expect(screen.getByTestId('impediment-prompt-ALPHA-60')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a "Blocked Status" actionable prompt for a status-blocked impediment', () => {
    mockState.activeTab = 'impediments';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-61', key: 'ALPHA-61',
            fields: {
              summary: 'Status blocked story',
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
    expect(screen.getByTestId('impediment-prompt-ALPHA-61')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  // ── SoS parity: Jira-backed sync ──

  it('shows the sosIssueKey badge in the SoS accordion header when a team has a sosIssueKey configured', () => {
    mockState.activeTab = 'sos';
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sosIssueKey: 'ALPHA-SOS-1',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('ALPHA-SOS-1')).toBeInTheDocument();
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('does not show a sosIssueKey badge in the SoS accordion header when no sosIssueKey is configured', () => {
    mockState.activeTab = 'sos';
    // Default beforeEach team has no sosIssueKey set
    renderArtView();
    expect(screen.queryByTitle(/jira sos issue/i)).not.toBeInTheDocument();
    mockState.activeTab = 'overview';
  });

  it('shows a Post to Jira button in an expanded SoS accordion section when sosIssueKey is set', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sosIssueKey: 'ALPHA-SOS-1',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByRole('button', { name: /post to jira/i })).toBeInTheDocument();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('does not show Post to Jira button in an expanded SoS accordion when sosIssueKey is absent', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    // Default team has no sosIssueKey
    renderArtView();
    expect(screen.queryByRole('button', { name: /post to jira/i })).not.toBeInTheDocument();
    mockState.sosExpandedTeams = [];
    mockState.activeTab = 'overview';
  });

  it('shows Local only sync state when sosIssueKey is configured but no Jira comment has been posted yet', () => {
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sosIssueKey: 'ALPHA-SOS-1',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText(/local only/i)).toBeInTheDocument();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('calls jiraPost with the correct path and comment body when Post to Jira is clicked', async () => {
    mockJiraPost.mockResolvedValue({});
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sosIssueKey: 'ALPHA-SOS-1',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    fireEvent.click(screen.getByRole('button', { name: /post to jira/i }));
    await screen.findByText(/synced/i);
    expect(mockJiraPost).toHaveBeenCalledWith(
      '/rest/api/2/issue/ALPHA-SOS-1/comment',
      expect.objectContaining({ body: expect.stringContaining('SoS Update') }),
    );
    mockJiraPost.mockReset();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a Synced indicator after a successful Post to Jira', async () => {
    mockJiraPost.mockResolvedValue({});
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sosIssueKey: 'ALPHA-SOS-1',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    fireEvent.click(screen.getByRole('button', { name: /post to jira/i }));
    expect(await screen.findByText(/synced/i)).toBeInTheDocument();
    mockJiraPost.mockReset();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  it('shows a sync error message when the Post to Jira call fails', async () => {
    mockJiraPost.mockRejectedValue(new Error('Jira unavailable'));
    mockState.activeTab = 'sos';
    mockState.sosExpandedTeams = ['team-1'];
    mockState.teams = [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        projectKey: 'ALPHA',
        sosIssueKey: 'ALPHA-SOS-1',
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      },
    ];
    renderArtView();
    fireEvent.click(screen.getByRole('button', { name: /post to jira/i }));
    expect(await screen.findByText(/jira unavailable/i)).toBeInTheDocument();
    mockJiraPost.mockReset();
    mockState.sosExpandedTeams = [];
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
    mockState.activeTab = 'overview';
  });

  // ── art-releases-advanced: urgency badges, progress bars, expandable issue lists ──

  it('shows an "Overdue" urgency badge in the Releases tab when a fix version date has passed', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-70', key: 'ALPHA-70',
            fields: {
              summary: 'Overdue story',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              // A date far in the past guarantees "Overdue" regardless of when the test runs.
              fixVersions: [{ name: 'v1.0-old', releaseDate: '2020-01-01', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a "Released" urgency badge for an already-released fix version', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-71', key: 'ALPHA-71',
            fields: {
              summary: 'Released story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v1.0-done', releaseDate: '2025-01-01', released: true }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('Released')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a "No Date" urgency badge for a fix version with no release date', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-72', key: 'ALPHA-72',
            fields: {
              summary: 'Undated story',
              status: { name: 'To Do', statusCategory: { key: 'new' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              // No releaseDate field — should classify as "No Date"
              fixVersions: [{ name: 'vTBD', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByText('No Date')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows a progress bar for each release version in the Releases tab', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-73', key: 'ALPHA-73',
            fields: {
              summary: 'Done feature',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v5.0', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('sets the correct aria-valuenow on the progress bar based on done/total ratio', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-74', key: 'ALPHA-74',
            fields: {
              summary: 'Done story',
              status: { name: 'Done', statusCategory: { key: 'done' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v5.1', released: false }],
            },
          },
          {
            id: 'ALPHA-75', key: 'ALPHA-75',
            fields: {
              summary: 'In progress story',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v5.1', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    // 1 done out of 2 total = 50%
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('expands the issue list when the release version expand button is clicked', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-80', key: 'ALPHA-80',
            fields: {
              summary: 'Feature to expand',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v6.0', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    // Issue key must NOT be visible before expanding
    expect(screen.queryByText('ALPHA-80')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /expand issues for v6\.0/i }));
    // Issue key and summary must appear after expanding
    expect(screen.getByText('ALPHA-80')).toBeInTheDocument();
    expect(screen.getByText('Feature to expand')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('collapses the issue list when the expand button is clicked a second time', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-81', key: 'ALPHA-81',
            fields: {
              summary: 'Collapsible feature',
              status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v7.0', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    // Expand
    fireEvent.click(screen.getByRole('button', { name: /expand issues for v7\.0/i }));
    expect(screen.getByText('ALPHA-81')).toBeInTheDocument();
    // Collapse — after expand the button label flips to "Collapse…"
    fireEvent.click(screen.getByRole('button', { name: /collapse issues for v7\.0/i }));
    expect(screen.queryByText('ALPHA-81')).not.toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });

  it('shows the issue status in the expanded release issue list', () => {
    mockState.activeTab = 'releases';
    mockState.teams = [
      {
        id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: 'ALPHA',
        sprintIssues: [
          {
            id: 'ALPHA-82', key: 'ALPHA-82',
            fields: {
              summary: 'Status check story',
              status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
              priority: null, assignee: null, reporter: null,
              issuetype: { name: 'Story', iconUrl: '' },
              created: '2025-01-01T00:00:00.000Z', updated: '2025-01-02T00:00:00.000Z',
              description: null,
              fixVersions: [{ name: 'v8.0', released: false }],
            },
          },
        ],
        isLoading: false, loadError: null,
      },
    ];
    renderArtView();
    fireEvent.click(screen.getByRole('button', { name: /expand issues for v8\.0/i }));
    expect(screen.getByText('In Review')).toBeInTheDocument();
    mockState.activeTab = 'overview';
    mockState.teams = [{ id: 'team-1', name: 'Alpha Team', boardId: '42', projectKey: '', sprintIssues: [], isLoading: false, loadError: null }];
  });
});
