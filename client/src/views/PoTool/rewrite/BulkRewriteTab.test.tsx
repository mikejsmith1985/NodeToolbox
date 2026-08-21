// BulkRewriteTab.test.tsx — Honest states (spec 030, US6): capture errors are shown per key, the
// AI panel is invisible while locked, and an ingest surfaces unknown/unparsed keys. Nothing fails silently.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockShowToast, mockImportKeys } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockShowToast: vi.fn(),
  mockImportKeys: vi.fn(),
}));

// The PI Review import resolver is exercised in its own unit test; here we only prove the wiring.
vi.mock('./importPiReviewFeatures.ts', () => ({ importPiReviewFeatureKeys: mockImportKeys }));

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
import { saveBatch } from './rewriteBatchStore.ts';

beforeEach(() => {
  mockJiraGet.mockReset();
  mockShowToast.mockReset();
  mockImportKeys.mockReset();
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

  // GH #220: "Import from PI Review" fills the keys box with the page's Feature keys (fill-then-capture).
  it('populates the keys box when importing Features from the PI Review page', async () => {
    const user = userEvent.setup();
    mockImportKeys.mockResolvedValue({ keys: ['DENP-1', 'DASP-2'], discoveredCount: 2, blockedReason: null });
    const piReviewTeam = { id: 't1', name: 'Team One', piReviewPages: [] };

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" selectedPiName="PI 2026.3" piReviewTeam={piReviewTeam as never} />);
    await user.click(screen.getByRole('button', { name: /import from pi review/i }));

    await waitFor(() => {
      expect((screen.getByLabelText('Jira keys') as HTMLTextAreaElement).value).toContain('DENP-1');
    });
    // Both projects come through — the page is the source, not a project-scoped query.
    expect((screen.getByLabelText('Jira keys') as HTMLTextAreaElement).value).toContain('DASP-2');
    expect(mockImportKeys).toHaveBeenCalledWith(piReviewTeam, 'PI 2026.3');
  });

  // GH #220: a reply the parser cannot read must show a clear reason, not silently do nothing.
  it('surfaces a clear error when the pasted reply is not readable JSON', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: 'd', customfield_10200: 'ac' } });
    setAiAssistUnlocked(true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));

    await user.click(await screen.findByRole('button', { name: /build the prompt/i }));
    fireEvent.change(await screen.findByLabelText(/paste the assistant/i), { target: { value: 'sorry, I could not do that' } });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    await waitFor(() => {
      expect(screen.getByText(/Could not read the reply/)).toBeInTheDocument();
    });
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

  // GH #220: the AI panel must stay available after every issue has a proposal, so a PO can re-run/regenerate
  // (previously it auto-hid once nothing needed a re-write, so unlocking AI showed nothing).
  it('keeps the re-write AI panel available after every issue has a proposal', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: 'd', customfield_10200: 'ac' } });
    setAiAssistUnlocked(true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));
    await user.click(await screen.findByRole('button', { name: /build the prompt/i }));

    const reply = JSON.stringify({ kind: 'featureRewriteBatch', items: [{ key: 'ABC-1', description: 'Description:\nx', acceptanceCriteria: 'ac' }] });
    fireEvent.change(await screen.findByLabelText(/paste the assistant/i), { target: { value: reply } });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    await waitFor(() => expect(screen.getByText(/Applied 1 re-write/)).toBeInTheDocument());
    // ABC-1 now has a proposal, but the AI panel is still there so the PO can re-generate.
    expect(screen.getByRole('button', { name: /build the prompt/i })).toBeInTheDocument();
  });
});

describe('BulkRewriteTab — reverting a re-write nobody liked', () => {
  /** Persists a batch holding one issue Toolbox has already written, ready to be reverted. */
  function seedSubmittedBatch() {
    saveBatch({
      id: 'batch-1',
      name: 'Enhancements',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: {
          summary: 'Original summary',
          description: 'orig desc',
          acceptanceCriteria: 'orig ac',
          capturedAtIso: '2026-08-21T00:00:00.000Z',
        },
        proposed: { description: 'rewritten desc', acceptanceCriteria: 'rewritten ac', isEdited: false },
        state: 'submitted',
        captureError: null,
        submitResult: { ok: true },
      }],
    });
  }

  it('offers to put a written issue back, counting what it would restore', async () => {
    // The capability the "before" snapshot existed for and never had: without it, a re-write the PO
    // dislikes leaves them worse off than never having run the batch.
    const user = userEvent.setup();
    seedSubmittedBatch();
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);

    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('button', { name: /Revert 1 to the captured original/i })).toBeInTheDocument();
  });

  it('offers nothing to revert before anything has been written', async () => {
    const user = userEvent.setup();
    saveBatch({
      id: 'batch-2',
      name: 'Untouched',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-9',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: null,
        state: 'captured',
        captureError: null,
        submitResult: null,
      }],
    });
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);

    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(screen.queryByRole('button', { name: /Revert .* to the captured original/i })).not.toBeInTheDocument();
  });
});

