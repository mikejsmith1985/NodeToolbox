// BacklogRemediationPanel.lifecycle.test.tsx — Verifies per-item decision/snooze controls capture the material-
// change fingerprint and that handled work does not resurface on refresh except on a genuine material change.

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

// Stub the grouped table so assertions focus on the panel's decision controls.
vi.mock('../../ReportsHub/AgingTriageActionTable.tsx', () => ({
  AgingTriageActionTable: () => <div data-testid="action-table" />,
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

/** A fetch result whose issuesByKey carries a real status category so fingerprints can be built. */
function fetchResult(keys: string[], statusCategoryKey: string) {
  return {
    agingInputs: keys.map((key) => ({ key, issueType: 'Story', createdIso: '2026-01-01' })),
    triageIssues: keys.map(signals),
    issuesByKey: new Map(keys.map((key) => [key, { fields: { status: { statusCategory: { key: statusCategoryKey } }, assignee: null } }])),
    acceptanceCriteriaFieldIds: [],
    jql: 'x',
    wasCapped: false,
  };
}

function renderPanel() {
  return render(<BacklogRemediationPanel teamProfileId="team-a" projectKey="ENCUC" piName={PI} />);
}

describe('BacklogRemediationPanel — decision lifecycle', () => {
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

  it('dismisses an item so it leaves the actionable list and does not resurface on a cosmetic refresh', async () => {
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1'], 'new'));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss ENCUC-1' })).toBeInTheDocument());

    // Dismiss it → it leaves the actionable decisions list.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ENCUC-1' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismiss ENCUC-1' })).toBeNull());

    // A refresh with the SAME status category (cosmetic) must NOT bring it back.
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1'], 'new'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });
    await waitFor(() => expect(mockFetchAgingBacklog.mock.calls.length).toBe(2));
    expect(screen.queryByRole('button', { name: 'Dismiss ENCUC-1' })).toBeNull();
  });

  it('re-admits a decided item when its status category changes (material change)', async () => {
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1'], 'new'));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel ENCUC-1' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ENCUC-1' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel ENCUC-1' })).toBeNull());

    // Refresh with a DIFFERENT status category → material change → it returns to the actionable list.
    mockFetchAgingBacklog.mockResolvedValue(fetchResult(['ENCUC-1'], 'indeterminate'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /refresh backlog/i }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel ENCUC-1' })).toBeInTheDocument());
  });
});
