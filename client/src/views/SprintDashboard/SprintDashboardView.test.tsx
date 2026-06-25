// SprintDashboardView.test.tsx — Unit tests for the Sprint Dashboard tabbed view component.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import type { JiraIssue, JiraSprint } from '../../types/jira.ts';
import type { DashboardTab } from './hooks/useSprintData.ts';

const { mockJiraGet } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
}));

const { mockDownloadElementImage, mockCopyElementImageToClipboard } = vi.hoisted(() => ({
  mockDownloadElementImage: vi.fn(),
  mockCopyElementImageToClipboard: vi.fn(),
}));

// Mock recharts so the LineChart renders without canvas/SVG issues in jsdom.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

const { mockState, mockActions, mockConfig, mockConfigActions } = vi.hoisted(() => {
  const initialSprintInfo: JiraSprint = {
    id: 7,
    name: 'Sprint 7',
    state: 'active',
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-14T00:00:00.000Z',
  };

  const buildInProgressIssue = (issueKey: string, summary: string, assigneeName: string): JiraIssue => ({
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High', iconUrl: 'priority.png' },
      assignee: {
        accountId: 'user-1',
        displayName: assigneeName,
        emailAddress: `${assigneeName.toLowerCase()}@example.com`,
        avatarUrls: {},
      },
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
    },
  });

  const blockedIssue: JiraIssue = {
    id: 'TBX-12',
    key: 'TBX-12',
    fields: {
      summary: 'Blocked issue',
      status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High', iconUrl: 'priority.png' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
    },
  };

  return {
    mockState: {
      projectKey: 'TBX',
      activeTab: 'overview' as DashboardTab,
      scopeMode: 'sprint' as const,
      selectedSprintId: 7,
      selectedFixVersionName: '',
      selectedPiValue: '',
      sprintInfo: initialSprintInfo as JiraSprint | null,
      sprintIssues: [
        buildInProgressIssue('TBX-10', 'Wire up the backend', 'Alice'),
        buildInProgressIssue('TBX-11', 'Polish the UI', 'Bob'),
        blockedIssue,
      ],
      isLoadingSprint: false,
      loadError: null as string | null,
      isTimerRunning: false,
      timerSecondsRemaining: 900,
      boardId: null as number | null,
      selectedBoardName: null as string | null,
      boardType: null as 'scrum' | 'kanban' | null,
      availableBoards: [] as Array<{ id: number; name: string; type: 'scrum' | 'kanban'; projectKey: string }>,
      availableScopeSprints: [initialSprintInfo] as JiraSprint[],
      availableFixVersions: [] as Array<{ id: string; name: string }>,
      availablePiValues: [] as string[],
      availableSprints: null as JiraSprint[] | null,
      isLoadingAvailableSprints: false,
    },
    mockActions: {
      setProjectKey: vi.fn(),
      setActiveTab: vi.fn(),
      loadSprint: vi.fn().mockResolvedValue(undefined),
      resetTimer: vi.fn(),
      tickTimer: vi.fn(),
      startTimer: vi.fn(),
      stopTimer: vi.fn(),
      selectBoard: vi.fn().mockResolvedValue(undefined),
      setScopeMode: vi.fn().mockResolvedValue(undefined),
      selectSprintScope: vi.fn().mockResolvedValue(undefined),
      selectFixVersionScope: vi.fn().mockResolvedValue(undefined),
      selectPiScope: vi.fn().mockResolvedValue(undefined),
      loadAvailableSprints: vi.fn().mockResolvedValue(undefined),
      moveIssueToSprint: vi.fn().mockResolvedValue(undefined),
    },
    mockConfig: {
      staleDaysThreshold: 5,
      storyPointScale: '1,2,3,5,8,13,21',
      sprintWindow: 6,
      cycleTimeStartField: '',
      cycleTimeDoneField: '',
      cycleTimeBaselineDays: 0,
      kanbanPeriodDays: 14,
      customStoryPointsFieldId: 'story_points',
      customEpicLinkFieldId: 'epic_link',
    },
    mockConfigActions: {
      updateConfig: vi.fn(),
      resetConfig: vi.fn(),
    },
  };
});

