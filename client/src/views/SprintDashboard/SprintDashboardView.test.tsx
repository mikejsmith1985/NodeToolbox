// SprintDashboardView.test.tsx — Unit tests for the Sprint Dashboard tabbed view component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import type { JiraIssue, JiraSprint } from '../../types/jira.ts';
import type { DashboardTab } from './hooks/useSprintData.ts';

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
      boardType: null as 'scrum' | 'kanban' | null,
      availableBoards: [] as Array<{ id: number; name: string; type: 'scrum' | 'kanban'; projectKey: string }>,
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
      loadAvailableSprints: vi.fn().mockResolvedValue(undefined),
      moveIssueToSprint: vi.fn().mockResolvedValue(undefined),
    },
    mockConfig: {
      staleDaysThreshold: 5,
      storyPointScale: '1,2,3,5,8,13,21',
      sprintWindow: 3,
      cycleTimeStartField: '',
      cycleTimeDoneField: '',
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

vi.mock('../StoryPointing/StoryPointingView.tsx', () => ({
  default: () => <div>Mock Story Pointing</div>,
}));

import SprintDashboardView from './SprintDashboardView.tsx';

describe('SprintDashboardView', () => {
  beforeEach(() => {
    mockState.activeTab = 'overview';
    mockState.sprintInfo = {
      id: 7,
      name: 'Sprint 7',
      state: 'active',
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-01-14T00:00:00.000Z',
    };
    mockState.loadError = null;
    mockState.isLoadingSprint = false;
    mockState.availableBoards = [];
    mockState.boardId = null;
    mockState.availableSprints = null;
    vi.clearAllMocks();
  });

  it('renders the core tab buttons', () => {
    render(<SprintDashboardView />);

    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'By Assignee' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Blockers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Defects' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Standup' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the Settings tab with project key input', () => {
    mockState.activeTab = 'settings';
    render(<SprintDashboardView />);

    expect(screen.getByLabelText(/project key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load sprint/i })).toBeInTheDocument();
  });

  it('renders Overview tab with sprint info when sprint is loaded', () => {
    mockState.activeTab = 'overview';
    render(<SprintDashboardView />);

    expect(screen.getByText('Sprint 7')).toBeInTheDocument();
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

  it('renders the Standup timer display', () => {
    mockState.activeTab = 'standup';
    render(<SprintDashboardView />);

    // Timer should display 15:00 (900 seconds)
    expect(screen.getByText('15:00')).toBeInTheDocument();
  });

  it('renders the burn-down chart when on Overview tab', () => {
    mockState.activeTab = 'overview';
    render(<SprintDashboardView />);

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders the extended tab buttons including Pointing', () => {
    render(<SprintDashboardView />);

    expect(screen.getByRole('tab', { name: 'Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Planning' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pointing' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Releases' })).toBeInTheDocument();
  });

  it('renders the Metrics tab with sprint completion statistics', () => {
    mockState.activeTab = 'metrics';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Sprint Metrics' })).toBeInTheDocument();
    expect(screen.getByText(/Completion/i)).toBeInTheDocument();
  });

  it('renders the Pipeline tab with per-status kanban columns', () => {
    mockState.activeTab = 'pipeline';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Kanban Pipeline' })).toBeInTheDocument();
    // Mock issues have "In Progress" and "Blocked" statuses — both appear as column headings.
    expect(screen.getByRole('heading', { name: 'In Progress' })).toBeInTheDocument();
  });

  it('renders the Planning tab with unestimated issues section', () => {
    mockState.activeTab = 'planning';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Sprint Planning' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unestimated Issues' })).toBeInTheDocument();
  });

  it('renders the Pointing tab with the embedded story-pointing view', () => {
    mockState.activeTab = 'pointing';
    render(<SprintDashboardView />);

    expect(screen.getByText('Mock Story Pointing')).toBeInTheDocument();
  });

  it('renders the Releases tab grouped by fix version', () => {
    mockState.activeTab = 'releases';
    render(<SprintDashboardView />);

    expect(screen.getByRole('heading', { name: 'Release Readiness' })).toBeInTheDocument();
    // All mock issues have no fixVersions, so they fall under "No Version".
    expect(screen.getByText('No Version')).toBeInTheDocument();
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

  it('shows the advanced config fields in Settings tab', () => {
    mockState.activeTab = 'settings';
    render(<SprintDashboardView />);

    expect(screen.getByLabelText(/stale threshold/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/story point scale/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sprint window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/kanban period/i)).toBeInTheDocument();
  });

  it('renders Move to Sprint buttons in the Assignee tab', () => {
    mockState.activeTab = 'assignee';
    render(<SprintDashboardView />);

    // Each issue card should have a "Move to sprint" button.
    const moveButtons = screen.getAllByRole('button', { name: /move to sprint/i });
    expect(moveButtons.length).toBeGreaterThan(0);
  });

  it('uses the configured stale days threshold in the Blockers tab heading', () => {
    mockState.activeTab = 'blockers';
    mockConfig.staleDaysThreshold = 7;
    render(<SprintDashboardView />);

    expect(screen.getByText(/stale.*7\+ days/i)).toBeInTheDocument();
    mockConfig.staleDaysThreshold = 5; // reset
  });
});