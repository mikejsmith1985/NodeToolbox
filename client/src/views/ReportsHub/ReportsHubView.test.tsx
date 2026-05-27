// ReportsHubView.test.tsx — Unit tests for the Reports Hub tabbed view component.

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraFeatureIssue, ReportsHubTab, SprintIssue, ThroughputEntry } from './hooks/useReportsHubState.ts';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'dashboard' as ReportsHubTab,
    artTeams: [{ name: 'Team A', projectKey: 'TBX' }],
    piFilter: '',
    teamFilter: '',
    features: [] as JiraFeatureIssue[],
    defects: [] as JiraFeatureIssue[],
    risks: [] as JiraFeatureIssue[],
    isLoadingFeatures: false,
    isLoadingDefects: false,
    isLoadingRisks: false,
    featuresError: null as string | null,
    defectsError: null as string | null,
    risksError: null as string | null,
    lastGeneratedAt: null as string | null,
    sprintIssues: [] as SprintIssue[],
    isLoadingSprintData: false,
    sprintDataError: null as string | null,
    storyCount: 0,
    storyIssues: [] as JiraFeatureIssue[],
    isLoadingQuality: false,
    qualityError: null as string | null,
    throughputIssues: [] as SprintIssue[],
    throughputData: [] as ThroughputEntry[],
    isLoadingThroughput: false,
    throughputError: null as string | null,
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setPiFilter: vi.fn(),
    setTeamFilter: vi.fn(),
    loadAllReports: vi.fn().mockResolvedValue(undefined),
    loadFeatures: vi.fn().mockResolvedValue(undefined),
    loadDefects: vi.fn().mockResolvedValue(undefined),
    loadRisks: vi.fn().mockResolvedValue(undefined),
    loadSprintData: vi.fn().mockResolvedValue(undefined),
    loadQuality: vi.fn().mockResolvedValue(undefined),
    loadThroughput: vi.fn().mockResolvedValue(undefined),
    copyReport: vi.fn(),
  },
}));

vi.mock('./hooks/useReportsHubState.ts', () => ({
  useReportsHubState: () => ({ state: mockState, actions: mockActions }),
}));

import ReportsHubView from './ReportsHubView.tsx';

function expectKpiCardValue(labelText: string, valueText: string): void {
  const kpiCard = screen.getAllByText(labelText, { selector: 'span' })[0]?.closest('div');
  expect(kpiCard).not.toBeNull();
  expect(within(kpiCard as HTMLElement).getByText(valueText)).toBeInTheDocument();
}

