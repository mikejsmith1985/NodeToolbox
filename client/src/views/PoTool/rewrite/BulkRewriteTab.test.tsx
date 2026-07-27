// BulkRewriteTab.test.tsx — Honest states (spec 030, US6): capture errors are shown per key, the
// AI panel is invisible while locked, and an ingest surfaces unknown/unparsed keys. Nothing fails silently.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockShowToast } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockShowToast: vi.fn(),
}));

// runCommit reads createIssue/createIssueLink at module load for its default deps, so both must exist.
vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
}));

vi.mock('../../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: vi.fn(),
}));

vi.mock('../../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Field-config hook stubbed so the tab has a stable AC field id without the real async config fetch.
vi.mock('../hooks/usePoHygieneContext', () => ({
  usePoHygieneContext: () => ({
    fieldConfig: { acceptanceCriteriaFieldIds: ['description', 'customfield_10200'] },
    fieldConfigError: null,
    isLoadingFieldConfig: false,
    evaluateDraft: vi.fn(() => []),
  }),
}));

import { setAiAssistUnlocked } from '../../../store/aiAssistStore';
import BulkRewriteTab from './BulkRewriteTab.tsx';

beforeEach(() => {
  mockJiraGet.mockReset();
  mockShowToast.mockReset();
  setAiAssistUnlocked(false);
  window.localStorage.clear();
});

afterEach(() => {
  setAiAssistUnlocked(false);
});

describe('BulkRewriteTab honest states', () => {
  it('lists a capture error per unreachable key and counts the rest as not-yet-rewritten, hiding the locked AI panel', async () => {
    const user = userEvent.setup();
    // ABC-1 captures cleanly; ABC-2 is unreachable.
    mockJiraGet.mockImplementation((path: string) =>
      path.includes('ABC-2')
        ? Promise.reject(new Error('Issue does not exist'))
        : Promise.resolve({ fields: { summary: 'S1', description: 'd1', customfield_10200: 'ac1' } }),
    );

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1 ABC-2');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));

    await waitFor(() => {
      expect(screen.getByText(/Could not capture ABC-2/)).toBeInTheDocument();
    });
    // The one good issue has no proposal yet — surfaced, not hidden.
    expect(screen.getByText(/1 issue\(s\) not yet re-written/)).toBeInTheDocument();
    // AI Assist is locked → the round-trip panel renders nothing at all.
    expect(screen.queryByText('Re-write these issues')).not.toBeInTheDocument();
  });

  it('once unlocked, an ingest surfaces unknown and unparsed keys', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: 'd', customfield_10200: 'ac' } });
    setAiAssistUnlocked(true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1 ABC-2');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));

    // The panel shows only "Build the prompt" until the prompt is generated; then the reply box appears.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /build the prompt/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /build the prompt/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/paste the assistant/i)).toBeInTheDocument();
    });

    const reply = JSON.stringify({
      kind: 'featureRewriteBatch',
      items: [
        { key: 'ABC-1', description: 'Description:\nrewritten', acceptanceCriteria: 'new ac' },
        { key: 'ZZZ-9', description: 'unknown issue' }, // not in this batch → rejected
        // ABC-2 omitted → still not re-written
      ],
    });
    // fireEvent.change avoids userEvent.type parsing the JSON braces as key syntax.
    fireEvent.change(screen.getByLabelText(/paste the assistant/i), { target: { value: reply } });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    await waitFor(() => {
      expect(screen.getByText(/Applied 1 re-write/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Ignored ZZZ-9/)).toBeInTheDocument();
  });

  // GH #220: when a large batch splits into multiple prompt parts, ingesting an earlier part's reply must
  // NOT re-pack the remaining issues and make a later part's panel disappear mid-review.
  it('keeps every prompt part visible after an earlier part is ingested', async () => {
    const user = userEvent.setup();
    // Descriptions long enough (each capped at 4000 chars in the prompt) that five issues force a 2-part split.
    const bigDescription = 'A'.repeat(4100);
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: bigDescription, customfield_10200: 'ac' } });
    setAiAssistUnlocked(true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1 ABC-2 ABC-3 ABC-4 ABC-5');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));

    // The batch splits into two parts up front.
    await waitFor(() => {
      expect(screen.getByText(/part 1 of 2/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/part 2 of 2/i)).toBeInTheDocument();

    // Build + ingest part 1 only (propose the first three issues, leaving the rest outstanding).
    await user.click(screen.getAllByRole('button', { name: /build the prompt/i })[0]);
    await waitFor(() => {
      expect(screen.getByLabelText(/paste the assistant/i)).toBeInTheDocument();
    });
    const partOneReply = JSON.stringify({
      kind: 'featureRewriteBatch',
      items: [
        { key: 'ABC-1', description: 'Description:\none', acceptanceCriteria: 'ac1' },
        { key: 'ABC-2', description: 'Description:\ntwo', acceptanceCriteria: 'ac2' },
        { key: 'ABC-3', description: 'Description:\nthree', acceptanceCriteria: 'ac3' },
      ],
    });
    fireEvent.change(screen.getByLabelText(/paste the assistant/i), { target: { value: partOneReply } });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    // Part 2 must still be on screen — the outstanding issues did not collapse the partition.
    await waitFor(() => {
      expect(screen.getByText(/Applied 3 re-write/)).toBeInTheDocument();
    });
    expect(screen.getByText(/part 2 of 2/i)).toBeInTheDocument();
  });
});
