// StandupTab.test.tsx — Rendering tests for the Team Dashboard standup board-walk and live DSU-style person-walk modes.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';

const { mockUseSprintStandupState, mockIssueDetailPanel, mockDsuBoardView, mockSendToAutomation } = vi.hoisted(() => ({
  mockUseSprintStandupState: vi.fn(),
  mockIssueDetailPanel: vi.fn(() => <div>Mock Issue Detail Panel</div>),
  mockDsuBoardView: vi.fn(() => <div>Mock DSU Board</div>),
  mockSendToAutomation: vi.fn(() => <div data-testid="send-to-automation">Mock Send</div>),
}));

vi.mock('../../components/SendToAutomationButton.tsx', () => ({ default: mockSendToAutomation }));

vi.mock('./hooks/useSprintStandupState.ts', () => ({
  calculateIssueAgeDays: () => 3,
  classifyIssueAge: () => 'warn',
  formatPersonWalkText: (draft: { yesterday: string; today: string; blockers: string }) =>
    `*Yesterday*\n${draft.yesterday}\n\n*Today*\n${draft.today}\n\n*Blockers*\n${draft.blockers || 'None'}`,
  hasBlockingLink: (issue: JiraIssue) => issue.key === 'TBX-2',
  useSprintStandupState: mockUseSprintStandupState,
}));

vi.mock('../../components/IssueDetailPanel/index.tsx', () => ({
  default: mockIssueDetailPanel,
}));

vi.mock('../DsuBoard/DsuBoardView.tsx', () => ({
  default: mockDsuBoardView,
}));

import StandupTab from './StandupTab.tsx';

function readYesterdayIsoTimestamp(): string {
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  yesterdayDate.setHours(12, 0, 0, 0);
  return yesterdayDate.toISOString();
}

function buildIssue(
  issueKey: string,
  summary: string,
  statusName = 'In Progress',
  statusCategoryKey = 'indeterminate',
  assigneeName = 'Alex Example',
): JiraIssue {
  const issueFields = {
    summary,
    status: { name: statusName, statusCategory: { key: statusCategoryKey } },
    priority: { name: 'Medium', iconUrl: 'priority.png' },
    assignee: {
      accountId: 'user-1',
      displayName: assigneeName,
      emailAddress: 'alex@example.com',
      avatarUrls: {},
    },
    reporter: null,
    issuelinks: issueKey === 'TBX-2' ? [{ type: { name: 'Blocks' }, inwardIssue: { key: 'TBX-1' } }] : [],
    issuetype: { name: 'Story', iconUrl: 'story.png' },
    created: '2026-05-01T00:00:00.000Z',
    updated: readYesterdayIsoTimestamp(),
    description: null,
    customfield_10016: 5,
    fixVersions: [],
  } as JiraIssue['fields'] & { issuelinks?: Array<{ type?: { name?: string }; inwardIssue?: { key: string } }> };

  return {
    id: issueKey,
    key: issueKey,
    fields: issueFields,
  };
}

