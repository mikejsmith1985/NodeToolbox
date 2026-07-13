// AgingBulkClosePanel.test.tsx — Verifies the preview → commit bulk transition panel drives Jira writes safely.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JiraTransition } from '../../types/jira.ts';

// The Feature Review write helpers are mocked so the panel's discovery + apply can be asserted in jsdom.
const { mockFetchTransitions, mockSaveTransition } = vi.hoisted(() => ({
  mockFetchTransitions: vi.fn(),
  mockSaveTransition: vi.fn(),
}));
vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  fetchFeatureReviewTransitions: mockFetchTransitions,
  saveFeatureReviewTransition: mockSaveTransition,
}));

import { AgingBulkClosePanel } from './AgingBulkClosePanel.tsx';
import type { TriageFeatureGroup } from './agingTriageActionModel.ts';

const CANCELLED_TRANSITION: JiraTransition = { id: '11', name: 'Cancel', to: { name: 'Cancelled', statusCategory: { name: 'Done' } } };

/** A cancel-safe feature group: the feature FEAT-1 plus two supporting issues. */
const FEATURE_GROUP: TriageFeatureGroup = {
  featureKey: 'FEAT-1',
  featureSummary: 'Reporting feature',
  featureStatus: 'Done',
  issues: [
    { issueKey: 'ENCUC-1', verdict: 'cancel-safe', rationale: 'stale', summary: 'A', status: 'To Do', priority: 'Low', ageDays: 100 },
    { issueKey: 'ENCUC-2', verdict: 'cancel-safe', rationale: 'stale', summary: 'B', status: 'To Do', priority: 'Low', ageDays: 50 },
  ],
};

describe('AgingBulkClosePanel', () => {
  afterEach(() => {
    mockFetchTransitions.mockReset();
    mockSaveTransition.mockReset();
  });

  it('writes nothing until Commit, then transitions the feature and every selected item to the chosen status', async () => {
    mockFetchTransitions.mockResolvedValue([CANCELLED_TRANSITION]);
    mockSaveTransition.mockResolvedValue(undefined);

    render(<AgingBulkClosePanel featureGroup={FEATURE_GROUP} onClose={vi.fn()} />);

    // Safety promise is shown, and no write happens on render.
    expect(screen.getByText(/nothing is written to jira until you press commit/i)).toBeInTheDocument();
    expect(mockSaveTransition).not.toHaveBeenCalled();

    // Wait until transitions have loaded (the target select becomes enabled with the Cancelled option).
    await waitFor(() => expect(screen.getByRole('combobox')).not.toBeDisabled());
    expect(screen.getByRole('option', { name: /Cancelled/ })).toBeInTheDocument();

    // Commit covers the feature + its 2 items = 3 writes, each to the Cancelled transition (id 11).
    fireEvent.click(screen.getByRole('button', { name: /commit 3 change/i }));
    await waitFor(() => expect(mockSaveTransition).toHaveBeenCalledTimes(3));
    expect(mockSaveTransition).toHaveBeenCalledWith('FEAT-1', '11');
    expect(mockSaveTransition).toHaveBeenCalledWith('ENCUC-1', '11');
    expect(mockSaveTransition).toHaveBeenCalledWith('ENCUC-2', '11');
  });

  it('reports only the successfully-transitioned issues to onItemsClosed', async () => {
    mockFetchTransitions.mockResolvedValue([CANCELLED_TRANSITION]);
    // ENCUC-2's write fails, so it must NOT be reported as closed.
    mockSaveTransition.mockImplementation((key: string) => (key === 'ENCUC-2' ? Promise.reject(new Error('nope')) : Promise.resolve(undefined)));
    const onItemsClosed = vi.fn();

    render(<AgingBulkClosePanel featureGroup={FEATURE_GROUP} onClose={vi.fn()} onItemsClosed={onItemsClosed} />);
    await waitFor(() => expect(screen.getByRole('combobox')).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /commit 3 change/i }));

    await waitFor(() => expect(onItemsClosed).toHaveBeenCalledTimes(1));
    expect(onItemsClosed).toHaveBeenCalledWith(['FEAT-1', 'ENCUC-1']);
  });

  it('excludes a de-selected row from the commit', async () => {
    mockFetchTransitions.mockResolvedValue([CANCELLED_TRANSITION]);
    mockSaveTransition.mockResolvedValue(undefined);

    render(<AgingBulkClosePanel featureGroup={FEATURE_GROUP} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).not.toBeDisabled());

    // Uncheck ENCUC-2 → only the feature + ENCUC-1 remain (2 writes).
    fireEvent.click(screen.getByRole('checkbox', { name: /include ENCUC-2/i }));
    fireEvent.click(screen.getByRole('button', { name: /commit 2 change/i }));
    await waitFor(() => expect(mockSaveTransition).toHaveBeenCalledTimes(2));
    expect(mockSaveTransition).not.toHaveBeenCalledWith('ENCUC-2', '11');
  });
});
