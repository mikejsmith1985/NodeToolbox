// ReportsHubView.test.tsx — Unit tests for the Reports Hub tabbed view component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraFeatureIssue } from './hooks/useReportsHubState.ts';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'features' as 'features' | 'defects' | 'risks',
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
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setPiFilter: vi.fn(),
    setTeamFilter: vi.fn(),
    loadAllReports: vi.fn().mockResolvedValue(undefined),
    loadFeatures: vi.fn().mockResolvedValue(undefined),
    loadDefects: vi.fn().mockResolvedValue(undefined),
    loadRisks: vi.fn().mockResolvedValue(undefined),
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
    mockState.artTeams = [{ name: 'Team A', projectKey: 'TBX' }];
    vi.clearAllMocks();
  });

  it('renders the page title and hero KPI grid', () => {
    render(<ReportsHubView />);
    expect(screen.getByText(/reports hub/i)).toBeInTheDocument();
    expect(screen.getByText(/art teams/i)).toBeInTheDocument();
  });

  it('renders the 3 tab buttons', () => {
    render(<ReportsHubView />);
    expect(screen.getByRole('tab', { name: /feature report/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /defect tracker/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /risk board/i })).toBeInTheDocument();
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
});