vi.mock('./hooks/useSprintData.ts', () => ({
  useSprintData: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('./hooks/useDashboardConfig.ts', () => ({
  useDashboardConfig: () => ({ config: mockConfig, actions: mockConfigActions }),
}));

vi.mock('../../components/JiraFieldPicker/index.tsx', () => ({
  default: ({
    id,
    label,
    value,
    onChange,
  }: {
    id: string;
    label: string;
    value: string;
    onChange: (nextValue: string) => void;
  }) => (
    <label htmlFor={id}>
      {label}
      <input id={id} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  ),
}));

vi.mock('./StandupTab.tsx', () => ({
  default: () => <div>Mock Standup Workspace</div>,
}));

vi.mock('./FeatureReviewTab.tsx', () => ({
  default: () => <div>Mock Team Dashboard Feature Review</div>,
}));

vi.mock('./RosterTab.tsx', () => ({
  default: () => <div>Mock Roster Workspace</div>,
}));

vi.mock('./SprintDashboardPiReviewTab.tsx', () => ({
  default: () => <div>Mock Team Dashboard PI Review</div>,
}));

vi.mock('./TeamDashboardHygieneTab.tsx', () => ({
  default: ({ projectKey }: { projectKey: string }) => <div>Mock Team Dashboard Hygiene ({projectKey})</div>,
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: vi.fn(),
  jiraPut: vi.fn(),
}));

vi.mock('../../utils/downloadElementImage.ts', () => ({
  downloadElementImage: mockDownloadElementImage,
  copyElementImageToClipboard: mockCopyElementImageToClipboard,
}));

import SprintDashboardView from './SprintDashboardView.tsx';
import { useSettingsStore } from '../../store/settingsStore.ts';
import { setRovoUnlocked } from '../../store/rovoStore.ts';

// Mock the Rovo exchange (dispatch+poll is unit-tested separately) so the
// auto-path integration test gets a canned deterministic response immediately.
const { mockRunRovoExchange } = vi.hoisted(() => ({ mockRunRovoExchange: vi.fn() }));
vi.mock('../SnowHub/hooks/useRovoExchange.ts', () => ({
  useRovoExchange: () => ({ isRunning: false, runRovoExchange: mockRunRovoExchange }),
}));

describe('SprintDashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    setRovoUnlocked(false); // reset the shared Rovo unlock singleton between tests
    mockRunRovoExchange.mockReset();
    useSettingsStore.setState({
      sprintDashboardTeamProfiles: [],
      sprintDashboardActiveTeamProfileId: '',
    });
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true,
    });
    mockState.activeTab = 'overview';
    mockState.sprintIssues = [
      {
        id: 'TBX-10',
        key: 'TBX-10',
        fields: {
          summary: 'Wire up the backend',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          priority: { name: 'High', iconUrl: 'priority.png' },
          assignee: {
            accountId: 'user-1',
            displayName: 'Alice',
            emailAddress: 'alice@example.com',
            avatarUrls: {},
          },
          reporter: null,
          issuetype: { name: 'Story', iconUrl: 'story.png' },
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-02T00:00:00.000Z',
          description: null,
        },
      },
      {
        id: 'TBX-11',
        key: 'TBX-11',
        fields: {
          summary: 'Polish the UI',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          priority: { name: 'High', iconUrl: 'priority.png' },
          assignee: {
            accountId: 'user-1',
            displayName: 'Bob',
            emailAddress: 'bob@example.com',
            avatarUrls: {},
          },
          reporter: null,
          issuetype: { name: 'Story', iconUrl: 'story.png' },
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-02T00:00:00.000Z',
          description: null,
        },
      },
      {
        id: 'TBX-12',
        key: 'TBX-12',
        fields: {
          summary: 'Blocked issue',
          status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
          priority: { name: 'High', iconUrl: 'priority.png' },
          assignee: null,
          reporter: null,
          issuetype: { name: 'Story', iconUrl: 'story.png' },
          created: '2025-01-01T00:00:00.000Z',
          updated: '2025-01-02T00:00:00.000Z',
          description: null,
        },
      },
    ];
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/field') {
        return Promise.resolve([]);
      }
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([]);
      }
      if (path.startsWith('/rest/api/2/search?jql=')) {
        return Promise.resolve({ issues: [] });
      }

      return Promise.resolve({ values: [] });
    });
    mockState.sprintInfo = {
      id: 7,
      name: 'Sprint 7',
      state: 'active',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-01-14T00:00:00.000Z',
    };
    mockState.projectKey = 'TBX';
    mockState.loadError = null;
    mockState.isLoadingSprint = false;
    mockState.scopeMode = 'sprint';
    mockState.selectedSprintId = 7;
    mockState.selectedFixVersionName = '';
    mockState.selectedPiValue = '';
    mockState.availableBoards = [];
    mockState.boardId = null;
    mockState.selectedBoardName = null;
    mockState.boardType = null;
    mockState.availableScopeSprints = [mockState.sprintInfo];
    mockState.availableFixVersions = [];
    mockState.availablePiValues = [];
    mockState.availableSprints = null;
  });

  it('renders the core tab buttons', () => {
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Team Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'By Assignee' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Blockers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Defects' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Standup' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hygiene' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Feature Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Roster' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'View Work By' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sprint' })).toBeInTheDocument();
  });

  it('renders the tab panel as the scroll container', () => {
    render(<SprintDashboardView />);

    expect(screen.getByRole('tabpanel').className).toContain('tabPanelSection');
  });

  it('shows board-friendly wording in the Settings tab before a board is selected', () => {
    mockState.activeTab = 'settings';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Board Settings' })).toBeInTheDocument();
    expect(screen.getByLabelText(/project key/i)).toBeInTheDocument();
    expect(screen.getByText(/load the team board and dashboard data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load board/i })).toBeInTheDocument();
  });

  it('shows scrum-specific load wording in the Settings tab for scrum boards', () => {
    mockState.activeTab = 'settings';
    mockState.boardType = 'scrum';
    render(<SprintDashboardView />);

    expect(screen.getByText(/load the active sprint/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load sprint/i })).toBeInTheDocument();
  });

  it('renders Overview tab with sprint info when sprint is loaded', () => {
    mockState.activeTab = 'overview';
    mockState.boardId = 333;
    mockState.selectedBoardName = 'Transformers SCRUM';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Sprint 7' })).toBeInTheDocument();
    expect(screen.getByText('Transformers SCRUM')).toBeInTheDocument();
    expect(screen.queryByText('Board 333')).not.toBeInTheDocument();
  });

  it('resets the tab panel scroll position when the active tab changes', () => {
    const { rerender } = render(<SprintDashboardView />);
    const initialTabPanel = screen.getByRole('tabpanel');
    initialTabPanel.scrollTop = 240;
    vi.mocked(window.scrollTo).mockClear();

    mockState.activeTab = 'settings';
    rerender(<SprintDashboardView />);

    expect(screen.getByRole('tabpanel').scrollTop).toBe(0);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' });
  });

  it('shows a board-focused empty state in Overview when no team board data is loaded', () => {
    mockState.activeTab = 'overview';
    mockState.sprintInfo = null;
    mockState.sprintIssues = [];
    mockState.boardId = null;
    mockState.projectKey = '';
    render(<SprintDashboardView />);

    expect(screen.getByText('No board data loaded. Go to Settings and load a team board.')).toBeInTheDocument();
  });

  it('auto-loads the saved dashboard selection after a refresh when a project key is already configured', () => {
    mockState.activeTab = 'overview';
    mockState.projectKey = 'TBX';
    mockState.boardId = 42;
    mockState.sprintInfo = null;
    mockState.sprintIssues = [];

    render(<SprintDashboardView />);

    expect(mockActions.loadSprint).toHaveBeenCalledTimes(1);
  });

  it('keeps the active saved team unchanged when another saved team is removed', () => {
    mockState.activeTab = 'settings';
    useSettingsStore.getState().setSprintDashboardTeamProfiles([
      {
        id: 'team-alpha',
        name: 'Alpha',
        projectKey: 'ALPHA',
        boardId: '11',
        boardName: 'Alpha Board',
        boardType: 'scrum',
        scopeMode: 'sprint',
        selectedSprintId: '101',
        selectedFixVersion: '',
        selectedPiValue: '',
      },
      {
        id: 'team-beta',
        name: 'Beta',
        projectKey: 'BETA',
        boardId: '22',
        boardName: 'Beta Board',
        boardType: 'scrum',
        scopeMode: 'sprint',
        selectedSprintId: '202',
        selectedFixVersion: '',
        selectedPiValue: '',
      },
      {
        id: 'team-gamma',
        name: 'Gamma',
        projectKey: 'GAMMA',
        boardId: '33',
        boardName: 'Gamma Board',
        boardType: 'kanban',
        scopeMode: 'pi',
        selectedSprintId: '',
        selectedFixVersion: '',
        selectedPiValue: 'PI-25.3',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeamProfileId('team-gamma');

    render(<SprintDashboardView />);

    const removeActiveTeamButton = screen.getByRole('button', { name: 'Remove Active Team' });

    act(() => {
      useSettingsStore.getState().setSprintDashboardActiveTeamProfileId('team-beta');
      fireEvent.click(removeActiveTeamButton);
    });

    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('team-beta');
    expect(useSettingsStore.getState().sprintDashboardTeamProfiles.map((teamProfile) => teamProfile.id)).toEqual([
      'team-alpha',
      'team-beta',
    ]);
  });

  it('does not autosave the previous team selection into the newly active team during a switch', () => {
    useSettingsStore.getState().setSprintDashboardTeamProfiles([
      {
        id: 'team-alpha',
        name: 'Alpha',
        projectKey: 'ALPHA',
        boardId: '11',
        boardName: 'Alpha Board',
        boardType: 'scrum',
        scopeMode: 'sprint',
        selectedSprintId: '101',
        selectedFixVersion: '',
        selectedPiValue: '',
      },
      {
        id: 'team-beta',
        name: 'Beta',
        projectKey: 'BETA',
        boardId: '22',
        boardName: 'Beta Board',
        boardType: 'kanban',
        scopeMode: 'pi',
        selectedSprintId: '',
        selectedFixVersion: 'Release 25.2',
        selectedPiValue: 'PI-25.2',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeamProfileId('team-alpha');
    mockState.projectKey = 'ALPHA';
    mockState.boardId = 11;
    mockState.selectedBoardName = 'Alpha Board';
    mockState.boardType = 'scrum';
    mockState.scopeMode = 'sprint';
    mockState.selectedSprintId = 101;
    mockState.selectedFixVersionName = '';
    mockState.selectedPiValue = '';

    render(<SprintDashboardView />);

    act(() => {
      useSettingsStore.getState().setSprintDashboardActiveTeamProfileId('team-beta');
    });

    expect(
      useSettingsStore
        .getState()
        .sprintDashboardTeamProfiles.find((teamProfile) => teamProfile.id === 'team-beta'),
    ).toEqual({
      id: 'team-beta',
      name: 'Beta',
      projectKey: 'BETA',
      boardId: '22',
      boardName: 'Beta Board',
      boardType: 'kanban',
      scopeMode: 'pi',
      selectedSprintId: '',
      selectedFixVersion: 'Release 25.2',
      selectedPiValue: 'PI-25.2',
    });
  });

  it('shows a team board name when a legacy profile label only mirrors the project key', () => {
    mockState.projectKey = 'ALPHA';
    mockState.boardId = 11;
    mockState.selectedBoardName = 'Payments Team Board';
    mockState.boardType = 'scrum';
    mockState.scopeMode = 'sprint';
    mockState.selectedSprintId = 101;
    mockState.selectedFixVersionName = '';
    mockState.selectedPiValue = '';
    useSettingsStore.getState().setSprintDashboardTeamProfiles([
      {
        id: 'team-alpha',
        name: 'ALPHA',
        projectKey: 'ALPHA',
        boardId: '11',
        boardName: 'Payments Team Board',
        boardType: 'scrum',
        scopeMode: 'sprint',
        selectedSprintId: '101',
        selectedFixVersion: '',
        selectedPiValue: '',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeamProfileId('team-alpha');

    render(<SprintDashboardView />);

    expect(
      screen.getByRole('option', { name: 'Payments Team Board' }),
    ).toBeInTheDocument();
  });

  it('keeps the Team Name / Alias field in sync with the active saved team', () => {
    mockState.activeTab = 'settings';
    useSettingsStore.getState().setSprintDashboardTeamProfiles([
      {
        id: 'team-alpha',
        name: 'Payments Team',
        projectKey: 'ALPHA',
        boardId: '11',
        boardName: 'Payments Team Board',
        boardType: 'scrum',
        scopeMode: 'sprint',
        selectedSprintId: '101',
        selectedFixVersion: '',
        selectedPiValue: '',
      },
      {
        id: 'team-beta',
        name: 'Platform Team',
        projectKey: 'BETA',
        boardId: '22',
        boardName: 'Platform Team Board',
        boardType: 'kanban',
        scopeMode: 'pi',
        selectedSprintId: '',
        selectedFixVersion: 'Release 25.2',
        selectedPiValue: 'PI-25.2',
      },
    ]);
    useSettingsStore.getState().setSprintDashboardActiveTeamProfileId('team-alpha');

    render(<SprintDashboardView />);

    const teamAliasInput = screen.getByRole('textbox', { name: 'Team Name / Alias' });
    expect(teamAliasInput).toHaveValue('Payments Team');

    fireEvent.change(screen.getByLabelText('Dashboard Team'), {
      target: { value: 'team-beta' },
    });

    expect(screen.getByRole('textbox', { name: 'Team Name / Alias' })).toHaveValue(
      'Platform Team',
    );
  });

  it('does not auto-load when no dashboard selection has been saved yet', () => {
    mockState.activeTab = 'overview';
    mockState.projectKey = '';
    mockState.boardId = null;
    mockState.sprintInfo = null;
    mockState.sprintIssues = [];

    render(<SprintDashboardView />);

    expect(mockActions.loadSprint).not.toHaveBeenCalled();
  });

  it('renders By Assignee swim lanes when issues are present', () => {
    mockState.activeTab = 'assignee';
    render(<SprintDashboardView />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders the Blockers section when blockers are present', () => {
    mockState.activeTab = 'blockers';
    render(<SprintDashboardView />);

    // The Blockers tab has a section heading "Blocked"
    expect(screen.getByRole('heading', { name: 'Blocked' })).toBeInTheDocument();
  });

  it('renders the Standup workspace', () => {
    mockState.activeTab = 'standup';
    render(<SprintDashboardView />);

    expect(screen.getByText('Mock Standup Workspace')).toBeInTheDocument();
  });

  it('renders the burn-down chart when on Overview tab', () => {
    mockState.activeTab = 'overview';
    render(<SprintDashboardView />);

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders the extended tab buttons with PI Review replacing the separate capacity workspace', () => {
    render(<SprintDashboardView />);

    expect(screen.getByRole('tab', { name: 'Metrics' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Pipeline' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Planning' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Feature Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PI Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pointing' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Releases' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Capacity' })).not.toBeInTheDocument();
  });

  it('renders the Metrics tab with sprint completion statistics', () => {
    mockState.activeTab = 'metrics';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Sprint Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Predictability' })).toBeInTheDocument();
  });

  it('renders the Pipeline tab with the REL-centered pipeline layout', () => {
    mockState.activeTab = 'pipeline';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Release Pipeline' })).toBeInTheDocument();
    expect(screen.getByText(/rel stories anchor the pipeline/i)).toBeInTheDocument();
  });

  it('renders the Planning tab with backlog planning controls', () => {
    mockState.activeTab = 'planning';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Backlog Planning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy follow-up report/i })).toBeInTheDocument();
  });

  it('renders the Pointing tab with the team dashboard pointing flow', () => {
    mockState.activeTab = 'pointing';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Story Pointing' })).toBeInTheDocument();
    expect(screen.getByText('Wire up the backend')).toBeInTheDocument();
  });

  it('renders the PI Review tab with the Team Dashboard authoring workspace', () => {
    mockState.activeTab = 'pireview';
    render(<SprintDashboardView />);

    expect(screen.getByText('Mock Team Dashboard PI Review')).toBeInTheDocument();
  });

  it('renders the Feature Review tab with the Team Dashboard feature workspace', () => {
    mockState.activeTab = 'featurereview';
    render(<SprintDashboardView />);

    expect(screen.getByText('Mock Team Dashboard Feature Review')).toBeInTheDocument();
  });

  it('renders the Hygiene tab with the Team Dashboard hygiene workspace', () => {
    mockState.activeTab = 'hygiene';
    mockState.projectKey = 'TBX';
    render(<SprintDashboardView />);

    expect(screen.getByText('Mock Team Dashboard Hygiene (TBX)')).toBeInTheDocument();
  });

  it('renders the Release Radar using project versions', async () => {
    mockState.activeTab = 'releases';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([
          { id: 'rel-1', name: 'Release 24.1', releaseDate: '2099-01-15', released: false, archived: false },
        ]);
      }
      if (path.includes('fixVersion%3D%22Release%2024.1%22')) {
        return Promise.resolve({
          issues: [
            {
              id: 'TBX-99',
              key: 'TBX-99',
              fields: {
                summary: 'Prepare production deploy',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                assignee: { displayName: 'Alice' },
                issuetype: { name: 'Story', iconUrl: 'story.png' },
                priority: { name: 'High', iconUrl: 'priority.png' },
              },
            },
          ],
        });
      }

      return Promise.resolve({ values: [] });
    });
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Release Radar' })).toBeInTheDocument();
    expect(await screen.findByText('Release 24.1')).toBeInTheDocument();
    expect(screen.getByText(/1 release/i)).toBeInTheDocument();
  });

  it('unlocks the hidden Rovo release prompt flow and builds a structured prompt', async () => {
    mockState.activeTab = 'releases';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([
          { id: 'rel-1', name: 'Release 24.1', releaseDate: '2099-01-15', released: false, archived: false },
        ]);
      }
      if (path.startsWith('/rest/api/2/search?jql=')) {
        return Promise.resolve({
          issues: [
            {
              id: 'TBX-99',
              key: 'TBX-99',
              fields: {
                summary: 'Prepare production deploy',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                assignee: { displayName: 'Alice' },
                issuetype: { name: 'Story', iconUrl: 'story.png' },
                priority: { name: 'High', iconUrl: 'priority.png' },
                description: '<p>Deploy the production-ready release workflow.</p>',
                customfield_10200: 'Given the release is ready, when it is deployed, then users can consume the new flow.',
              },
            },
          ],
        });
      }

      return Promise.resolve({ values: [] });
    });

    render(<SprintDashboardView />);

    expect(await screen.findByText('Release 24.1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true });
    const passphraseInput = screen.getByLabelText('Protected tools passphrase');
    fireEvent.change(passphraseInput, { target: { value: 'rovonow' } });
    fireEvent.keyDown(passphraseInput, { key: 'Enter' });

    const buildPromptButton = await screen.findByRole('button', { name: /build rovo prompt/i });
    fireEvent.click(buildPromptButton);

    const promptTextArea = await screen.findByLabelText('Rovo release prompt');
    expect((promptTextArea as HTMLTextAreaElement).value).toContain('Respond ONLY with valid JSON.');
    expect((promptTextArea as HTMLTextAreaElement).value).toContain('"items": [');
    expect((promptTextArea as HTMLTextAreaElement).value).toContain('TBX-99');
  });

  it('does not expose a visible unlock control for the hidden release flow', async () => {
    mockState.activeTab = 'releases';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([
          { id: 'rel-1', name: 'Release 24.1', releaseDate: '2099-01-15', released: false, archived: false },
        ]);
      }
      if (path.startsWith('/rest/api/2/search?jql=')) {
        return Promise.resolve({ issues: [] });
      }

      return Promise.resolve({ values: [] });
    });

    render(<SprintDashboardView />);

    expect(await screen.findByText('Release 24.1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unlock hidden prompt/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Protected tools passphrase')).not.toBeInTheDocument();
  });

  it('renders a release-notes table from a pasted Rovo response', async () => {
    mockState.activeTab = 'releases';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([
          { id: 'rel-1', name: 'Release 24.1', releaseDate: '2099-01-15', released: false, archived: false },
        ]);
      }
      if (path.startsWith('/rest/api/2/search?jql=')) {
        return Promise.resolve({
          issues: [
            {
              id: 'TBX-99',
              key: 'TBX-99',
              fields: {
                summary: 'Prepare production deploy',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                assignee: { displayName: 'Alice Johnson' },
                issuetype: { name: 'Story', iconUrl: 'story.png' },
                priority: { name: 'High', iconUrl: 'priority.png' },
                description: 'Release details',
                customfield_10200: 'Validation notes',
              },
            },
          ],
        });
      }

      return Promise.resolve({ values: [] });
    });

    const { rerender } = render(<SprintDashboardView />);

    expect(await screen.findByText('Release 24.1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true });
    const passphraseInput = screen.getByLabelText('Protected tools passphrase');
    fireEvent.change(passphraseInput, { target: { value: 'rovonow' } });
    fireEvent.keyDown(passphraseInput, { key: 'Enter' });

    fireEvent.click(await screen.findByRole('button', { name: /paste rovo response/i }));

    const responseTextArea = await screen.findByLabelText('Rovo release response');
    fireEvent.change(responseTextArea, {
      target: {
        value: JSON.stringify({
          releaseName: 'Release 24.1',
          releaseSummary: 'Delivers the hidden Rovo workflow for release notes.',
          items: [
            {
              issueKey: 'TBX-99',
              title: 'Rovo release note workflow',
              releaseNote: 'Adds a prompt-and-import workflow for release notes.',
              customerImpact: 'Release managers can draft release notes faster.',
              technicalDetails: 'Toolbox parses the JSON response and renders a table.',
              risks: 'None.',
              validation: 'Validated with unit and UI tests.',
            },
          ],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /render release notes table/i }));

    expect(await screen.findByRole('heading', { name: 'Release 24.1 Release Notes' })).toBeInTheDocument();
    expect(screen.getByText('Delivers the hidden Rovo workflow for release notes.')).toBeInTheDocument();
    expect(screen.getByText('Rovo release note workflow')).toBeInTheDocument();
    expect(screen.getByText('Release managers can draft release notes faster.')).toBeInTheDocument();
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();

    mockState.activeTab = 'overview';
    rerender(<SprintDashboardView />);
    mockState.activeTab = 'releases';
    rerender(<SprintDashboardView />);

    expect(await screen.findByRole('button', { name: /paste rovo response/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Release 24.1 Release Notes' })).toBeInTheDocument();
    expect(screen.getByText('Delivers the hidden Rovo workflow for release notes.')).toBeInTheDocument();
  });

  it('renders a release-notes table from the automated Rovo exchange (Run via Rovo)', async () => {
    mockState.activeTab = 'releases';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([
          { id: 'rel-1', name: 'Release 24.1', releaseDate: '2099-01-15', released: false, archived: false },
        ]);
      }
      if (path.startsWith('/rest/api/2/search?jql=')) {
        return Promise.resolve({
          issues: [
            { id: 'TBX-99', key: 'TBX-99', fields: { summary: 'Prepare production deploy', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Alice Johnson' }, issuetype: { name: 'Story', iconUrl: 'story.png' }, priority: { name: 'High', iconUrl: 'priority.png' }, description: 'Release details', customfield_10200: 'Validation notes' } },
          ],
        });
      }
      return Promise.resolve({ values: [] });
    });

    // The automated exchange returns Rovo's deterministic JSON directly.
    mockRunRovoExchange.mockResolvedValue({
      ok: true,
      response: JSON.stringify({
        releaseName: 'Release 24.1',
        releaseSummary: 'Auto-delivered release notes via Rovo.',
        items: [{ issueKey: 'TBX-99', title: 'Automated release note', releaseNote: 'Generated without copy-paste.', customerImpact: 'Faster drafting.', technicalDetails: 'Dispatch + poll + parse.', risks: 'None.', validation: 'Covered by tests.' }],
      }),
    });

    render(<SprintDashboardView />);
    expect(await screen.findByText('Release 24.1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true });
    const passphraseInput = screen.getByLabelText('Protected tools passphrase');
    fireEvent.change(passphraseInput, { target: { value: 'rovonow' } });
    fireEvent.keyDown(passphraseInput, { key: 'Enter' });

    // Open the prompt modal, then run the automated exchange instead of copy-paste.
    fireEvent.click(await screen.findByRole('button', { name: /Build Rovo Prompt/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Run via Rovo \(auto\)/i }));

    await waitFor(() => expect(mockRunRovoExchange).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Release 24.1 Release Notes' })).toBeInTheDocument();
    expect(screen.getByText('Auto-delivered release notes via Rovo.')).toBeInTheDocument();
    expect(screen.getByText('Automated release note')).toBeInTheDocument();
  });

  it('copies rendered release notes to the clipboard as an image', async () => {
    mockState.activeTab = 'releases';
    mockJiraGet.mockImplementation((path: string) => {
      if (path === '/rest/api/2/project/TBX/versions') {
        return Promise.resolve([
          { id: 'rel-1', name: 'Release 24.1', releaseDate: '2099-01-15', released: false, archived: false },
        ]);
      }
      if (path.startsWith('/rest/api/2/search?jql=')) {
        return Promise.resolve({
          issues: [
            {
              id: 'TBX-99',
              key: 'TBX-99',
              fields: {
                summary: 'Prepare production deploy',
                status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
                assignee: { displayName: 'Alice Johnson' },
                issuetype: { name: 'Story', iconUrl: 'story.png' },
                priority: { name: 'High', iconUrl: 'priority.png' },
                description: 'Release details',
                customfield_10200: 'Validation notes',
              },
            },
          ],
        });
      }

      return Promise.resolve({ values: [] });
    });
    mockCopyElementImageToClipboard.mockResolvedValue(undefined);

    render(<SprintDashboardView />);

    expect(await screen.findByText('Release 24.1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true, altKey: true });
    const passphraseInput = screen.getByLabelText('Protected tools passphrase');
    fireEvent.change(passphraseInput, { target: { value: 'rovonow' } });
    fireEvent.keyDown(passphraseInput, { key: 'Enter' });

    fireEvent.click(await screen.findByRole('button', { name: /paste rovo response/i }));

    const responseTextArea = await screen.findByLabelText('Rovo release response');
    fireEvent.change(responseTextArea, {
      target: {
        value: JSON.stringify({
          releaseName: 'Release 24.1',
          releaseSummary: 'Delivers the hidden Rovo workflow for release notes.',
          items: [
            {
              issueKey: 'TBX-99',
              title: 'Rovo release note workflow',
              releaseNote: 'Adds a prompt-and-import workflow for release notes.',
              customerImpact: 'Release managers can draft release notes faster.',
              technicalDetails: 'Toolbox parses the JSON response and renders a table.',
              risks: 'None.',
              validation: 'Validated with unit and UI tests.',
            },
          ],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /render release notes table/i }));
    expect(screen.getByRole('table').parentElement).toHaveAttribute('data-export-expand', 'true');
    fireEvent.click(await screen.findByRole('button', { name: /copy release notes/i }));

    expect(mockCopyElementImageToClipboard).toHaveBeenCalledTimes(1);
    // The captured element is the release-notes section itself (the first argument).
    expect((mockCopyElementImageToClipboard.mock.calls[0][0] as HTMLElement).className).toContain('releaseNotesSection');
  });

  // ── New feature tests ──

  it('shows the BoardPicker when availableBoards are populated in Settings', () => {
    mockState.activeTab = 'settings';
    mockState.availableBoards = [
      { id: 1, name: 'Team Alpha Board', type: 'scrum', projectKey: 'TBX' },
      { id: 2, name: 'Team Beta Board', type: 'kanban', projectKey: 'TBX' },
    ];
    render(<SprintDashboardView />);

    expect(screen.getByPlaceholderText(/search boards/i)).toBeInTheDocument();
    expect(screen.getByText('Team Alpha Board')).toBeInTheDocument();
    expect(screen.getByText('Team Beta Board')).toBeInTheDocument();
  });

  it('places project and board selection before the team save controls in Settings', () => {
    mockState.activeTab = 'settings';
    mockState.availableBoards = [
      { id: 1, name: 'Team Alpha Board', type: 'scrum', projectKey: 'TBX' },
    ];
    render(<SprintDashboardView />);

    const projectKeyInput = screen.getByLabelText('Project Key');
    const teamAliasInput = screen.getByLabelText('Team Name / Alias');
    expect(
      projectKeyInput.compareDocumentPosition(teamAliasInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the advanced config fields in Settings tab', () => {
    mockState.activeTab = 'settings';
    render(<SprintDashboardView />);

    expect(screen.getByLabelText(/stale threshold/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/story point scale/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scrum velocity window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cycle-time baseline/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/kanban throughput window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/story points field/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/epic link field/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detect' })).toBeInTheDocument();
    expect(screen.getByText('Mock Roster Workspace')).toBeInTheDocument();
  });

  it('renders Move to Sprint buttons in the Assignee tab', () => {
    mockState.activeTab = 'assignee';
    render(<SprintDashboardView />);

    // Each issue card should have a "Move to sprint" button.
    const moveButtons = screen.getAllByRole('button', { name: /move to sprint/i });
    expect(moveButtons.length).toBeGreaterThan(0);
  });

  it('renders expand buttons on issue cards', () => {
    mockState.activeTab = 'assignee';
    render(<SprintDashboardView />);

    expect(screen.getByRole('button', { name: /expand details for tbx-10/i })).toBeInTheDocument();
  });

  it('uses the configured stale days threshold in the Blockers tab heading', () => {
    mockState.activeTab = 'blockers';
    mockConfig.staleDaysThreshold = 7;
    render(<SprintDashboardView />);

    expect(screen.getByText(/stale.*7\+ days/i)).toBeInTheDocument();
    mockConfig.staleDaysThreshold = 5; // reset
  });

  it('renders Jira issue keys as external links that open in a new tab', () => {
    mockState.activeTab = 'overview';
    render(<SprintDashboardView />);

    const link = screen.getByRole('link', { name: 'TBX-10' });
    expect(link).toHaveAttribute('href', 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/TBX-10');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});
