// BacklogRemediationPanel.test.tsx — Verifies the gated panel fetches, ingests verdicts into the per-team
// store, and RESUMES from persisted state on a fresh mount without re-running the AI round-trip.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';
import type { RemediationItem } from './remediationTypes.ts';

// Mock the shared backlog fetch so no real Jira call happens; the panel's own wiring is what we test.
const { mockFetchAgingBacklog } = vi.hoisted(() => ({ mockFetchAgingBacklog: vi.fn() }));
vi.mock('../../ReportsHub/agingBacklogFetch.ts', () => ({
  fetchAgingBacklog: mockFetchAgingBacklog,
  AGING_BACKLOG_MAX_ISSUES: 2000,
  // The panel hands fetchAgingBacklog a RAW scope clause; the real fetch owns the single ORDER BY wrap. The stub
  // keeps buildAgingJql exported for any transitive importer, but resolveTeamScope no longer wraps (GH #197).
  buildAgingJql: (scope: string) => `(${scope}) AND statusCategory != Done ORDER BY created ASC`,
}));

// Stub the heavy actionable table down to the verdicts it was handed, so assertions stay on the panel's wiring.
vi.mock('../../ReportsHub/AgingTriageActionTable.tsx', () => ({
  AgingTriageActionTable: ({ model }: { model: { verdictGroups: { verdict: string; issueCount: number }[] } }) => (
    <div data-testid="action-table">
      {model.verdictGroups.map((group) => (
        <div key={group.verdict}>{`${group.verdict}:${group.issueCount}`}</div>
      ))}
    </div>
  ),
}));

import { BacklogRemediationPanel } from './BacklogRemediationPanel.tsx';
import { useBacklogRemediationStore } from './useBacklogRemediationStore.ts';

const TEAM = 'team-a';
const PROJECT = 'ENCUC';
const PI = 'PI 2026.3';

function signals(issueKey: string): AgingTriageIssue {
  return {
    issueKey, issueType: 'Story', summary: `Summary ${issueKey}`, status: 'To Do', ageDays: 200, daysInStatus: 120,
    daysSinceUpdate: 90, assignee: null, storyPoints: 5, hasDescription: false, hasAcceptanceCriteria: false,
    priority: 'Low', featureKey: null, featureSummary: null, featureStatus: null,
  };
}

function fetchResult(keys: string[]) {
  return {
    agingInputs: keys.map((key) => ({ key, issueType: 'Story', createdIso: '2026-01-01' })),
    triageIssues: keys.map(signals),
    issuesByKey: new Map(),
    acceptanceCriteriaFieldIds: [],
    jql: `(project = ${PROJECT}) AND statusCategory != Done ORDER BY created ASC`,
    wasCapped: false,
  };
}

/** A full Jira issue as the enriched fetch would return it, for hydration-context assertions. */
function fullIssue(
  issueKey: string,
  detail: { status: string; assignee: string | null; summary: string; acceptanceCriteria?: string },
): JiraIssue {
  return {
    key: issueKey,
    fields: {
      summary: detail.summary,
      issuetype: { name: 'Story' },
      status: { name: detail.status, statusCategory: { key: 'new' } },
      assignee: detail.assignee !== null ? { displayName: detail.assignee } : null,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-06-01T00:00:00.000Z',
      ...(detail.acceptanceCriteria !== undefined ? { customfield_10200: detail.acceptanceCriteria } : {}),
    },
  } as unknown as JiraIssue;
}

/** A fetch result whose issuesByKey carries the given full issues, so the panel can hydrate their detail. */
function fetchResultWithIssues(issues: JiraIssue[], acceptanceCriteriaFieldIds: string[] = []) {
  const keys = issues.map((issue) => (issue as unknown as { key: string }).key);
  return {
    agingInputs: keys.map((key) => ({ key, issueType: 'Story', createdIso: '2026-01-01' })),
    triageIssues: keys.map(signals),
    issuesByKey: new Map(issues.map((issue) => [(issue as unknown as { key: string }).key, issue])),
    acceptanceCriteriaFieldIds,
    jql: `(project = ${PROJECT}) AND statusCategory != Done ORDER BY created ASC`,
    wasCapped: false,
  };
}

