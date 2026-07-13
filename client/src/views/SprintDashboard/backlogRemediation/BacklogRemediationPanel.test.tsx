// BacklogRemediationPanel.test.tsx — Verifies the gated panel fetches, ingests verdicts into the per-team
// store, and RESUMES from persisted state on a fresh mount without re-running the AI round-trip.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';

// Mock the shared backlog fetch so no real Jira call happens; the panel's own wiring is what we test.
const { mockFetchAgingBacklog } = vi.hoisted(() => ({ mockFetchAgingBacklog: vi.fn() }));
vi.mock('../../ReportsHub/agingBacklogFetch.ts', () => ({
  fetchAgingBacklog: mockFetchAgingBacklog,
  AGING_BACKLOG_MAX_ISSUES: 2000,
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

  it('renders nothing while AI Assist is locked', () => {
    setAiAssistUnlocked(false);
    renderPanel();
    expect(screen.queryByTestId('action-table')).toBeNull();
    expect(screen.queryByRole('button', { name: /refresh backlog/i })).toBeNull();
  });

  it('fetches, builds the prompt, and ingests verdicts into the grouped table', async () => {
    setAiAssistUnlocked(true);
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1', 'ENCUC-2']));
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });

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

    // A fresh mount for the same scope shows the persisted verdict WITHOUT another fetch.
    renderPanel();
    await waitFor(() => expect(screen.getByText('cancel-safe:1')).toBeInTheDocument());
    expect(mockFetchAgingBacklog.mock.calls.length).toBe(callsAfterIngest);
  });
});
