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

// Expanding a finding mounts the issue detail panel, which loads transitions and comments.
vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn((path: string) =>
    path.endsWith('/comment') ? Promise.resolve({ comments: [] }) : Promise.resolve({ transitions: [] })),
  jiraPost: vi.fn().mockResolvedValue({}),
  jiraPut: vi.fn().mockResolvedValue(undefined),
}));

import HygieneView from './HygieneView.tsx';
import { useHygieneState } from './hooks/useHygieneState.ts';
import { resolveHygieneFieldConfig, type HygieneFinding, type HygieneSummary } from './checks/hygieneChecks.ts';

const mockUseHygieneState = vi.mocked(useHygieneState);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface OverrideHookState {
  projectKey?: string;
  extraJql?: string;
  scopeJql?: string;
  findings?: HygieneFinding[];
  filteredFindings?: HygieneFinding[];
  summary?: HygieneSummary;
  selectedFilter?: ReturnType<typeof useHygieneState>['selectedFilter'];
  availableCheckIds?: string[];
  checkLabelsById?: Record<string, string>;
  isLoading?: boolean;
  loadError?: string | null;
  scannedIssueCount?: number | null;
  totalMatchingCount?: number | null;
  isTruncated?: boolean;
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
    scopeJql: overrides.scopeJql ?? 'statusCategory != Done',
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
    totalMatchingCount: overrides.totalMatchingCount ?? null,
    isTruncated: overrides.isTruncated ?? false,
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

  it('does NOT auto-run in team mode: the team dropdown seeds the scope, the button runs it', () => {
    // The team dropdown is the primary driver — it seeds the Project Key / Extra JQL — but the scan is
    // manual, so opening the team Hygiene card scans nothing until the user clicks Run Hygiene.
    const hookState = buildHookState({ projectKey: 'ENCUC' });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView isTeamMode projectKey="ENCUC" />);
    expect(hookState.loadHygiene).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Run Hygiene' }));
    expect(hookState.loadHygiene).toHaveBeenCalledTimes(1);
  });

  it('still auto-runs a team-mode Today-card drill-through (arrives with a deep-linked filter)', () => {
    // A deep-linked filter means the user clicked a specific count on a Today card and expects those
    // exact issues immediately — that arrival keeps auto-running even though plain team mode does not.
    const hookState = buildHookState({ projectKey: 'ENCUC' });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView isTeamMode projectKey="ENCUC" initialFilter="stale" />);

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

  it('never renders a perfect score or the clean-state message when the run failed (GH #167)', () => {
    // A failed search has no scan data; showing 100/100 and "no flags found" beside the error was
    // half of the confusion — the tiles said healthy while the run had not happened at all.
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'TBX',
      loadError: "Field 'cf[10014]' does not exist or you do not have permission to view it.",
      scannedIssueCount: null,
    }));

    render(<HygieneView />);

    expect(screen.getByRole('alert')).toHaveTextContent(/cf\[10014\]/);
    expect(screen.getByLabelText('Hygiene score tile')).toHaveTextContent('—');
    expect(screen.getByLabelText('Hygiene score tile')).not.toHaveTextContent('100/100');
    expect(screen.queryByText(/No Hygiene flags found/i)).not.toBeInTheDocument();
  });

  it('marks a check whose Jira field does not exist as "not checked" instead of a clean 0 (GH #167)', () => {
    // Product Owner / Initiative Type / Application have no default field and silently skip when
    // the instance has none — a bare 0 from a check that never ran reads exactly like clean.
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'TBX',
      summary: buildSummary(),
      availableCheckIds: ['missing-product-owner'],
      checkLabelsById: { 'missing-product-owner': 'Missing Product Owner' },
    }));

    render(<HygieneView />);

    // resolveHygieneFieldConfig() (the test default) has no Product Owner field configured.
    const tile = screen.getByLabelText('Missing Product Owner not configured');
    expect(tile).toHaveTextContent('—');
    expect(tile).toHaveTextContent(/not checked — no matching Jira field/i);
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

  it('gives each tile an "open in Jira" link carrying the family JQL clause (GH #200 US2)', () => {
    const hookState = buildHookState({
      projectKey: 'TBX',
      scopeJql: 'project=TBX AND statusCategory != Done',
    });
    mockUseHygieneState.mockReturnValue(hookState);

    render(<HygieneView />);

    // The no-assignee tile links to a Jira search whose JQL includes the family condition (assignee EMPTY),
    // not merely a list of already-found keys — so the user can validate the count against Jira.
    const openLink = screen.getByRole('link', { name: /Open no-assignee in Jira/i });
    expect(openLink.getAttribute('href')).toContain('assignee');
    expect(openLink).toHaveAttribute('target', '_blank');
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

  // ── Spec 019 US1: finding rows read at a glance through the semantic chip vocabulary ──

  it('renders finding meta as semantic chips: type icon, status tone, avatar + full name, graded age', () => {
    const staleFinding: HygieneFinding = {
      issue: {
        key: 'ENCUC-2163',
        fields: {
          summary: 'TCO Effective Date for Test Case 16',
          status: { name: 'Ready to Accept', statusCategory: { key: 'indeterminate' } },
          issuetype: { name: 'Defect' },
          assignee: { displayName: 'Katkar, Rahul (CTR)' },
          created: buildDateDaysAgo(20),
          updated: buildDateDaysAgo(16),
        },
      },
      flags: [{ checkId: 'stale', label: 'Stale', severity: 'warn' }],
      programIncrement: 'PI 26.3',
    } as unknown as HygieneFinding;
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: [staleFinding] }));

    render(<HygieneView />);

    expect(screen.getByText('Ready to Accept')).toHaveAttribute('data-tone', 'progress');
    expect(screen.getByText('🐞').parentElement?.textContent).toContain('Defect');
    expect(screen.getByText('KR')).toBeInTheDocument();
    expect(screen.getByText('Katkar, Rahul (CTR)')).toBeInTheDocument();
    // 16 idle days against the default 5-day threshold grades as overdue (danger).
    expect(screen.getByText('16d')).toHaveAttribute('data-tone', 'danger');
  });

  // ── Spec 019 US2: expanding a finding shows its full decision context in the panel ──

  it('passes resolved AC, PI, sprint, and feature context to the expanded detail panel', async () => {
    const contextFinding: HygieneFinding = {
      issue: {
        key: 'ENCUC-2163',
        fields: {
          summary: 'TCO Effective Date for Test Case 16',
          status: { name: 'Ready to Accept', statusCategory: { key: 'indeterminate' } },
          issuetype: { name: 'Defect' },
          assignee: { displayName: 'Jordan, John' },
          created: buildDateDaysAgo(20),
          updated: buildDateDaysAgo(16),
          customfield_10200: 'Text case 16: Resolve issue for issue found',
          customfield_10020: ['com.atlassian.greenhopper[id=42,state=ACTIVE,name=ENCUC Sprint 26.3.4,goal=]'],
          parent: { key: 'ENCUC-1500' },
        },
      },
      flags: [{ checkId: 'stale', label: 'Stale', severity: 'warn' }],
      programIncrement: 'PI 26.3 (05/21/26 - 07/29/26)',
    } as unknown as HygieneFinding;
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: [contextFinding] }));

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /TCO Effective Date/i }));

    await waitFor(() => {
      expect(screen.getByText(/Text case 16: Resolve issue for issue found/)).toBeInTheDocument();
    });
    // The PI shows in the row meta AND the expanded panel's planning row.
    expect(screen.getAllByText('PI 26.3 (05/21/26 - 07/29/26)').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('ENCUC Sprint 26.3.4')).toBeInTheDocument();
    expect(screen.getByText('ENCUC-1500')).toBeInTheDocument();
  });

  // ── Spec 019 US3: guided cleanup session with explicit Skip and an honest summary ──

  function buildSessionFindings(): HygieneFinding[] {
    return ['ENCUC-1', 'ENCUC-2', 'ENCUC-3'].map((issueKey) => ({
      issue: {
        key: issueKey,
        fields: {
          summary: `Finding ${issueKey}`,
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          issuetype: { name: 'Story' },
          assignee: { displayName: 'Alex' },
          created: buildDateDaysAgo(20),
          updated: buildDateDaysAgo(16),
        },
      },
      flags: [{ checkId: 'stale', label: 'Stale', severity: 'warn' }],
      programIncrement: null,
    })) as unknown as HygieneFinding[];
  }

  it('starts a review session with a visible cursor and auto-expands the current finding', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSessionFindings() }));

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /review these findings/i }));

    expect(screen.getByText(/Reviewing 1 of 3/)).toBeInTheDocument();
  });

  it('Skip settles the current finding visibly and advances the cursor', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSessionFindings() }));

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /review these findings/i }));
    fireEvent.click(screen.getByRole('button', { name: /^skip/i }));

    expect(screen.getByText(/Reviewing 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText('⤼ skipped')).toBeInTheDocument();
  });

  it('ending the session reports the honest four-bucket summary — untouched is never "handled"', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSessionFindings() }));

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /review these findings/i }));
    fireEvent.click(screen.getByRole('button', { name: /^skip/i }));
    fireEvent.click(screen.getByRole('button', { name: /end session/i }));

    expect(screen.getByText(/3 findings — 0 fixed, 0 commented, 1 skipped, 2 untouched/)).toBeInTheDocument();
  });

  // ── Findings sorting: status / assignee / issue type / age, optional and off by default ──

  function buildSortableFindings(): HygieneFinding[] {
    return [
      {
        issue: {
          key: 'ENCUC-10',
          fields: {
            summary: 'Finding ENCUC-10',
            status: { name: 'Ready to Accept', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Story' },
            assignee: { displayName: 'Katkar, Rahul (CTR)' },
            created: buildDateDaysAgo(30),
            updated: buildDateDaysAgo(2),
          },
        },
        flags: [{ checkId: 'stale', label: 'Stale', severity: 'warn' }],
        programIncrement: null,
      },
      {
        issue: {
          key: 'ENCUC-11',
          fields: {
            summary: 'Finding ENCUC-11',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            issuetype: { name: 'Defect' },
            assignee: { displayName: 'Adams, Jo' },
            created: buildDateDaysAgo(30),
            updated: buildDateDaysAgo(20),
          },
        },
        flags: [{ checkId: 'stale', label: 'Stale', severity: 'warn' }],
        programIncrement: null,
      },
    ] as unknown as HygieneFinding[];
  }

  /** Reads the issue keys of the rendered finding rows in DOM order. */
  function readRenderedFindingKeys(): string[] {
    return screen.getAllByRole('link', { name: /ENCUC-\d+/ }).map((link) => link.textContent ?? '');
  }

  it('renders findings in scan order by default and reorders them when a sort is chosen', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSortableFindings() }));

    render(<HygieneView />);

    expect(readRenderedFindingKeys()).toEqual(['ENCUC-10', 'ENCUC-11']);

    // Status sort: "In Progress" (ENCUC-11) alphabetically precedes "Ready to Accept".
    fireEvent.change(screen.getByLabelText('Sort findings'), { target: { value: 'status' } });
    expect(readRenderedFindingKeys()).toEqual(['ENCUC-11', 'ENCUC-10']);

    // Age sort: ENCUC-11 has been idle longer (20 days vs 2), so it leads.
    fireEvent.change(screen.getByLabelText('Sort findings'), { target: { value: 'age' } });
    expect(readRenderedFindingKeys()).toEqual(['ENCUC-11', 'ENCUC-10']);
  });

  it('walks a review session in the SORTED order when a sort is active', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSortableFindings() }));

    render(<HygieneView />);
    fireEvent.change(screen.getByLabelText('Sort findings'), { target: { value: 'assignee' } });
    fireEvent.click(screen.getByRole('button', { name: /review these findings/i }));

    // "Adams, Jo" (ENCUC-11) sorts first, so the session cursor starts there.
    expect(screen.getByText(/Reviewing 1 of 2/)).toBeInTheDocument();
    const currentRow = screen.getByRole('link', { name: 'ENCUC-11' }).closest('[aria-expanded]');
    expect(currentRow).toHaveAttribute('aria-expanded', 'true');
  });

  it('locks the sort control while a session is active so the reviewed order cannot shift underneath it', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSortableFindings() }));

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /review these findings/i }));

    expect(screen.getByLabelText('Sort findings')).toBeDisabled();
  });

  // ── Spec 019 FR-015: fix affordances say what is flagged and what fixing does ──

  it('renders a plain-language explanation for each flagged check', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENCUC', findings: buildSessionFindings().slice(0, 1) }));

    render(<HygieneView />);

    expect(screen.getByText(/No update in 16 days/)).toBeInTheDocument();
  });
});