describe('BulkRewriteTab shared material', () => {
  it('says plainly when a batch has none, rather than leaving the panel blank', async () => {
    const user = userEvent.setup();
    saveBatch({
      id: 'batch-3',
      name: 'No material',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: null,
        state: 'captured',
        captureError: null,
        submitResult: null,
      }],
    });
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByText(/re-written from its own text alone/i)).toBeInTheDocument();
  });

  it('lists material the batch already carries, so a PO returning days later sees it', async () => {
    // The approval loop spans days. Material held only in the page would be gone by the time the
    // PO came back to the batch it produced.
    const user = userEvent.setup();
    saveBatch({
      id: 'batch-4',
      name: 'With material',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: null,
        state: 'captured',
        captureError: null,
        submitResult: null,
      }],
      sharedSources: [{ kind: 'paste', id: 'p1', label: 'Accessibility Standard', text: 'Contrast 4.5:1' }],
    });
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByText('Accessibility Standard')).toBeInTheDocument();
  });
});

describe('BulkRewriteTab SharePoint library browsing', () => {
  /** Persists a batch to open, so the shared-material panel is on screen. */
  function seedOpenableBatch(id: string, name: string) {
    saveBatch({
      id,
      name,
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: null,
        state: 'captured',
        captureError: null,
        submitResult: null,
      }],
    });
  }

  /** Answers the two document endpoints; everything else falls through to the existing stub. */
  function stubLibraryFetch(browseBody: unknown, fetchBody: unknown = { ok: true, documents: [] }) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/sharepoint-documents/browse')) {
        return { ok: true, status: 200, json: async () => browseBody } as Response;
      }
      if (url.includes('/api/sharepoint-documents/fetch')) {
        return { ok: true, status: 200, json: async () => fetchBody } as Response;
      }
      return previousFetch(input as RequestInfo, init);
    }) as unknown as typeof fetch;
  }

  it('lists the documents a walk found, with where each one lives', async () => {
    const user = userEvent.setup();
    seedOpenableBatch('batch-sp-1', 'Library batch');
    stubLibraryFetch({
      ok: true,
      documents: [{
        name: 'Accessibility Standard.md',
        folderPath: '/sites/D/Docs/Standards',
        serverRelativeUrl: '/sites/D/Docs/Standards/Accessibility Standard.md',
        modifiedAtIso: '2026-08-01T00:00:00Z',
      }],
      unreadable: [],
      skippedTooDeep: [],
      visitedFolderCount: 2,
    });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('SharePoint library folder'), '/sites/D/Docs');
    await user.click(screen.getByRole('button', { name: /browse library/i }));

    expect(await screen.findByText('Accessibility Standard.md')).toBeInTheDocument();
    expect(screen.getByText(/\/sites\/D\/Docs\/Standards/)).toBeInTheDocument();
  });

  it('says what it could not read and what it did not look in', async () => {
    // A listing showing only the readable documents would read as "this is the whole library",
    // which is the one thing it is not.
    const user = userEvent.setup();
    seedOpenableBatch('batch-sp-2', 'Gaps batch');
    stubLibraryFetch({
      ok: true,
      documents: [],
      unreadable: [{ name: 'Report.pdf', folderPath: '/x', serverRelativeUrl: '/x', modifiedAtIso: '', reason: 'pdf' }],
      skippedTooDeep: ['/sites/D/Docs/a/b/c/d/e/f/g'],
      visitedFolderCount: 7,
    });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('SharePoint library folder'), '/sites/D/Docs');
    await user.click(screen.getByRole('button', { name: /browse library/i }));

    expect(await screen.findByText(/Not readable: Report\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Not looked in \(too deep\)/)).toBeInTheDocument();
  });

  it('will not fetch until something is actually ticked', async () => {
    const user = userEvent.setup();
    seedOpenableBatch('batch-sp-3', 'Nothing ticked');
    stubLibraryFetch({
      ok: true,
      documents: [{ name: 'A.md', folderPath: '/x', serverRelativeUrl: '/x/A.md', modifiedAtIso: '' }],
      unreadable: [],
      skippedTooDeep: [],
      visitedFolderCount: 1,
    });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.type(screen.getByLabelText('SharePoint library folder'), '/sites/D/Docs');
    await user.click(screen.getByRole('button', { name: /browse library/i }));

    expect(await screen.findByRole('button', { name: /Add 0 selected/i })).toBeDisabled();
  });
});