/** A pending remediation item, the shape a resumed session loads from persistence. */
function pendingItem(issueKey: string): RemediationItem {
  return {
    issueKey, verdict: null, rationale: '', status: 'pending', snoozeUntilIso: null,
    fingerprint: null, decidedAtIso: null, signals: signals(issueKey),
  };
}

/** Persists one actionable item under team A's scope key, so a subsequent mount resumes it without a refresh. */
function seedResumedItem(item: RemediationItem): void {
  act(() => {
    const store = useBacklogRemediationStore.getState();
    store.setScope(TEAM, PROJECT, PI);
    store.applyReconcile([item], '2026-07-20');
  });
}

/** Renders the panel for team A and returns the RTL result. */
function renderPanel() {
  return render(<BacklogRemediationPanel teamProfileId={TEAM} projectKey={PROJECT} piName={PI} />);
}

describe('BacklogRemediationPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetchAgingBacklog.mockReset();
    // Reset the singleton store to an unscoped, empty state between tests.
    useBacklogRemediationStore.setState({ storageKey: null, items: [], lastRefreshedIso: null, scopeOverrideJql: null });
  });
  afterEach(() => {
    setAiAssistUnlocked(false);
    localStorage.clear();
  });

  it('renders the manual triage even while AI Assist is locked, hiding only the AI accelerator', () => {
    setAiAssistUnlocked(false);
    renderPanel();
    // The triage workflow works without AI: scope, refresh, and the action table are all present.
    expect(screen.getByRole('button', { name: /refresh backlog/i })).toBeInTheDocument();
    expect(screen.getByTestId('action-table')).toBeInTheDocument();
    expect(screen.getByLabelText(/scope override/i)).toBeInTheDocument();
    // Only the AI copy/paste accelerator stays gated behind Ctrl+Alt+Z.
    expect(screen.queryByLabelText(/triage prompt/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /ingest verdicts/i })).toBeNull();
  });

  it('reveals the AI accelerator once AI Assist is unlocked, alongside the always-present triage', () => {
    setAiAssistUnlocked(true);
    renderPanel();
    expect(screen.getByRole('button', { name: /refresh backlog/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/triage prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ingest verdicts/i })).toBeInTheDocument();
  });

  it('fetches, builds the prompt, and ingests verdicts into the grouped table', async () => {
    setAiAssistUnlocked(true);
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1', 'ENCUC-2']));
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });

    // The fetch must receive the RAW scope clause (`project = ENCUC`) so it wraps exactly once — never the
    // pre-wrapped string that produced the double-ORDER-BY 400 (GH #197).
    expect(mockFetchAgingBacklog).toHaveBeenCalledWith(`project = ${PROJECT}`, expect.any(String));

    // The prompt now names the fetched issues.
    const promptBox = screen.getByLabelText(/triage prompt/i) as HTMLTextAreaElement;
    await waitFor(() => expect(promptBox.value).toContain('ENCUC-1'));

    // Paste a reply and ingest → the stubbed table shows the ingested verdicts.
    const replyBox = screen.getByLabelText(/triage reply/i);
    fireEvent.change(replyBox, {
      target: {
        value: JSON.stringify({
          kind: 'agingTriage',
          items: [
            { issueKey: 'ENCUC-1', verdict: 'cancel-safe', rationale: 'stale' },
            { issueKey: 'ENCUC-2', verdict: 'review', rationale: 'unclear' },
          ],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /ingest verdicts/i }));

    await waitFor(() => expect(screen.getByText('cancel-safe:1')).toBeInTheDocument());
    expect(screen.getByText('review:1')).toBeInTheDocument();
  });

  it('resumes prior verdicts from persistence on a fresh mount without re-fetching', async () => {
    setAiAssistUnlocked(true);
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1']));
    const first = renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });
    fireEvent.change(screen.getByLabelText(/triage reply/i), {
      target: { value: JSON.stringify({ kind: 'agingTriage', items: [{ issueKey: 'ENCUC-1', verdict: 'cancel-safe', rationale: 'stale' }] }) },
    });
    fireEvent.click(screen.getByRole('button', { name: /ingest verdicts/i }));
    await waitFor(() => expect(screen.getByText('cancel-safe:1')).toBeInTheDocument());

    const callsAfterIngest = mockFetchAgingBacklog.mock.calls.length;
    first.unmount();

    // A fresh mount for the same scope shows the persisted verdict with NO AI round-trip re-run. It now ALSO
    // hydrates each item's detail once on load (FR-016) — one extra fetch — but the verdict still comes purely
    // from persistence, not from re-ingesting a reply.
    renderPanel();
    await waitFor(() => expect(screen.getByText('cancel-safe:1')).toBeInTheDocument());
    expect(mockFetchAgingBacklog.mock.calls.length).toBe(callsAfterIngest + 1);
  });

  it('hydrates each resumed item on load and shows its status, owner, summary, and AC beside the buttons', async () => {
    const issue = fullIssue('ENCUC-1', {
      status: 'In Progress', assignee: 'Smith, Jane (CTR)', summary: 'Summary ENCUC-1', acceptanceCriteria: 'Given a signed-in user',
    });
    mockFetchAgingBacklog.mockResolvedValue(fetchResultWithIssues([issue], ['customfield_10200']));
    seedResumedItem(pendingItem('ENCUC-1'));

    await act(async () => {
      renderPanel();
    });

    // Context is fetched on LOAD (no manual Refresh) and renders beside the item's own action buttons.
    await waitFor(() => expect(screen.getByText('In Progress')).toBeInTheDocument());
    expect(screen.getByText('Smith, Jane (CTR)')).toBeInTheDocument();
    expect(screen.getByText('Summary ENCUC-1')).toBeInTheDocument();
    expect(screen.getByText(/Given a signed-in user/)).toBeInTheDocument();
    // The buttons stay unambiguously bound to this item.
    expect(screen.getByRole('button', { name: 'Keep ENCUC-1' })).toBeInTheDocument();
  });

  it('shows a compact loading state beside a pending item while its detail is still loading', async () => {
    // A fetch that never settles keeps the item in its loading state so we can observe it.
    let resolveFetch: (value: unknown) => void = () => {};
    mockFetchAgingBacklog.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    seedResumedItem(pendingItem('ENCUC-1'));

    await act(async () => {
      renderPanel();
    });

    // Never a silent blank next to a live button: a loading note sits beside the still-clickable buttons.
    expect(screen.getByText(/loading context/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep ENCUC-1' })).toBeInTheDocument();

    // Settle the fetch to avoid a dangling act() update after the test ends.
    await act(async () => {
      resolveFetch(fetchResultWithIssues([]));
    });
  });

  it('still calls the store decide action when a hydrated item is decided', async () => {
    const issue = fullIssue('ENCUC-1', { status: 'To Do', assignee: null, summary: 'Summary ENCUC-1' });
    mockFetchAgingBacklog.mockResolvedValue(fetchResultWithIssues([issue]));
    seedResumedItem(pendingItem('ENCUC-1'));
    const decideSpy = vi.fn();
    act(() => {
      useBacklogRemediationStore.setState({ decide: decideSpy });
    });

    await act(async () => {
      renderPanel();
    });
    await waitFor(() => expect(screen.getByText('To Do')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Keep ENCUC-1' }));
    expect(decideSpy).toHaveBeenCalledWith('ENCUC-1', 'kept', expect.any(Object), expect.any(String));
  });
});