describe('HygieneView — a capped scan says so', () => {
  it('names how much of the scope it actually read, so the counts are not read as totals', () => {
    // The failure this covers is silent: the scan returned the first N issues and every tile
    // described them as the answer, with nothing distinguishing a complete scan from a partial one.
    mockUseHygieneState.mockReturnValue(buildHookState({
      scannedIssueCount: 200, totalMatchingCount: 240, isTruncated: true,
    }));
    render(<HygieneView />);

    expect(screen.getByText(/Only the first 200 of 240 issues in scope were scanned/)).toBeInTheDocument();
    expect(screen.getByText(/200 of 240 scanned/)).toBeInTheDocument();
  });

  it('says nothing extra when the scan covered its whole scope', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({
      scannedIssueCount: 200, totalMatchingCount: 200, isTruncated: false,
    }));
    render(<HygieneView />);

    expect(screen.queryByText(/issues in scope were scanned/)).not.toBeInTheDocument();
  });
});

describe('HygieneView — a date flag shows the date it is complaining about', () => {
  function buildOverdueFinding() {
    return {
      issue: {
        key: 'ENCUC-2113',
        fields: {
          summary: 'SF - THUB reverting status back to Submitted in SF',
          issuetype: { name: 'Defect' },
          status: { name: 'Ready for Testing', statusCategory: { key: 'indeterminate' } },
          assignee: { displayName: 'Tamang, Dhan R' },
          updated: buildDateDaysAgo(4),
          created: buildDateDaysAgo(30),
          duedate: '2026-07-15',
        },
      },
      flags: [{ checkId: 'due-date-overdue', label: 'Due Date reached before completion', severity: 'warn' }],
      programIncrement: 'PI 26.4',
    } as unknown as HygieneFinding;
  }

  it('names the due date in the explanation instead of restating the flag label', () => {
    // The screenshot that started this: a card flagged "Due Date reached before completion" showing
    // Type, Status, PI, Assignee and Age — and nowhere the due date. Nothing on screen let anyone
    // judge the flag, and the sentence beneath it just repeated the label back.
    mockUseHygieneState.mockReturnValue(buildHookState({ findings: [buildOverdueFinding()] }));
    render(<HygieneView />);

    // Twice, deliberately: once in the sentence that explains the flag, once as a fact on the issue.
    expect(screen.getAllByText(/2026-07-15/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Due 2026-07-15 \(.*\) and not finished/)).toBeInTheDocument();
    expect(screen.queryByText(/fix it inline here, or open the issue in Jira/)).not.toBeInTheDocument();
  });

  it('shows the due date as its own fact on the issue, beside status and assignee', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ findings: [buildOverdueFinding()] }));
    render(<HygieneView />);

    expect(screen.getByText('Due')).toBeInTheDocument();
  });
});

