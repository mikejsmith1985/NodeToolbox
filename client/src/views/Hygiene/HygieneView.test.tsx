// HygieneView.test.tsx — Render and interaction tests for the standalone Hygiene view.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useHygieneState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useHygieneState.ts')>('./hooks/useHygieneState.ts');
  return {
    ...actualModule,
    useHygieneState: vi.fn(),
  };
});

import HygieneView from './HygieneView.tsx';
import { useHygieneState } from './hooks/useHygieneState.ts';
import type { HygieneFinding, HygieneSummary } from './checks/hygieneChecks.ts';

const mockUseHygieneState = vi.mocked(useHygieneState);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface OverrideHookState {
  projectKey?: string;
  extraJql?: string;
  findings?: HygieneFinding[];
  filteredFindings?: HygieneFinding[];
  summary?: HygieneSummary;
  selectedFilter?: ReturnType<typeof useHygieneState>['selectedFilter'];
  isLoading?: boolean;
  loadError?: string | null;
}

function buildDateDaysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * MILLISECONDS_PER_DAY).toISOString();
}

function buildSummary(overrides: Partial<HygieneSummary> = {}): HygieneSummary {
  return {
    totalIssues: 0,
    totalFlags: 0,
    countByCheck: {
      'missing-sp': 0,
      stale: 0,
      'no-assignee': 0,
      'no-ac': 0,
      'old-in-sprint': 0,
    },
    ...overrides,
  };
}

function buildFinding(): HygieneFinding {
  return {
    issue: {
      key: 'TBX-101',
      fields: {
        summary: 'Add acceptance criteria',
        assignee: { displayName: 'Alex' },
        created: buildDateDaysAgo(5),
      },
    },
    flags: [
      { checkId: 'missing-sp', label: 'Missing SP', severity: 'warn' },
      { checkId: 'no-assignee', label: 'No assignee', severity: 'error' },
    ],
  };
}

function buildHookState(overrides: OverrideHookState = {}): ReturnType<typeof useHygieneState> {
  const findings = overrides.findings ?? [];
  return {
    projectKey: overrides.projectKey ?? '',
    extraJql: overrides.extraJql ?? '',
    findings,
    filteredFindings: overrides.filteredFindings ?? findings,
    summary: overrides.summary ?? buildSummary(),
    selectedFilter: overrides.selectedFilter ?? null,
    isLoading: overrides.isLoading ?? false,
    loadError: overrides.loadError ?? null,
    setProjectKey: vi.fn(),
    setExtraJql: vi.fn(),
    selectFilter: vi.fn(),
    loadHygiene: vi.fn(),
  };
}

beforeEach(() => {
  mockUseHygieneState.mockReset();
});

describe('HygieneView', () => {
  it('renders the title, inputs, and empty-state guidance', () => {
    mockUseHygieneState.mockReturnValue(buildHookState());

    render(<HygieneView />);

    expect(screen.getByRole('heading', { name: 'Hygiene' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project key')).toBeInTheDocument();
    expect(screen.getByLabelText('Extra JQL')).toBeInTheDocument();
    expect(screen.getByText('Enter a project key and run Hygiene to find issue-health flags.')).toBeInTheDocument();
  });

  it('passes project, extra JQL, and run clicks to the state hook', () => {
    const hookState = buildHookState({ projectKey: 'TBX' });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView />);
    fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'ABC' } });
    fireEvent.change(screen.getByLabelText('Extra JQL'), { target: { value: 'AND labels = hygiene' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Hygiene' }));

    expect(hookState.setProjectKey).toHaveBeenCalledWith('ABC');
    expect(hookState.setExtraJql).toHaveBeenCalledWith('AND labels = hygiene');
    expect(hookState.loadHygiene).toHaveBeenCalledTimes(2);
  });

  it('auto-runs hygiene on first render when a project key is already configured', () => {
    const hookState = buildHookState({ projectKey: 'TBX' });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView />);

    expect(hookState.loadHygiene).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while Jira search is running', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'TBX', isLoading: true }));

    render(<HygieneView />);

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    expect(screen.getByText('Loading Hygiene results…')).toBeInTheDocument();
  });

  it('renders Jira load errors as alerts', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'TBX', loadError: 'Jira down' }));

    render(<HygieneView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Jira down');
  });

  it('renders summary tiles with total and per-check counts', () => {
    mockUseHygieneState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        summary: buildSummary({
          totalIssues: 3,
          totalFlags: 5,
          countByCheck: { 'missing-sp': 2, stale: 1, 'no-assignee': 1, 'no-ac': 1, 'old-in-sprint': 0 },
        }),
      }),
    );

    render(<HygieneView />);

    expect(screen.getByText('3 issues')).toBeInTheDocument();
    expect(screen.getByText('5 flags total')).toBeInTheDocument();
    expect(screen.getByText('Missing SP')).toBeInTheDocument();
    expect(screen.getByText('Old in sprint')).toBeInTheDocument();
  });

  it('renders populated finding rows with Jira links, flags, assignee, and age', () => {
    const finding = buildFinding();
    mockUseHygieneState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        findings: [finding],
        summary: buildSummary({ totalIssues: 1, totalFlags: 2, countByCheck: { 'missing-sp': 1, stale: 0, 'no-assignee': 1, 'no-ac': 0, 'old-in-sprint': 0 } }),
      }),
    );

    render(<HygieneView />);

    expect(screen.getByRole('link', { name: 'TBX-101' })).toHaveAttribute('href', '/browse/TBX-101');
    expect(screen.getByText('Add acceptance criteria')).toBeInTheDocument();
    expect(screen.getAllByText('Missing SP')).toHaveLength(2);
    expect(screen.getAllByText('No assignee')).toHaveLength(2);
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.getByText('5d')).toBeInTheDocument();
  });

  it('selects and clears a tile filter through the hook action', () => {
    const hookState = buildHookState({ projectKey: 'TBX', selectedFilter: 'missing-sp' });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /Missing SP/ }));
    fireEvent.click(screen.getByRole('button', { name: /issues/ }));

    expect(hookState.selectFilter).toHaveBeenCalledWith('missing-sp');
    expect(hookState.selectFilter).toHaveBeenCalledWith(null);
  });
});
