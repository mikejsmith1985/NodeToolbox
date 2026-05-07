// ReleaseMonitorView.test.tsx — Render and interaction tests for the standalone Release Monitor view.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseReleaseMonitorState } from './hooks/useReleaseMonitorState.ts';
import type { JiraVersion, ReleaseIssue } from './utils/releaseStats.ts';

vi.mock('./hooks/useReleaseMonitorState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useReleaseMonitorState.ts')>('./hooks/useReleaseMonitorState.ts');
  return {
    ...actualModule,
    useReleaseMonitorState: vi.fn(),
  };
});

import ReleaseMonitorView from './ReleaseMonitorView.tsx';
import { useReleaseMonitorState } from './hooks/useReleaseMonitorState.ts';

const mockUseReleaseMonitorState = vi.mocked(useReleaseMonitorState);

function buildIssue(overrides: Partial<ReleaseIssue> = {}): ReleaseIssue {
  return {
    key: 'TBX-101',
    summary: 'Finalize release candidate',
    statusName: 'In QA',
    statusCategoryKey: 'indeterminate',
    assigneeName: 'Alex Morgan',
    priorityName: 'Highest',
    duedate: '2026-02-09',
    isBlocker: true,
    isOverdue: true,
    ...overrides,
  };
}

function buildVersion(overrides: Partial<JiraVersion> = {}): JiraVersion {
  return {
    id: '10000',
    name: '0.6.1',
    released: false,
    archived: false,
    releaseDate: '2026-02-15',
    ...overrides,
  };
}

function buildHookState(overrides: Partial<UseReleaseMonitorState> = {}): UseReleaseMonitorState {
  const issues = overrides.issues ?? [];
  return {
    projectKey: '',
    setProjectKey: vi.fn(),
    fixVersion: '',
    setFixVersion: vi.fn(),
    isLoading: false,
    errorMessage: null,
    versions: [],
    selectedVersion: null,
    releaseStatus: 'unknown',
    issues,
    stats: { total: issues.length, done: 0, completionPct: 0, blockers: 0, overdue: 0 },
    loadVersions: vi.fn(),
    loadIssues: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseReleaseMonitorState.mockReset();
});

describe('ReleaseMonitorView', () => {
  it('renders empty guidance when project key and fixVersion are missing', () => {
    mockUseReleaseMonitorState.mockReturnValue(buildHookState());

    render(<ReleaseMonitorView />);

    expect(screen.getByRole('heading', { name: 'Release Monitor' })).toBeInTheDocument();
    expect(screen.getByText('Enter a Jira project key and fixVersion to monitor a release.')).toBeInTheDocument();
  });

  it('shows loading feedback and disables actions while Jira requests are active', () => {
    mockUseReleaseMonitorState.mockReturnValue(buildHookState({ isLoading: true, projectKey: 'TBX', fixVersion: '0.6.1' }));

    render(<ReleaseMonitorView />);

    expect(screen.getByText('Loading release monitor data…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Auto-fetch fixVersions for project' })).toBeDisabled();
  });

  it('renders release status chip and stats bar', () => {
    mockUseReleaseMonitorState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        fixVersion: '0.6.1',
        releaseStatus: 'overdue',
        stats: { total: 4, done: 2, completionPct: 50, blockers: 1, overdue: 1 },
      }),
    );

    render(<ReleaseMonitorView />);

    expect(screen.getByText('OVERDUE')).toBeInTheDocument();
    expect(screen.getByLabelText('Release stats')).toHaveTextContent('Total issues');
    expect(screen.getByLabelText('Release stats')).toHaveTextContent('2 (50%)');
    expect(screen.getByLabelText('Release stats')).toHaveTextContent('Blockers');
    expect(screen.getByLabelText('Release stats')).toHaveTextContent('Overdue');
  });

  it('renders all three status-category groups with count and percentage', () => {
    const issues = [
      buildIssue({ key: 'TBX-1', statusCategoryKey: 'new', summary: 'Start release work', isBlocker: false, isOverdue: false }),
      buildIssue({ key: 'TBX-2', statusCategoryKey: 'indeterminate', summary: 'Finish release work' }),
      buildIssue({ key: 'TBX-3', statusCategoryKey: 'done', summary: 'Close release work', isBlocker: false, isOverdue: false }),
    ];
    mockUseReleaseMonitorState.mockReturnValue(buildHookState({ projectKey: 'TBX', fixVersion: '0.6.1', issues }));

    render(<ReleaseMonitorView />);

    expect(screen.getByRole('region', { name: 'To Do' })).toHaveTextContent('1 · 33%');
    expect(screen.getByRole('region', { name: 'In Progress' })).toHaveTextContent('1 · 33%');
    expect(screen.getByRole('region', { name: 'Done' })).toHaveTextContent('1 · 33%');
  });

  it('renders issue details and risk badges in the matching group', () => {
    mockUseReleaseMonitorState.mockReturnValue(buildHookState({ projectKey: 'TBX', fixVersion: '0.6.1', issues: [buildIssue()] }));

    render(<ReleaseMonitorView />);

    const inProgressGroup = screen.getByRole('region', { name: 'In Progress' });
    expect(within(inProgressGroup).getByText('TBX-101')).toBeInTheDocument();
    expect(within(inProgressGroup).getByText('Finalize release candidate')).toBeInTheDocument();
    expect(within(inProgressGroup).getByText('Blocker')).toBeInTheDocument();
    expect(within(inProgressGroup).getByText('Overdue')).toBeInTheDocument();
  });

  it('wires input, version select, auto-fetch, and refresh actions to the hook', () => {
    const hookState = buildHookState({ versions: [buildVersion()], fixVersion: '0.6.1' });
    mockUseReleaseMonitorState.mockReturnValue(hookState);

    render(<ReleaseMonitorView />);
    fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'TBX' } });
    fireEvent.change(screen.getByLabelText('FixVersion'), { target: { value: '0.6.2' } });
    fireEvent.change(screen.getByLabelText('Available fixVersions'), { target: { value: '0.6.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auto-fetch fixVersions for project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(hookState.setProjectKey).toHaveBeenCalledWith('TBX');
    expect(hookState.setFixVersion).toHaveBeenCalledWith('0.6.2');
    expect(hookState.setFixVersion).toHaveBeenCalledWith('0.6.1');
    expect(hookState.loadVersions).toHaveBeenCalledTimes(1);
    expect(hookState.loadIssues).toHaveBeenCalledTimes(1);
  });

  it('shows a visible error state from the hook', () => {
    mockUseReleaseMonitorState.mockReturnValue(buildHookState({ errorMessage: 'Jira GET failed: 403' }));

    render(<ReleaseMonitorView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Jira GET failed: 403');
  });
});