describe('HygieneView — diagnostics', () => {
  it('offers a diagnostics report naming the running build and the raw dates the scan saw', async () => {
    // The tool that ends "it still isn't showing" arguments: it prints the version actually running
    // and the raw field values behind each flag, so a rendering bug and a fetch bug look different.
    mockUseHygieneState.mockReturnValue(buildHookState({
      findings: [{
        issue: {
          key: 'ENCUC-2113',
          fields: {
            summary: 'SF - THUB reverting status',
            issuetype: { name: 'Defect' },
            status: { name: 'Ready for Testing', statusCategory: { key: 'indeterminate' } },
            updated: buildDateDaysAgo(4),
            duedate: '2026-07-15',
          },
        },
        flags: [{ checkId: 'due-date-overdue', label: 'Due Date reached before completion', severity: 'warn' }],
        programIncrement: 'PI 26.4',
      } as unknown as HygieneFinding],
    }));
    render(<HygieneView />);

    fireEvent.click(screen.getByRole('button', { name: /Diagnostics/i }));

    expect(await screen.findByText(/duedate=2026-07-15/)).toBeInTheDocument();
    expect(screen.getByText(/App version:/)).toBeInTheDocument();
  });
});

describe('HygieneView — Fix all dates', () => {
  function buildOutOfSyncFinding(issueKey: string) {
    return {
      issue: {
        key: issueKey,
        fields: {
          summary: 'A story committed to a release',
          issuetype: { name: 'Story' },
          status: { name: 'Ready to Work', statusCategory: { key: 'indeterminate' } },
          updated: buildDateDaysAgo(1),
          fixVersions: [{ name: 'R1', releaseDate: '2026-10-08', released: false }],
          duedate: null,
        },
      },
      flags: [{ checkId: 'dates-out-of-sync', label: 'Dates do not match the fix version', severity: 'warn' }],
      programIncrement: null,
    } as unknown as HygieneFinding;
  }

  it('offers a bulk fix naming how many issues it will correct', () => {
    // The point of the bulk action: a policy that derives dates makes a hundred wrong issues one
    // click rather than a hundred edits. It says the count up front so the click is not a leap.
    mockUseHygieneState.mockReturnValue(buildHookState({
      findings: [buildOutOfSyncFinding('ENCUC-1'), buildOutOfSyncFinding('ENCUC-2')],
    }));
    render(<HygieneView />);

    expect(screen.getByRole('button', { name: /Fix all 2 date/i })).toBeInTheDocument();
  });

  it('offers no bulk fix when no issue has dates to correct', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ findings: [] }));
    render(<HygieneView />);

    expect(screen.queryByRole('button', { name: /Fix all/i })).not.toBeInTheDocument();
  });
});

