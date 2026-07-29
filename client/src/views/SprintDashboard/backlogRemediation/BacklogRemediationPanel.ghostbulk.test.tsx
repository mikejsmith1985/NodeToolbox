// BacklogRemediationPanel.ghostbulk.test.tsx — Verifies the ghost-done bucket's bulk-cancel affordance:
// the button appears only for "already done, not closed" items, it opens the shared bulk-close preview
// seeded with exactly those items, and committing it records them as canceled in the team's queue.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';
import type { TriageFeatureGroup } from '../../ReportsHub/agingTriageActionModel.ts';

const { mockFetchAgingBacklog } = vi.hoisted(() => ({ mockFetchAgingBacklog: vi.fn() }));
vi.mock('../../ReportsHub/agingBacklogFetch.ts', () => ({
  fetchAgingBacklog: mockFetchAgingBacklog,
  AGING_BACKLOG_MAX_ISSUES: 2000,
  buildAgingJql: (scope: string) => `(${scope}) AND statusCategory != Done ORDER BY created ASC`,
}));

// Keep the AI triage table inert — this test is about the grooming bucket's bulk-cancel path.
vi.mock('../../ReportsHub/AgingTriageActionTable.tsx', () => ({ AgingTriageActionTable: () => null }));

// Stub the shared bulk-close panel: expose the seeded issue keys and a button that simulates a commit
// which transitioned every seeded item, so we can assert the panel is seeded with the ghost-done set.
vi.mock('../../ReportsHub/AgingBulkClosePanel.tsx', () => ({
  AgingBulkClosePanel: ({ featureGroup, onItemsClosed }: { featureGroup: TriageFeatureGroup; onItemsClosed?: (keys: string[]) => void }) => (
    <div data-testid="bulk-panel">
      <span data-testid="seeded-keys">{featureGroup.issues.map((issue) => issue.issueKey).join(',')}</span>
      <button type="button" onClick={() => onItemsClosed?.(featureGroup.issues.map((issue) => issue.issueKey))}>
        simulate-commit
      </button>
    </div>
  ),
}));

import { BacklogRemediationPanel } from './BacklogRemediationPanel.tsx';
import { useBacklogRemediationStore } from './useBacklogRemediationStore.ts';

const PI = 'PI 2026.3';

/** A ghost-done item: a done-NAMED status while the category is still open — "done but not closed". */
function ghostDoneSignals(issueKey: string): AgingTriageIssue {
  return {
    issueKey, issueType: 'Story', summary: `Summary ${issueKey}`, status: 'Done', ageDays: 120, daysInStatus: 60,
    daysSinceUpdate: 40, assignee: 'Ada Lovelace', storyPoints: 3, hasDescription: true, hasAcceptanceCriteria: true,
    priority: 'Medium', featureKey: null, featureSummary: null, featureStatus: null,
  };
}

function fetchResult(keys: string[]) {
  return {
    agingInputs: keys.map((key) => ({ key, issueType: 'Story', createdIso: '2026-01-01' })),
    triageIssues: keys.map(ghostDoneSignals),
    issuesByKey: new Map(keys.map((key) => [key, { fields: { status: { name: 'Done', statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Ada Lovelace' } } }])),
    acceptanceCriteriaFieldIds: [],
    jql: 'x',
    wasCapped: false,
  };
}

describe('BacklogRemediationPanel — ghost-done bulk cancel', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetchAgingBacklog.mockReset();
    useBacklogRemediationStore.setState({ storageKey: null, items: [], lastRefreshedIso: null, scopeOverrideJql: null });
    setAiAssistUnlocked(false);
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('offers bulk cancel on the ghost-done bucket, seeds the preview with those items, and records the commit', async () => {
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1', 'ENCUC-2']));
    render(<BacklogRemediationPanel teamProfileId="team-a" projectKey="ENCUC" piName={PI} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });

    // The ghost-done bucket and its bulk-cancel button appear for the two done-but-not-closed items.
    const bulkButton = await screen.findByRole('button', { name: /bulk cancel \(2\)/i });
    fireEvent.click(bulkButton);

    // The shared preview is seeded with exactly the ghost-done issue keys.
    expect(screen.getByTestId('seeded-keys')).toHaveTextContent('ENCUC-1,ENCUC-2');

    // Committing the bulk close records both as canceled — they leave the actionable queue.
    fireEvent.click(screen.getByRole('button', { name: /simulate-commit/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel ENCUC-1' })).toBeNull());

    const items = useBacklogRemediationStore.getState().items;
    expect(items.find((item) => item.issueKey === 'ENCUC-1')?.status).toBe('canceled');
    expect(items.find((item) => item.issueKey === 'ENCUC-2')?.status).toBe('canceled');
  });

  it('shows no bulk-cancel button when nothing is ghost-done', async () => {
    // A plain stale item (open status, not done-named) must not land in the ghost-done bucket.
    const stale = { ...ghostDoneSignals('ENCUC-9'), status: 'In Progress' };
    mockFetchAgingBacklog.mockResolvedValue({ ...fetchResult(['ENCUC-9']), triageIssues: [stale] });
    render(<BacklogRemediationPanel teamProfileId="team-b" projectKey="ENCUC" piName={PI} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel ENCUC-9' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /bulk cancel/i })).toBeNull();
  });
});
