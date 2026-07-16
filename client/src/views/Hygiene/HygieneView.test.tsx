// HygieneView.test.tsx — Render and interaction tests for the standalone Hygiene view.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { resolveHygieneFieldConfig, type HygieneFinding, type HygieneSummary } from './checks/hygieneChecks.ts';

const mockUseHygieneState = vi.mocked(useHygieneState);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface OverrideHookState {
  projectKey?: string;
  extraJql?: string;
  findings?: HygieneFinding[];
  filteredFindings?: HygieneFinding[];
  summary?: HygieneSummary;
  selectedFilter?: ReturnType<typeof useHygieneState>['selectedFilter'];
  availableCheckIds?: string[];
  checkLabelsById?: Record<string, string>;
  isLoading?: boolean;
  loadError?: string | null;
  scannedIssueCount?: number | null;
  isAllProjectsScope?: boolean;
}

function buildDateDaysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * MILLISECONDS_PER_DAY).toISOString();
}

function buildSummary(overrides: Partial<HygieneSummary> = {}): HygieneSummary {
  return {
    totalIssues: 0,
    totalFlags: 0,
    countByCheck: {
      'missing-summary': 0,
      'missing-feature-link': 0,
      'missing-parent-link': 0,
      'missing-product-owner': 0,
      'missing-initiative-type': 0,
      'missing-pi': 0,
      'missing-target-start': 0,
      'missing-target-end': 0,
      'missing-application': 0,
      'missing-fix-version': 0,
      'missing-due-date': 0,
      'target-start-ready': 0,
      'target-end-overdue': 0,
      'due-date-overdue': 0,
      'missing-child-story-points': 0,
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
    availableCheckIds: overrides.availableCheckIds ?? Object.keys((overrides.summary ?? buildSummary()).countByCheck),
    checkLabelsById: overrides.checkLabelsById ?? {},
    fieldConfig: resolveHygieneFieldConfig(),
    isLoading: overrides.isLoading ?? false,
    loadError: overrides.loadError ?? null,
    // Default to "scanned some issues" so pre-existing tests keep exercising the healthy path; the
    // empty-scope tests override this to 0 explicitly.
    scannedIssueCount: overrides.scannedIssueCount !== undefined ? overrides.scannedIssueCount : 25,
    isAllProjectsScope: overrides.isAllProjectsScope ?? false,
    setProjectKey: vi.fn(),
    setExtraJql: vi.fn(),
    selectFilter: vi.fn(),
    setAllProjectsScope: vi.fn(),
    loadHygiene: vi.fn(),
  };
}

const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  mockUseHygieneState.mockReset();
  mockClipboardWriteText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockClipboardWriteText },
    writable: true,
    configurable: true,
  });
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

  // ── GH #167: an empty scope must never masquerade as a clean bill of health ──

  it('shows an amber warning instead of a perfect score when the scope matched no issues', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'TBX', scannedIssueCount: 0 }));

    render(<HygieneView />);

    // The distinct empty-scope warning renders…
    expect(screen.getByRole('status')).toHaveTextContent(/matched no Jira issues/i);
    // …the score shows a dash, never 100/100…
    expect(screen.getByLabelText('Hygiene score tile')).toHaveTextContent('—');
    expect(screen.getByLabelText('Hygiene score tile')).not.toHaveTextContent('100/100');
    // …and the "all clean" message is NOT shown, so the two states can never look alike.
    expect(screen.queryByText(/No Hygiene flags found/i)).not.toBeInTheDocument();
  });

  it('still shows the clean-state message (not the warning) when issues were scanned and none flagged', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'TBX', scannedIssueCount: 25 }));

    render(<HygieneView />);

    expect(screen.getByText(/No Hygiene flags found/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('surfaces the scanned-issue count on the summary tile', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'TBX', scannedIssueCount: 42 }));

    render(<HygieneView />);

    expect(screen.getByText(/0 flags · 42 scanned/)).toBeInTheDocument();
  });

  // ── GH #167: the "All my projects" scope backing the Today cards' drill-through ──

  it('offers the All my projects toggle in standalone mode and forwards changes to the hook', () => {
    const hookState = buildHookState();
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView />);
    fireEvent.click(screen.getByLabelText('All my projects'));

    expect(hookState.setAllProjectsScope).toHaveBeenCalledWith(true);
  });

  it('hides the All my projects toggle in team mode — team hygiene audits one project', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC' }));

    render(<HygieneView isTeamMode projectKey="ENCUC" />);

    expect(screen.queryByLabelText('All my projects')).not.toBeInTheDocument();
  });

  it('runs without a project key in the All my projects scope, with the key input disabled', () => {
    const hookState = buildHookState({ projectKey: '', isAllProjectsScope: true });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView initialAllProjects />);

    expect(screen.getByLabelText('Project key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run Hygiene' })).toBeEnabled();
    // The scope is runnable, so the view auto-runs exactly as a keyed scope would.
    expect(hookState.loadHygiene).toHaveBeenCalledTimes(1);
  });

  it('passes the deep-linked scope and filter through to the state hook', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ isAllProjectsScope: true }));

    render(<HygieneView initialAllProjects initialFilter="stale" />);

    expect(mockUseHygieneState).toHaveBeenCalledWith(
      expect.objectContaining({ initialAllProjects: true, initialSelectedFilter: 'stale' }),
    );
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
          countByCheck: {
            'missing-summary': 0,
            'missing-feature-link': 1,
            'missing-parent-link': 0,
            'missing-product-owner': 0,
            'missing-initiative-type': 0,
            'missing-pi': 0,
            'missing-target-start': 0,
            'missing-target-end': 0,
            'missing-application': 0,
            'missing-fix-version': 0,
            'missing-due-date': 0,
            'target-start-ready': 0,
            'target-end-overdue': 0,
            'due-date-overdue': 0,
            'missing-child-story-points': 0,
            'missing-sp': 2,
            stale: 1,
            'no-assignee': 1,
            'no-ac': 1,
            'old-in-sprint': 0,
          },
        }),
        checkLabelsById: {
          'missing-feature-link': 'Missing Feature Link',
          'old-in-sprint': 'Old in sprint',
        },
        availableCheckIds: ['missing-feature-link', 'old-in-sprint'],
      }),
    );

    render(<HygieneView />);

    expect(screen.getByText('3 issues')).toBeInTheDocument();
    // The tile now carries the scanned count, so "everything clean" and "scope matched nothing"
    // can never look alike (GH #167).
    expect(screen.getByText('5 flags · 25 scanned')).toBeInTheDocument();
    expect(screen.getByText('Missing Feature Link')).toBeInTheDocument();
    expect(screen.getByText('Old in sprint')).toBeInTheDocument();
  });

  it('renders populated finding rows with Jira links, flags, assignee, and age', () => {
    const finding = buildFinding();
    mockUseHygieneState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        findings: [finding],
        summary: buildSummary({
          totalIssues: 1,
          totalFlags: 2,
          countByCheck: {
            'missing-summary': 0,
            'missing-feature-link': 1,
            'missing-parent-link': 0,
            'missing-product-owner': 0,
            'missing-initiative-type': 0,
            'missing-pi': 0,
            'missing-target-start': 0,
            'missing-target-end': 0,
            'missing-application': 0,
            'missing-fix-version': 0,
            'missing-due-date': 0,
            'target-start-ready': 0,
            'target-end-overdue': 0,
            'due-date-overdue': 0,
            'missing-child-story-points': 0,
            'missing-sp': 1,
            stale: 0,
            'no-assignee': 1,
            'no-ac': 0,
            'old-in-sprint': 0,
          },
        }),
        checkLabelsById: {
          'missing-sp': 'Missing SP',
          'no-assignee': 'No assignee',
        },
        availableCheckIds: ['missing-sp', 'no-assignee'],
      }),
    );

    render(<HygieneView />);

    expect(screen.getByRole('link', { name: 'TBX-101' })).toHaveAttribute('href', 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/TBX-101');
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
    fireEvent.click(screen.getByRole('button', { name: /missing-sp/i }));
    fireEvent.click(screen.getByRole('button', { name: /issues/ }));

    expect(hookState.selectFilter).toHaveBeenCalledWith('missing-sp');
    expect(hookState.selectFilter).toHaveBeenCalledWith(null);
  });

  it('shows a copy button on tiles that have flagged issues', () => {
    mockUseHygieneState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        summary: buildSummary({ countByCheck: { ...buildSummary().countByCheck, 'missing-sp': 3 } }),
        checkLabelsById: { 'missing-sp': 'Missing SP' },
        availableCheckIds: ['missing-sp'],
      }),
    );

    render(<HygieneView />);

    expect(screen.getByRole('button', { name: /copy jira link for missing sp/i })).toBeInTheDocument();
  });

  it('does not show a copy button on tiles with a zero count', () => {
    mockUseHygieneState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        checkLabelsById: { 'no-assignee': 'No assignee' },
        availableCheckIds: ['no-assignee'],
      }),
    );

    render(<HygieneView />);

    expect(screen.queryByRole('button', { name: /copy jira link/i })).not.toBeInTheDocument();
  });

  it('writes raw JQL to the clipboard when the copy button is clicked and no Jira URL is configured', async () => {
    const finding = buildFinding();
    mockUseHygieneState.mockReturnValue(
      buildHookState({
        projectKey: 'TBX',
        findings: [finding],
        summary: buildSummary({ countByCheck: { ...buildSummary().countByCheck, 'missing-sp': 1 } }),
        checkLabelsById: { 'missing-sp': 'Missing SP' },
        availableCheckIds: ['missing-sp'],
      }),
    );

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /copy jira link for missing sp/i }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith('issueKey in (TBX-101)');
    });
  });

  it('does not propagate the copy button click to the tile filter action', () => {
    const finding = buildFinding();
    const hookState = buildHookState({
      projectKey: 'TBX',
      findings: [finding],
      summary: buildSummary({ countByCheck: { ...buildSummary().countByCheck, 'missing-sp': 1 } }),
      checkLabelsById: { 'missing-sp': 'Missing SP' },
      availableCheckIds: ['missing-sp'],
    });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /copy jira link for missing sp/i }));

    expect(hookState.selectFilter).not.toHaveBeenCalled();
  });
});