describe('HygieneView — typing inside a finding row', () => {
  // The row is a role="button" that CONTAINS text inputs. Its keydown handler ran for every key
  // bubbling out of those inputs, so a space typed into the Feature search box was swallowed by
  // preventDefault() and collapsed the row on the way past. A multi-word Feature name could
  // therefore never be typed and the dropdown never appeared (GH #375).
  function buildFeatureLinkFinding(): HygieneFinding {
    return {
      issue: {
        key: 'TBX-909',
        fields: {
          summary: 'Needs a feature link',
          created: buildDateDaysAgo(3),
          updated: buildDateDaysAgo(3),
          status: { name: 'To Do', statusCategory: { key: 'new' } },
        },
      },
      flags: [{ checkId: 'missing-feature-link', label: 'Missing feature link', severity: 'warn' }],
    };
  }

  beforeEach(() => {
    mockUseHygieneState.mockReturnValue(buildHookState({ findings: [buildFeatureLinkFinding()] }));
  });

  it('does not toggle the row when a space is typed into the feature search box', () => {
    render(<HygieneView />);

    const searchBox = screen.getByLabelText(/search issues for link feature/i);
    const findingRow = screen.getByRole('link', { name: 'TBX-909' }).closest('[aria-expanded]');
    expect(findingRow).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(searchBox, { key: ' ' });

    expect(findingRow).toHaveAttribute('aria-expanded', 'false');
  });

  it('lets the space character reach the input rather than cancelling it', () => {
    render(<HygieneView />);

    const searchBox = screen.getByLabelText(/search issues for link feature/i);
    const wasNotCancelled = fireEvent.keyDown(searchBox, { key: ' ' });

    expect(wasNotCancelled).toBe(true);
  });

  it('still toggles the row when the space lands on the row itself', () => {
    render(<HygieneView />);

    const findingRow = screen.getByRole('link', { name: 'TBX-909' }).closest('[aria-expanded]');
    fireEvent.keyDown(findingRow as Element, { key: ' ' });

    expect(findingRow).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('HygieneView — a filter that hides everything says so', () => {
  // The reported symptom: a score of 70 over six flags with an empty list underneath. Both figures
  // were correct; a filter clicked in an earlier session had persisted and matched nothing in the
  // new scan. Nothing on screen named that filter or offered to clear it, so the page read as
  // broken software rather than as a filter — which is the worst way for a UI to be right.

  it('names the filter hiding the findings, and says how many are hidden', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'TBX',
      findings: [buildFinding()],
      filteredFindings: [],
      selectedFilter: 'target-end-overdue',
      checkLabelsById: { 'target-end-overdue': 'Target End reached before testing transition' },
      scannedIssueCount: 6,
      summary: buildSummary({ totalIssues: 2, totalFlags: 6 }),
    }));

    render(<HygieneView />);

    // The label also appears on its summary tile, so the notice is matched by its own wording.
    const notice = screen.getByText(/hidden by the/);
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain('Target End reached before testing transition');
    expect(notice.textContent).toContain('matches none of them');
  });

  it('offers a one-click way out, rather than an unlabelled tile at the end of a row', () => {
    const selectFilter = vi.fn();
    mockUseHygieneState.mockReturnValue({
      ...buildHookState({
        projectKey: 'TBX',
        findings: [buildFinding()],
        filteredFindings: [],
        selectedFilter: 'target-end-overdue',
        checkLabelsById: { 'target-end-overdue': 'Target End overdue' },
        scannedIssueCount: 6,
      }),
      selectFilter,
    });

    render(<HygieneView />);
    fireEvent.click(screen.getByRole('button', { name: /Show all 1/ }));

    expect(selectFilter).toHaveBeenCalledWith(null);
  });

  it('says nothing about filters when the scan genuinely found no flags', () => {
    // "Everything is clean" and "a filter is hiding it" must never look the same.
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'TBX',
      findings: [],
      filteredFindings: [],
      selectedFilter: null,
      scannedIssueCount: 6,
    }));

    render(<HygieneView />);

    expect(screen.queryByText(/hidden by the/)).not.toBeInTheDocument();
    expect(screen.getByText(/No Hygiene flags found/)).toBeInTheDocument();
  });

  it('says nothing about filters when a filter is set and still matches something', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'TBX',
      findings: [buildFinding()],
      filteredFindings: [buildFinding()],
      selectedFilter: 'missing-sp',
      scannedIssueCount: 6,
    }));

    render(<HygieneView />);

    expect(screen.queryByText(/hidden by the/)).not.toBeInTheDocument();
  });

  it('names every check in a multi-check filter, so a deep link can be understood too', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'TBX',
      findings: [buildFinding()],
      filteredFindings: [],
      selectedFilter: 'missing-sp,no-ac',
      checkLabelsById: { 'missing-sp': 'Missing story points', 'no-ac': 'Missing acceptance criteria' },
      scannedIssueCount: 6,
    }));

    render(<HygieneView />);

    expect(screen.getByText(/Missing story points or Missing acceptance criteria/)).toBeInTheDocument();
  });
});