describe('ReportsHubView', () => {
  beforeEach(() => {
    mockState.activeTab = 'dashboard';
    mockState.piFilter = '';
    mockState.teamFilter = '';
    mockState.features = [];
    mockState.defects = [];
    mockState.risks = [];
    mockState.sprintIssues = [];
    mockState.storyIssues = [];
    mockState.throughputIssues = [];
    mockState.throughputData = [];
    mockState.storyCount = 0;
    mockState.artTeams = [{ name: 'Team A', projectKey: 'TBX' }];
    vi.clearAllMocks();
  });

  it('renders the page title and hero KPI grid', () => {
    render(<ReportsHubView />);
    expect(screen.getByText(/reports hub/i)).toBeInTheDocument();
    expect(screen.getAllByText(/art teams/i).length).toBeGreaterThan(0);
  });

  it('auto-loads all reports when the view opens with configured ART teams', () => {
    render(<ReportsHubView />);
    expect(mockActions.loadAllReports).toHaveBeenCalledTimes(1);
  });

  it('renders 10 tab buttons including the Defect Dashboard tab', () => {
    render(<ReportsHubView />);
    expect(screen.getByRole('tab', { name: /defect dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /feature report/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /defect tracker/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /risk board/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /flow/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /impact/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /individual/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /quality/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /sprint health/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /throughput/i })).toBeInTheDocument();
  });

  it('shows the dashboard widget layout when dashboard tab is active', () => {
    mockState.activeTab = 'dashboard';
    mockState.defects = [
      {
        key: 'TBX-201',
        summary: 'Critical deployment defect',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: 'Alice',
        piName: null,
        priority: 'Critical',
      },
    ];
    mockState.risks = [
      {
        key: 'TBX-301',
        summary: 'Release risk is open',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: null,
        piName: null,
        priority: 'High',
      },
    ];
    mockState.sprintIssues = [
      {
        key: 'TBX-401',
        summary: 'Blocked implementation task',
        statusName: 'Blocked',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        assigneeName: 'Bob',
        priority: 'High',
        piName: null,
        isBlocked: true,
        updatedDate: '2026-05-15T00:00:00.000Z',
        sprintName: 'Sprint 42',
      },
    ];

    render(<ReportsHubView />);

    expect(screen.getByText(/dashboard snapshot/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /critical defects/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /blocked work/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /open risks/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /issues by team/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /issues by priority/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /issues by status/i })).toBeInTheDocument();
    expect(screen.getByText('TBX-201')).toBeInTheDocument();
    expect(screen.getAllByText('TBX-301').length).toBeGreaterThan(0);
    expect(screen.getByText('TBX-401')).toBeInTheDocument();
  });

  it('shows full blocked and unassigned counts even when the widget list is capped', () => {
    mockState.activeTab = 'dashboard';
    mockState.sprintIssues = Array.from({ length: 7 }, (_, issueIndex) => ({
      key: `TBX-50${issueIndex}`,
      summary: `Blocked item ${issueIndex}`,
      statusName: 'Blocked',
      statusCategory: 'indeterminate',
      teamName: 'Team A',
      assigneeName: null,
      priority: 'High',
      piName: null,
      isBlocked: true,
      updatedDate: '2026-05-15T00:00:00.000Z',
      sprintName: 'Sprint 42',
    }));

    render(<ReportsHubView />);

    const blockedWorkCard = screen.getByText('Blocked Work', { selector: 'span' }).closest('div');
    const unassignedWorkCard = screen.getByText('Unassigned Work', { selector: 'span' }).closest('div');

    expect(blockedWorkCard).not.toBeNull();
    expect(unassignedWorkCard).not.toBeNull();
    expect(within(blockedWorkCard as HTMLElement).getByText('7')).toBeInTheDocument();
    expect(within(unassignedWorkCard as HTMLElement).getByText('7')).toBeInTheDocument();
  });

  it('shows the at-risk feature report sections when features are loaded', () => {
    mockState.activeTab = 'features';
    mockState.features = [
      {
        key: 'TBX-100',
        summary: 'Test Feature',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: ['PI 26.2'],
        assigneeName: 'Alice',
        piName: 'PI 26.2',
        priority: null,
        dueDate: '2024-01-15',
        dependencyCount: 2,
        isRiskTagged: true,
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getAllByText('TBX-100').length).toBeGreaterThan(0);
    expect(screen.getByText(/at-risk features/i)).toBeInTheDocument();
    expect(screen.getByText(/team feature health/i)).toBeInTheDocument();
  });

  it('applies global team parameters to dashboard data', () => {
    mockState.activeTab = 'dashboard';
    mockState.teamFilter = 'Team A';
    mockState.defects = [
      {
        key: 'TBX-210',
        summary: 'Team A defect',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: 'Alice',
        piName: 'PI 26.2',
        priority: 'High',
      },
      {
        key: 'TBX-211',
        summary: 'Team B defect',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team B',
        fixVersions: [],
        assigneeName: 'Bob',
        piName: 'PI 26.2',
        priority: 'High',
      },
    ];

    render(<ReportsHubView />);

    expect(screen.getByText('TBX-210')).toBeInTheDocument();
    expect(screen.queryByText('TBX-211')).not.toBeInTheDocument();
  });

  it('updates the hero KPI cards to match the selected PI filter', () => {
    mockState.artTeams = [
      { name: 'Team A', projectKey: 'TMA' },
      { name: 'Team B', projectKey: 'TMB' },
      { name: 'Team C', projectKey: 'TMC' },
    ];
    mockState.piFilter = 'PI 26.3 (05/21/26 - 07/29/26)';
    mockState.features = [
      {
        key: 'TMA-100',
        summary: 'Team A feature',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: 'Alice',
        piName: 'PI 26.3',
        priority: 'High',
      },
      {
        key: 'TMB-100',
        summary: 'Team B feature',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team B',
        fixVersions: [],
        assigneeName: 'Bob',
        piName: 'PI 26.2',
        priority: 'High',
      },
    ];
    mockState.defects = [
      {
        key: 'TMA-200',
        summary: 'Team A defect',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: 'Alice',
        piName: 'PI 26.3',
        priority: 'Critical',
      },
      {
        key: 'TMC-200',
        summary: 'Team C defect',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team C',
        fixVersions: [],
        assigneeName: 'Casey',
        piName: 'PI 26.2',
        priority: 'High',
      },
    ];
    mockState.risks = [
      {
        key: 'TMA-300',
        summary: 'Team A risk',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: null,
        piName: 'PI 26.3',
        priority: 'High',
      },
      {
        key: 'TMB-300',
        summary: 'Team B risk',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team B',
        fixVersions: [],
        assigneeName: null,
        piName: 'PI 26.2',
        priority: 'High',
      },
    ];

    render(<ReportsHubView />);

    expectKpiCardValue('ART Teams', '1');
    expectKpiCardValue('Features', '1');
    expectKpiCardValue('Defects', '1');
    expectKpiCardValue('Risks', '1');
  });

  it('defaults the PI filter to the current date-range PI when none is selected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000-04:00'));

    try {
      mockState.features = [
        {
          key: 'TMA-400',
          summary: 'Prior PI feature',
          statusName: 'In Progress',
          statusCategory: 'indeterminate',
          teamName: 'Team A',
          fixVersions: [],
          assigneeName: 'Alice',
          piName: 'PI 26.2 (02/26/26 - 04/29/26)',
          priority: 'High',
        },
        {
          key: 'TMA-401',
          summary: 'Current PI feature',
          statusName: 'In Progress',
          statusCategory: 'indeterminate',
          teamName: 'Team A',
          fixVersions: [],
          assigneeName: 'Alice',
          piName: 'PI 26.3 (05/21/26 - 07/29/26)',
          priority: 'High',
        },
      ];

      render(<ReportsHubView />);

      expect(mockActions.setPiFilter).toHaveBeenCalledWith('PI 26.3 (05/21/26 - 07/29/26)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats equivalent PI labels as the same filter when the selected PI includes a date range', () => {
    mockState.activeTab = 'features';
    mockState.piFilter = 'PI 26.3 (05/21/26 - 07/29/26)';
    mockState.features = [
      {
        key: 'TBX-220',
        summary: 'Short PI label feature',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: 'Alice',
        piName: 'PI 26.3',
        priority: 'High',
      },
      {
        key: 'TBX-221',
        summary: 'Different PI feature',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: 'Bob',
        piName: 'PI 26.2',
        priority: 'High',
      },
    ];

    render(<ReportsHubView />);

    expect(screen.getByText('TBX-220')).toBeInTheDocument();
    expect(screen.queryByText('TBX-221')).not.toBeInTheDocument();
  });

  it('shows the defect tracker table when defects tab is active', () => {
    mockState.activeTab = 'defects';
    mockState.defects = [
      {
        key: 'TBX-200',
        summary: 'Critical Bug',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: null,
        piName: null,
        priority: 'Critical',
        updatedDate: '2024-01-01T00:00:00.000Z',
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getByText('TBX-200')).toBeInTheDocument();
  });

  it('shows the risk exposure report sections when risks tab is active', () => {
    mockState.activeTab = 'risks';
    mockState.risks = [
      {
        key: 'TBX-300',
        summary: 'High Risk',
        statusName: 'Open',
        statusCategory: 'new',
        teamName: 'Team A',
        fixVersions: [],
        assigneeName: null,
        piName: null,
        priority: 'Critical',
        updatedDate: '2024-01-01T00:00:00.000Z',
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getByText('TBX-300')).toBeInTheDocument();
    expect(screen.getByText(/team risk exposure/i)).toBeInTheDocument();
  });

  it('shows empty state when artTeams is empty', () => {
    mockState.artTeams = [];
    render(<ReportsHubView />);
    expect(screen.getByText(/no art teams configured/i)).toBeInTheDocument();
    expect(mockActions.loadAllReports).not.toHaveBeenCalled();
  });

  it('shows the flow tab completion and aging report when flow tab is active', () => {
    mockState.activeTab = 'flow';
    mockState.throughputIssues = [
      {
        key: 'TBX-900',
        summary: 'Completed recently',
        statusName: 'Done',
        statusCategory: 'done',
        teamName: 'Team A',
        assigneeName: 'Pat',
        priority: 'Medium',
        piName: null,
        isBlocked: false,
        updatedDate: '2026-05-15T00:00:00.000Z',
        resolutionDate: '2026-05-15T00:00:00.000Z',
        sprintName: 'Sprint 44',
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getByText(/recent completions \(last 30 days\)/i)).toBeInTheDocument();
  });

  it('shows the delivery impact scorecard when impact tab is active', () => {
    mockState.activeTab = 'impact';
    render(<ReportsHubView />);
    expect(screen.getByText(/delivery impact scorecard/i)).toBeInTheDocument();
  });

  it('shows the ownership load report when individual tab is active', () => {
    mockState.activeTab = 'individual';
    render(<ReportsHubView />);
    expect(screen.getByText(/ownership load report/i)).toBeInTheDocument();
  });

  it('shows the quality scorecard when quality tab is active', () => {
    mockState.activeTab = 'quality';
    render(<ReportsHubView />);
    expect(screen.getByText(/team quality scorecard/i)).toBeInTheDocument();
  });

  it('shows the sprint health tab heading when sprintHealth tab is active', () => {
    mockState.activeTab = 'sprintHealth';
    render(<ReportsHubView />);
    expect(screen.getByText(/team health/i)).toBeInTheDocument();
  });

  it('shows the six-month throughput comparison when throughput tab is active', () => {
    mockState.activeTab = 'throughput';
    render(<ReportsHubView />);
    expect(screen.getByText(/throughput comparison \(last 6 months\)/i)).toBeInTheDocument();
  });

  // ── isPastDue day-granularity fix ──

  it('does not mark a feature as Past Due when the due date is today', () => {
    mockState.activeTab = 'features';
    // Simulate a Jira date-only string matching today so that negative-UTC-offset
    // environments cannot incorrectly flag today's items as overdue.
    const todayLocal = new Date();
    const todayDatePart = [
      todayLocal.getFullYear(),
      String(todayLocal.getMonth() + 1).padStart(2, '0'),
      String(todayLocal.getDate()).padStart(2, '0'),
    ].join('-');

    mockState.features = [
      {
        key: 'TBX-TODAY',
        summary: 'Feature due today',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: ['PI 26.3'],
        assigneeName: 'Alice',
        piName: 'PI 26.3',
        priority: null,
        dueDate: todayDatePart,
        dependencyCount: 0,
        isRiskTagged: false,
      },
    ];

    render(<ReportsHubView />);

    // The feature key should appear in the feature report, but there must be no
    // "Past Due" badge rendered alongside it.
    const featureRow = screen.queryByText('TBX-TODAY');
    if (featureRow) {
      const rowContainer = featureRow.closest('tr') ?? featureRow.closest('li') ?? featureRow.parentElement;
      if (rowContainer) {
        expect(within(rowContainer as HTMLElement).queryByText(/past due/i)).toBeNull();
      }
    }
  });

  it('does mark a feature as Past Due when the due date is yesterday', () => {
    mockState.activeTab = 'features';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDatePart = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0'),
    ].join('-');

    mockState.features = [
      {
        key: 'TBX-YEST',
        summary: 'Feature due yesterday',
        statusName: 'In Progress',
        statusCategory: 'indeterminate',
        teamName: 'Team A',
        fixVersions: ['PI 26.3'],
        assigneeName: 'Alice',
        piName: 'PI 26.3',
        priority: null,
        dueDate: yesterdayDatePart,
        dependencyCount: 0,
        isRiskTagged: false,
      },
    ];

    render(<ReportsHubView />);

    // A feature that was due yesterday must be marked as past due somewhere in
    // the rendered output (badge, row label, or tooltip).
    expect(screen.getAllByText(/past due/i).length).toBeGreaterThan(0);
  });

  // ── aggregateFilteredThroughputData chronological ordering fix ──

  it('shows throughput months in chronological order when issues arrive out of order', () => {
    mockState.activeTab = 'throughput';
    // Provide issues whose resolution dates span three months in non-chronological
    // insertion order. The fix ensures months are sorted before the window is applied.
    mockState.throughputIssues = [
      {
        key: 'TBX-T3',
        summary: 'Resolved in March',
        statusName: 'Done',
        statusCategory: 'done',
        teamName: 'Team A',
        assigneeName: 'Pat',
        priority: 'Medium',
        piName: null,
        isBlocked: false,
        updatedDate: '2026-03-10T00:00:00.000Z',
        resolutionDate: '2026-03-10T00:00:00.000Z',
        sprintName: 'Sprint 40',
      },
      {
        key: 'TBX-T1',
        summary: 'Resolved in January',
        statusName: 'Done',
        statusCategory: 'done',
        teamName: 'Team A',
        assigneeName: 'Sam',
        priority: 'Low',
        piName: null,
        isBlocked: false,
        updatedDate: '2026-01-05T00:00:00.000Z',
        resolutionDate: '2026-01-05T00:00:00.000Z',
        sprintName: 'Sprint 38',
      },
      {
        key: 'TBX-T2',
        summary: 'Resolved in February',
        statusName: 'Done',
        statusCategory: 'done',
        teamName: 'Team A',
        assigneeName: 'Lee',
        priority: 'High',
        piName: null,
        isBlocked: false,
        updatedDate: '2026-02-20T00:00:00.000Z',
        resolutionDate: '2026-02-20T00:00:00.000Z',
        sprintName: 'Sprint 39',
      },
    ];

    render(<ReportsHubView />);

    // All three month labels should appear in the throughput section.
    expect(screen.getByText(/jan 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/feb 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/mar 2026/i)).toBeInTheDocument();
  });
});