describe('StandupTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSprintStandupState.mockReturnValue({
      state: {
        standupMode: 'boardwalk',
        scopeMode: 'sprint',
        shouldShowDoneColumn: false,
        scopeIssues: [],
        isLoadingScopeIssues: false,
        scopeLoadErrorMessage: null,
        plannedIssueKeysByPerson: {},
        previousPlannedIssueKeysByPerson: {},
        boardwalkStatusFilters: {
          new: { 'To Do': true },
          indeterminate: { 'In Progress': true, Blocked: true },
          done: { Done: true },
        },
        personWalkDraft: {
          yesterday: '• TBX-1 - Investigated incident',
          today: '• TBX-2 - Finish fix',
          blockers: '',
        },
        personWalkPostKey: '',
        personWalkPostStatus: 'idle',
        personWalkPostErrorMessage: null,
        personWalkCopyStatusMessage: null,
        isLoadingPersonWalk: false,
        personWalkErrorMessage: null,
      },
      actions: {
        setStandupMode: vi.fn(),
        setScopeMode: vi.fn(),
        setShouldShowDoneColumn: vi.fn(),
        togglePlannedIssue: vi.fn(),
        toggleBoardwalkStatusFilter: vi.fn(),
        refreshPersonWalk: vi.fn().mockResolvedValue(undefined),
        setPersonWalkDraftField: vi.fn(),
        setPersonWalkPostKey: vi.fn(),
        copyPersonWalk: vi.fn().mockResolvedValue(undefined),
        postPersonWalkComment: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders the legacy board-walk controls and blocker panel', () => {
    render(
      <StandupTab
        isTimerRunning={false}
        issues={[
          buildIssue('TBX-1', 'Review the API response'),
          buildIssue('TBX-2', 'Investigate blocker', 'Blocked'),
        ]}
        onRefreshIssues={vi.fn()}
        onReset={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTick={vi.fn()}
        dashboardScopeMode="sprint"
        projectKey="TBX"
        timerSecondsRemaining={900}
      />,
    );

    expect(screen.getByText('Show Done column')).toBeInTheDocument();
    expect(screen.getByText('WIP')).toBeInTheDocument();
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('🔴 Blockers (1)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /TBX-1/i }));

    expect(screen.getByText('Mock Issue Detail Panel')).toBeInTheDocument();
  });

  it('calls standup mode action when switching to person-walk mode', () => {
    const hookResult = {
      state: {
        standupMode: 'boardwalk',
        scopeMode: 'sprint',
        shouldShowDoneColumn: false,
        scopeIssues: [],
        isLoadingScopeIssues: false,
        scopeLoadErrorMessage: null,
        plannedIssueKeysByPerson: {},
        previousPlannedIssueKeysByPerson: {},
        boardwalkStatusFilters: {
          new: { 'To Do': true },
          indeterminate: { 'In Progress': true },
          done: { Done: true },
        },
        personWalkDraft: { yesterday: '', today: '', blockers: '' },
        personWalkPostKey: '',
        personWalkPostStatus: 'idle',
        personWalkPostErrorMessage: null,
        personWalkCopyStatusMessage: null,
        isLoadingPersonWalk: false,
        personWalkErrorMessage: null,
      },
      actions: {
        setStandupMode: vi.fn(),
        setScopeMode: vi.fn(),
        setShouldShowDoneColumn: vi.fn(),
        togglePlannedIssue: vi.fn(),
        toggleBoardwalkStatusFilter: vi.fn(),
        refreshPersonWalk: vi.fn().mockResolvedValue(undefined),
        setPersonWalkDraftField: vi.fn(),
        setPersonWalkPostKey: vi.fn(),
        copyPersonWalk: vi.fn().mockResolvedValue(undefined),
        postPersonWalkComment: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockUseSprintStandupState.mockReturnValueOnce(hookResult);

    render(
      <StandupTab
        isTimerRunning={false}
        issues={[buildIssue('TBX-1', 'Review the API response')]}
        onRefreshIssues={vi.fn()}
        onReset={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTick={vi.fn()}
        dashboardScopeMode="sprint"
        projectKey="TBX"
        timerSecondsRemaining={900}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Person Walk' }));

    expect(hookResult.actions.setStandupMode).toHaveBeenCalledWith('personwalk');
  });

  it('calls scope action when switching to roster mode', () => {
    const hookResult = {
      state: {
        standupMode: 'personwalk',
        scopeMode: 'sprint',
        shouldShowDoneColumn: false,
        scopeIssues: [],
        isLoadingScopeIssues: false,
        scopeLoadErrorMessage: null,
        plannedIssueKeysByPerson: {},
        previousPlannedIssueKeysByPerson: {},
        boardwalkStatusFilters: { new: {}, indeterminate: {}, done: {} },
        personWalkDraft: { yesterday: '', today: '', blockers: '' },
        personWalkPostKey: '',
        personWalkPostStatus: 'idle',
        personWalkPostErrorMessage: null,
        personWalkCopyStatusMessage: null,
        isLoadingPersonWalk: false,
        personWalkErrorMessage: null,
      },
      actions: {
        setStandupMode: vi.fn(),
        setScopeMode: vi.fn(),
        setShouldShowDoneColumn: vi.fn(),
        togglePlannedIssue: vi.fn(),
        toggleBoardwalkStatusFilter: vi.fn(),
        refreshPersonWalk: vi.fn().mockResolvedValue(undefined),
        setPersonWalkDraftField: vi.fn(),
        setPersonWalkPostKey: vi.fn(),
        copyPersonWalk: vi.fn().mockResolvedValue(undefined),
        postPersonWalkComment: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockUseSprintStandupState.mockReturnValueOnce(hookResult);

    render(
      <StandupTab
        isTimerRunning={false}
        issues={[buildIssue('TBX-1', 'Review the API response')]}
        onRefreshIssues={vi.fn()}
        onReset={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTick={vi.fn()}
        dashboardScopeMode="sprint"
        projectKey="TBX"
        timerSecondsRemaining={900}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Roster' }));

    expect(hookResult.actions.setScopeMode).toHaveBeenCalledWith('roster');
  });

  it('renders the live DSU-style person-walk editor and actions', () => {
    const hookResult = {
      state: {
        standupMode: 'personwalk',
        scopeMode: 'sprint',
        shouldShowDoneColumn: false,
        scopeIssues: [
          buildIssue('TBX-1', 'Review the API response', 'In Progress', 'indeterminate', 'Alex Example'),
          buildIssue('TBX-2', 'Ship the bug fix', 'To Do', 'new', 'Taylor Teammate'),
        ],
        isLoadingScopeIssues: false,
        scopeLoadErrorMessage: null,
        plannedIssueKeysByPerson: {
          'Alex Example': ['TBX-1'],
        },
        previousPlannedIssueKeysByPerson: {
          'Alex Example': ['TBX-1'],
          'Taylor Teammate': ['TBX-8'],
        },
        boardwalkStatusFilters: { new: {}, indeterminate: {}, done: {} },
        personWalkDraft: {
          yesterday: '• TBX-1 - Investigated incident',
          today: '• TBX-2 - Finish fix',
          blockers: '',
        },
        personWalkPostKey: 'TBX-7',
        personWalkPostStatus: 'idle',
        personWalkPostErrorMessage: null,
        personWalkCopyStatusMessage: null,
        isLoadingPersonWalk: false,
        personWalkErrorMessage: null,
      },
      actions: {
        setStandupMode: vi.fn(),
        setScopeMode: vi.fn(),
        setShouldShowDoneColumn: vi.fn(),
        togglePlannedIssue: vi.fn(),
        toggleBoardwalkStatusFilter: vi.fn(),
        refreshPersonWalk: vi.fn().mockResolvedValue(undefined),
        setPersonWalkDraftField: vi.fn(),
        setPersonWalkPostKey: vi.fn(),
        copyPersonWalk: vi.fn().mockResolvedValue(undefined),
        postPersonWalkComment: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockUseSprintStandupState.mockReturnValueOnce(hookResult);

    render(
      <StandupTab
        isTimerRunning={false}
        issues={[
          buildIssue('TBX-1', 'Review the API response', 'In Progress', 'indeterminate', 'Alex Example'),
          buildIssue('TBX-2', 'Ship the bug fix', 'To Do', 'new', 'Taylor Teammate'),
        ]}
        onRefreshIssues={vi.fn()}
        onReset={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTick={vi.fn()}
        dashboardScopeMode="sprint"
        projectKey="TBX"
        timerSecondsRemaining={900}
      />,
    );

    expect(screen.getByText("Yesterday's Follow-Through")).toBeInTheDocument();
    expect(screen.getAllByText('Alex Example').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Taylor Teammate').length).toBeGreaterThan(0);
    expect(screen.getByText('Plan held')).toBeInTheDocument();
    expect(screen.getByText('Plan shifted')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Plan TBX-1 for Alex Example' })[0]);
    expect(screen.getByText('Standup Preview')).toBeInTheDocument();
    expect(screen.getByDisplayValue('• TBX-1 - Investigated incident')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    fireEvent.click(screen.getByRole('button', { name: '📋 Copy Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post to Jira' }));

    expect(hookResult.actions.togglePlannedIssue).toHaveBeenCalledWith('Alex Example', 'TBX-1');
    expect(hookResult.actions.refreshPersonWalk).toHaveBeenCalled();
    expect(hookResult.actions.copyPersonWalk).toHaveBeenCalled();
    expect(hookResult.actions.postPersonWalkComment).toHaveBeenCalled();
  });

  it('renders the embedded DSU board mode with the current project key', () => {
    mockUseSprintStandupState.mockReturnValueOnce({
      state: {
        standupMode: 'dsu-board',
        scopeMode: 'sprint',
        shouldShowDoneColumn: false,
        scopeIssues: [],
        isLoadingScopeIssues: false,
        scopeLoadErrorMessage: null,
        plannedIssueKeysByPerson: {},
        previousPlannedIssueKeysByPerson: {},
        boardwalkStatusFilters: { new: {}, indeterminate: {}, done: {} },
        personWalkDraft: { yesterday: '', today: '', blockers: '' },
        personWalkPostKey: '',
        personWalkPostStatus: 'idle',
        personWalkPostErrorMessage: null,
        personWalkCopyStatusMessage: null,
        isLoadingPersonWalk: false,
        personWalkErrorMessage: null,
      },
      actions: {
        setStandupMode: vi.fn(),
        setScopeMode: vi.fn(),
        setShouldShowDoneColumn: vi.fn(),
        togglePlannedIssue: vi.fn(),
        toggleBoardwalkStatusFilter: vi.fn(),
        refreshPersonWalk: vi.fn().mockResolvedValue(undefined),
        setPersonWalkDraftField: vi.fn(),
        setPersonWalkPostKey: vi.fn(),
        copyPersonWalk: vi.fn().mockResolvedValue(undefined),
        postPersonWalkComment: vi.fn().mockResolvedValue(undefined),
      },
    });

    render(
      <StandupTab
        isTimerRunning={false}
        issues={[]}
        onRefreshIssues={vi.fn()}
        onReset={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTick={vi.fn()}
        dashboardScopeMode="sprint"
        projectKey="ENFCT"
        timerSecondsRemaining={900}
      />,
    );

    expect(screen.getByText('Mock DSU Board')).toBeInTheDocument();
    expect(mockDsuBoardView).toHaveBeenCalledWith({ projectKey: 'ENFCT' }, undefined);
  });

  it('shows both Copy Briefing and Send to Automation once a briefing is generated', async () => {
    // Briefing mode with the same valid state shape, only the mode switched.
    mockUseSprintStandupState.mockReturnValue({
      state: {
        standupMode: 'briefing',
        scopeMode: 'sprint',
        shouldShowDoneColumn: false,
        scopeIssues: [],
        isLoadingScopeIssues: false,
        scopeLoadErrorMessage: null,
        plannedIssueKeysByPerson: {},
        previousPlannedIssueKeysByPerson: {},
        boardwalkStatusFilters: { new: {}, indeterminate: {}, done: {} },
        personWalkDraft: { yesterday: '', today: '', blockers: '' },
        personWalkPostKey: '',
        personWalkPostStatus: 'idle',
        personWalkPostErrorMessage: null,
        personWalkCopyStatusMessage: null,
        isLoadingPersonWalk: false,
        personWalkErrorMessage: null,
      },
      actions: {
        setStandupMode: vi.fn(),
        setScopeMode: vi.fn(),
        setShouldShowDoneColumn: vi.fn(),
        togglePlannedIssue: vi.fn(),
        toggleBoardwalkStatusFilter: vi.fn(),
        refreshPersonWalk: vi.fn().mockResolvedValue(undefined),
        setPersonWalkDraftField: vi.fn(),
        setPersonWalkPostKey: vi.fn(),
        copyPersonWalk: vi.fn().mockResolvedValue(undefined),
        postPersonWalkComment: vi.fn().mockResolvedValue(undefined),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, briefingText: '## Briefing\n- item', counts: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StandupTab
        isTimerRunning={false}
        issues={[]}
        onRefreshIssues={vi.fn()}
        onReset={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onTick={vi.fn()}
        dashboardScopeMode="sprint"
        projectKey="TBX"
        timerSecondsRemaining={900}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Run Briefing/i }));

    // Copy Briefing still works (additive change) and the Send action is wired in.
    expect(await screen.findByText('Copy Briefing')).toBeInTheDocument();
    expect(screen.getByTestId('send-to-automation')).toBeInTheDocument();
    expect(mockSendToAutomation).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