describe('HygieneView — a scan that has not been run yet', () => {
  it('says so, instead of showing a grid of zeros that reads as a clean project', () => {
    // The reported failure: after picking a team and a PI, every tile reads 0, the score reads a
    // dash, and NOTHING on screen says why. "Not run yet" and "ran and found nothing" and
    // "everything is clean" all rendered identically — so a panel awaiting a button press looked
    // exactly like a broken one, and was reported as one.
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENFCT', scannedIssueCount: null }));

    render(<HygieneView />);

    expect(screen.getByText(/has not been run/i)).toBeInTheDocument();
  });

  it('names the button that would run it, so the next step is on screen', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENFCT', scannedIssueCount: null }));

    render(<HygieneView />);

    // The notice names the same button that is on screen — the point being that a reader is told
    // what to press, not left to guess which of twenty tiles is broken.
    expect(screen.getByRole('status')).toHaveTextContent(/Press Run Hygiene/i);
    expect(screen.getByRole('button', { name: /Run Hygiene/i })).toBeInTheDocument();
  });

  it('says nothing of the sort once a scan really has run and matched nothing', () => {
    // That state has its own message, and showing both would leave a reader unable to tell which
    // of the two situations they are in.
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENFCT', scannedIssueCount: 0 }));

    render(<HygieneView />);

    expect(screen.queryByText(/has not been run/i)).not.toBeInTheDocument();
    expect(screen.getByText(/matched no Jira issues/i)).toBeInTheDocument();
  });

  it('says nothing of the sort once a scan has found issues', () => {
    mockUseHygieneState.mockReturnValue(buildHookState({ projectKey: 'ENFCT', scannedIssueCount: 25 }));

    render(<HygieneView />);

    expect(screen.queryByText(/has not been run/i)).not.toBeInTheDocument();
  });

  it('still says it when a failed run left no count behind', () => {
    // A failed run also leaves scannedIssueCount null, and its error is shown separately. The panel
    // must not go on presenting stale zeros as though they were this scope's answer.
    mockUseHygieneState.mockReturnValue(buildHookState({
      projectKey: 'ENFCT', scannedIssueCount: null, loadError: 'Jira returned 400',
    }));

    render(<HygieneView />);

    expect(screen.getByText(/Jira returned 400/)).toBeInTheDocument();
  });
});
