// ReportsHubView.test.tsx — Unit tests for the Reports Hub tabbed view component.

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraFeatureIssue, ReportsHubTab, SprintIssue, ThroughputEntry } from './hooks/useReportsHubState.ts';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'features' as ReportsHubTab,
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
    isLoadingQuality: false,
    qualityError: null as string | null,
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

describe('ReportsHubView', () => {
  beforeEach(() => {
    mockState.activeTab = 'features';
    mockState.features = [];
    mockState.defects = [];
    mockState.risks = [];
    mockState.sprintIssues = [];
    mockState.throughputData = [];
    mockState.storyCount = 0;
    mockState.artTeams = [{ name: 'Team A', projectKey: 'TBX' }];
    vi.clearAllMocks();
  });

  it('renders the page title and hero KPI grid', () => {
    render(<ReportsHubView />);
    expect(screen.getByText(/reports hub/i)).toBeInTheDocument();
    expect(screen.getByText(/art teams/i)).toBeInTheDocument();
  });

  it('renders 10 tab buttons including the dashboard tab', () => {
    render(<ReportsHubView />);
    expect(screen.getByRole('tab', { name: /dashboard/i })).toBeInTheDocument();
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

  it('shows the feature report table when features are loaded', () => {
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
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getByText('TBX-100')).toBeInTheDocument();
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
        priority: null,
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getByText('TBX-200')).toBeInTheDocument();
  });

  it('shows the risk board table when risks tab is active', () => {
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
        priority: null,
      },
    ];
    render(<ReportsHubView />);
    expect(screen.getByText('TBX-300')).toBeInTheDocument();
  });

  it('shows empty state when artTeams is empty', () => {
    mockState.artTeams = [];
    render(<ReportsHubView />);
    expect(screen.getByText(/no art teams configured/i)).toBeInTheDocument();
  });

  it('shows the flow tab WIP pipeline heading when flow tab is active', () => {
    mockState.activeTab = 'flow';
    render(<ReportsHubView />);
    expect(screen.getByText(/wip pipeline/i)).toBeInTheDocument();
  });

  it('shows the impact tab heading when impact tab is active', () => {
    mockState.activeTab = 'impact';
    render(<ReportsHubView />);
    expect(screen.getByText(/high priority/i)).toBeInTheDocument();
  });

  it('shows the individual tab heading when individual tab is active', () => {
    mockState.activeTab = 'individual';
    render(<ReportsHubView />);
    expect(screen.getByText(/workload by person/i)).toBeInTheDocument();
  });

  it('shows the quality tab heading when quality tab is active', () => {
    mockState.activeTab = 'quality';
    render(<ReportsHubView />);
    expect(screen.getByText(/defect metrics/i)).toBeInTheDocument();
  });

  it('shows the sprint health tab heading when sprintHealth tab is active', () => {
    mockState.activeTab = 'sprintHealth';
    render(<ReportsHubView />);
    expect(screen.getByText(/team health/i)).toBeInTheDocument();
  });

  it('shows the throughput tab heading when throughput tab is active', () => {
    mockState.activeTab = 'throughput';
    render(<ReportsHubView />);
    expect(screen.getByText(/throughput \(last/i)).toBeInTheDocument();
  });
});
