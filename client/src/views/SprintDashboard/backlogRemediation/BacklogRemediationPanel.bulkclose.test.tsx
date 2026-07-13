// BacklogRemediationPanel.bulkclose.test.tsx — Verifies that issues a bulk close actually transitioned are
// recorded as `canceled` in this team's queue (and thus leave the actionable list).

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

// Stub the table to a button that fires onItemsCanceled — standing in for a completed bulk close.
vi.mock('../../ReportsHub/AgingTriageActionTable.tsx', () => ({
  AgingTriageActionTable: ({ onItemsCanceled }: { onItemsCanceled?: (keys: string[]) => void }) => (
    <button type="button" onClick={() => onItemsCanceled?.(['ENCUC-1'])}>simulate-bulk-close-ENCUC-1</button>
  ),
}));

import { BacklogRemediationPanel } from './BacklogRemediationPanel.tsx';
import { useBacklogRemediationStore } from './useBacklogRemediationStore.ts';

const PI = 'PI 2026.3';

function signals(issueKey: string): AgingTriageIssue {
  return {
    issueKey, issueType: 'Story', summary: `Summary ${issueKey}`, status: 'To Do', ageDays: 200, daysInStatus: 120,
    daysSinceUpdate: 90, assignee: null, storyPoints: 5, hasDescription: false, hasAcceptanceCriteria: false,
    priority: 'Low', featureKey: 'FEAT-1', featureSummary: 'F', featureStatus: 'Done',
  };
}

function fetchResult(keys: string[]) {
  return {
    agingInputs: keys.map((key) => ({ key, issueType: 'Story', createdIso: '2026-01-01' })),
    triageIssues: keys.map(signals),
    issuesByKey: new Map(keys.map((key) => [key, { fields: { status: { statusCategory: { key: 'new' } }, assignee: null } }])),
    acceptanceCriteriaFieldIds: [],
    jql: 'x',
    wasCapped: false,
  };
}

describe('BacklogRemediationPanel — bulk close recording', () => {
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

  it('marks bulk-closed issues canceled in the store and removes them from the actionable list', async () => {
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1', 'ENCUC-2']));
    render(<BacklogRemediationPanel teamProfileId="team-a" projectKey="ENCUC" piName={PI} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel ENCUC-1' })).toBeInTheDocument());

    // Simulate a bulk close that transitioned ENCUC-1.
    fireEvent.click(screen.getByRole('button', { name: /simulate-bulk-close-ENCUC-1/i }));

    // ENCUC-1 is now canceled (gone from the actionable decisions list); ENCUC-2 remains.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel ENCUC-1' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Cancel ENCUC-2' })).toBeInTheDocument();

    const stored = useBacklogRemediationStore.getState().items.find((item) => item.issueKey === 'ENCUC-1');
    expect(stored?.status).toBe('canceled');
    expect(stored?.fingerprint).toEqual({ statusCategoryKey: 'new', assigneeKey: null });
  });
});
