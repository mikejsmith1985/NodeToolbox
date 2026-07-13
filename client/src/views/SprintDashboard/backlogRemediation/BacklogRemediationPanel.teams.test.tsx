// BacklogRemediationPanel.teams.test.tsx — Verifies parallel per-team isolation: switching the active team
// profile swaps the panel to that team's own queue, and acting in one team never mutates another's.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';

const { mockFetchAgingBacklog } = vi.hoisted(() => ({ mockFetchAgingBacklog: vi.fn() }));
vi.mock('../../ReportsHub/agingBacklogFetch.ts', () => ({
  fetchAgingBacklog: mockFetchAgingBacklog,
  AGING_BACKLOG_MAX_ISSUES: 2000,
  buildAgingJql: (scope: string) => `(${scope}) AND statusCategory != Done ORDER BY created ASC`,
}));

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
    jql: 'x',
    wasCapped: false,
  };
}

/** Refreshes the currently-mounted panel (fetch → reconcile) and ingests one verdict for `issueKey`. */
async function refreshAndIngest(issueKey: string, verdict: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
  });
  fireEvent.change(screen.getByLabelText(/triage reply/i), {
    target: { value: JSON.stringify({ kind: 'agingTriage', items: [{ issueKey, verdict, rationale: 'x' }] }) },
  });
  fireEvent.click(screen.getByRole('button', { name: /ingest verdicts/i }));
}

describe('BacklogRemediationPanel — parallel teams', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetchAgingBacklog.mockReset();
    useBacklogRemediationStore.setState({ storageKey: null, items: [], lastRefreshedIso: null, scopeOverrideJql: null });
    setAiAssistUnlocked(true);
  });
  afterEach(() => {
    setAiAssistUnlocked(false);
    localStorage.clear();
  });

  it('swaps to the switched team\'s queue and never bleeds decisions across teams', async () => {
    // Team A: one issue judged cancel-safe.
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['A-1']));
    const view = render(<BacklogRemediationPanel teamProfileId="team-a" projectKey="AAA" piName={PI} />);
    await refreshAndIngest('A-1', 'cancel-safe');
    await waitFor(() => expect(screen.getByText('cancel-safe:1')).toBeInTheDocument());

    // Switch to team B — its queue is empty; team A's verdict must NOT show.
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['B-9']));
    view.rerender(<BacklogRemediationPanel teamProfileId="team-b" projectKey="BBB" piName={PI} />);
    await waitFor(() => expect(screen.queryByText('cancel-safe:1')).toBeNull());

    // Act in team B (review) — this must not touch team A.
    await refreshAndIngest('B-9', 'review');
    await waitFor(() => expect(screen.getByText('review:1')).toBeInTheDocument());

    // Back to team A — its cancel-safe verdict is intact and B's review is absent.
    view.rerender(<BacklogRemediationPanel teamProfileId="team-a" projectKey="AAA" piName={PI} />);
    await waitFor(() => expect(screen.getByText('cancel-safe:1')).toBeInTheDocument());
    expect(screen.queryByText('review:1')).toBeNull();
  });
});
