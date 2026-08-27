// BulkRewriteTab.test.tsx — Honest states (spec 030, US6): capture errors are shown per key, the
// AI panel is invisible while locked, and an ingest surfaces unknown/unparsed keys. Nothing fails silently.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockShowToast, mockImportKeys, mockReadPdf, mockReadMessage } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockShowToast: vi.fn(),
  mockImportKeys: vi.fn(),
  mockReadPdf: vi.fn(),
  mockReadMessage: vi.fn(),
}));

// The readers are proved against real property streams and real page items in their own unit tests.
// Here only the wiring is under test, and loading pdf.js into jsdom to prove it would test nothing.
vi.mock('../sources/pdfSource.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sources/pdfSource.ts')>()),
  readPdfSource: mockReadPdf,
}));

vi.mock('../sources/outlookMessageSource.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sources/outlookMessageSource.ts')>()),
  readOutlookMessageSource: mockReadMessage,
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
import { PdfReadError } from '../sources/pdfSource.ts';
import type { ItemState as ItemStateForTest } from './rewriteBatchModel.ts';

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
    // Descriptions long enough (each capped at 4000 chars in the prompt) that five issues force a split.
    // The exact part COUNT is fixture arithmetic and not the point; that it does not MOVE is.
    const bigDescription = 'A'.repeat(4100);
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: bigDescription, customfield_10200: 'ac' } });
    setAiAssistUnlocked(true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1 ABC-2 ABC-3 ABC-4 ABC-5');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));

    // The batch splits up front. Whatever it split into is what must survive the ingest below.
    await waitFor(() => {
      expect(screen.getByText(/part 1 of \d+/i)).toBeInTheDocument();
    });
    // Counted as PANELS, not as text: once a prompt is built its own text also contains the words.
    const partCountBeforeIngest = screen.getAllByRole('region', { name: /part \d+ of \d+/i }).length;

    expect(partCountBeforeIngest).toBeGreaterThan(1);

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

    // Every part must still be on screen. Ingesting part one gives those issues a working draft, and
    // sizing the split on the ACTUAL draft would re-pack the batch and make a later part vanish from
    // under an in-flight review — which is why the split reserves room for a draft up front.
    await waitFor(() => {
      expect(screen.getByText(/Applied 3 re-write/)).toBeInTheDocument();
    });
    expect(screen.getAllByRole('region', { name: /part \d+ of \d+/i })).toHaveLength(partCountBeforeIngest);
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
  /** One captured batch, which is what makes the Shared material panel reachable. */
  function seedBatchForPaste(): void {
    saveBatch({
      id: 'batch-paste',
      name: 'Paste',
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

  // ── Pasting a page whose meaning is its table (GH #376) ──────────────────

  it('keeps the columns when a table is pasted into a shared note', async () => {
    // A OneNote page in a Teams tab cannot be exported, so a paste is the only way it arrives — and
    // a four-column Billing Grid pasted as plain text loses the thing that made its cells mean
    // anything: which column they were in.
    const user = userEvent.setup();
    seedBatchForPaste();
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    const noteBox = await screen.findByLabelText('Pasted note');
    fireEvent.paste(noteBox, {
      clipboardData: {
        getData: (flavour: string) => (flavour === 'text/html'
          ? '<table><tr><td>Process</td><td>Blue</td><td>Assumption</td></tr>'
            + '<tr><td>LIS Processing</td><td>Consolidated</td><td>Blue gains flexibility</td></tr></table>'
          : 'Process Blue Assumption LIS Processing Consolidated Blue gains flexibility'),
      },
    });

    await waitFor(() => expect((noteBox as HTMLTextAreaElement).value)
      .toContain('| Process | Blue | Assumption |'));
    expect((noteBox as HTMLTextAreaElement).value).toContain('| LIS Processing | Consolidated | Blue gains flexibility |');
  });

  it('takes the plain text when a paste carries no HTML', async () => {
    // An ordinary paste from a plain-text editor, not an error.
    const user = userEvent.setup();
    seedBatchForPaste();
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    const noteBox = await screen.findByLabelText('Pasted note');
    fireEvent.paste(noteBox, {
      clipboardData: { getData: (flavour: string) => (flavour === 'text/html' ? '' : 'just some words') },
    });

    await waitFor(() => expect((noteBox as HTMLTextAreaElement).value).toBe('just some words'));
  });

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

    // Scoped to the shared-material list: the condense panel lists the same documents, and an
    // unscoped query would pass or fail on which of the two happened to render first.
    const sharedMaterialList = await screen.findByLabelText('Shared material');

    expect(within(sharedMaterialList).getByText('Accessibility Standard')).toBeInTheDocument();
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

// ── Workflow order and honest affordances (GH #376) ────────────────────────
//
// A PO pasted their notes link into "Confluence review page URL" — the field that PUBLISHES the
// review document — because it sat above the field that READS notes in, wore a near-identical
// label, and lit up the only enabled button on the screen: "Write approved to Jira".

describe('BulkRewriteTab workflow order', () => {
  /** One captured batch with no proposal yet — the state the PO was actually in. */
  function seedCapturedBatch(): void {
    saveBatch({
      id: 'batch-order',
      name: 'Order',
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

  /** Opens the seeded batch, which is what puts the workflow sections on screen. */
  async function openSeededBatch(): Promise<void> {
    const user = userEvent.setup();
    seedCapturedBatch();
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
  }

  it('numbers the steps so the order of operations is on screen', async () => {
    await openSeededBatch();

    expect(await screen.findByText(/Step 1 — Notes to write from/)).toBeInTheDocument();
    expect(screen.getByText(/Step 4 — Review before \/ after/)).toBeInTheDocument();
    expect(screen.getByText(/Step 5 — Publish for review/)).toBeInTheDocument();
  });

  it('puts the notes you write FROM above the review you publish TO', async () => {
    // Reading order was backwards: the submit controls rendered above the place you add your source.
    await openSeededBatch();

    const pageText = document.body.textContent ?? '';

    expect(pageText.indexOf('Step 1 — Notes to write from')).toBeLessThan(pageText.indexOf('Step 5 — Publish for review'));
  });

  it('names each Confluence field by its DIRECTION, so the two cannot be confused', async () => {
    await openSeededBatch();

    expect(await screen.findByLabelText(/notes to read FROM/)).toBeInTheDocument();
    expect(screen.getByLabelText(/publish the review TO/)).toBeInTheDocument();
  });

  it('refuses to write to Jira when nothing is approved, however the URL got filled in', async () => {
    // The old guard was only "the URL is non-empty", so a link pasted into the wrong field enabled a
    // terminal action at a stage where there was nothing whatsoever to write. The write no longer
    // depends on the URL at all — it writes what was approved here.
    const user = userEvent.setup();
    await openSeededBatch();

    await user.type(await screen.findByLabelText(/publish the review TO/), 'https://example.atlassian.net/wiki/pages/1/Notes');

    expect(screen.getByRole('button', { name: /Write 0 approved to Jira/ })).toBeDisabled();
  });

  it('says WHY it cannot write yet rather than leaving a dead button', async () => {
    await openSeededBatch();

    expect(await screen.findByText(/no issue in this batch has a re-write/)).toBeInTheDocument();
  });
});

// ── The refine loop (GH #376) ──────────────────────────────────────────────
//
// Re-running the prompt after adding more notes is the intended way to work a set of Features up
// over several sittings. Silently discarding wording the PO typed by hand is not.

describe('BulkRewriteTab refine loop', () => {
  it('names the issues whose hand-edited wording a re-run replaced', async () => {
    const user = userEvent.setup();
    setAiAssistUnlocked(true);
    saveBatch({
      id: 'batch-refine',
      name: 'Refine',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [
        {
          jiraKey: 'ABC-1',
          original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
          proposed: { description: 'Description:\nmy own careful wording', acceptanceCriteria: 'ac', isEdited: true },
          state: 'reviewing',
          captureError: null,
          submitResult: null,
        },
        {
          jiraKey: 'ABC-2',
          original: { summary: 'S2', description: 'd2', acceptanceCriteria: 'a2', capturedAtIso: '2026-08-21T00:00:00.000Z' },
          proposed: { description: 'Description:\nuntouched', acceptanceCriteria: 'ac', isEdited: false },
          state: 'proposed',
          captureError: null,
          submitResult: null,
        },
      ],
    });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: /build the prompt/i }));

    const reply = JSON.stringify({
      kind: 'featureRewriteBatch',
      items: [
        { key: 'ABC-1', description: 'Description:\nfresh draft', acceptanceCriteria: 'ac' },
        { key: 'ABC-2', description: 'Description:\nfresh draft', acceptanceCriteria: 'ac' },
      ],
    });
    fireEvent.change(await screen.findByLabelText(/paste the assistant/i), { target: { value: reply } });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    const notice = await screen.findByText(/replaced wording you had edited by hand/);

    expect(notice).toHaveTextContent('ABC-1');
    // ABC-2 was never hand-edited, so replacing it is exactly what a re-run is for — no warning.
    expect(notice).not.toHaveTextContent('ABC-2');
  });

  it('says nothing about lost edits when a re-run replaced no hand-edited wording', async () => {
    const user = userEvent.setup();
    setAiAssistUnlocked(true);
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: 'd', customfield_10200: 'ac' } });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-9');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));
    await user.click(await screen.findByRole('button', { name: /build the prompt/i }));

    const reply = JSON.stringify({ kind: 'featureRewriteBatch', items: [{ key: 'ABC-9', description: 'Description:\nx', acceptanceCriteria: 'ac' }] });
    fireEvent.change(await screen.findByLabelText(/paste the assistant/i), { target: { value: reply } });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    await waitFor(() => expect(screen.getByText(/Applied 1 re-write/)).toBeInTheDocument());
    expect(screen.queryByText(/replaced wording you had edited by hand/)).not.toBeInTheDocument();
  });
});

// ── A folder of PDFs and saved emails (GH #376) ────────────────────────────
//
// The material a Feature is written from is often a folder of .msg files and a stack of PDFs. Adding
// them one at a time is how somebody stops bothering, and one bad file among thirty must not throw
// away the twenty-nine that read perfectly well.

describe('BulkRewriteTab file ingestion', () => {
  /** One captured batch, which is what puts Step 1 on screen. */
  function seedBatchForFiles(): void {
    saveBatch({
      id: 'batch-files',
      name: 'Files',
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

  /** Opens the seeded batch and hands back the file picker. */
  async function openBatchAndFindPicker(): Promise<HTMLElement> {
    const user = userEvent.setup();
    seedBatchForFiles();
    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    return screen.getByLabelText(/Files — PDFs, saved Outlook emails/);
  }

  it('takes a PDF and a saved email in one go', async () => {
    mockReadPdf.mockResolvedValue({ kind: 'pdf', id: 'pdf-1', fileName: 'spec.pdf', pageCount: 40, text: 'x' });
    mockReadMessage.mockResolvedValue({
      kind: 'email',
      id: 'email-1',
      fileName: 'runout.msg',
      subject: 'Runout ownership',
      senderName: 'Reynolds, Kevin',
      sentDate: 'Mon, 17 Aug 2026 14:02:11 -0400',
      text: 'y',
    });

    const picker = await openBatchAndFindPicker();
    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'spec.pdf'), new File(['b'], 'runout.msg')] },
    });

    const materialList = await screen.findByLabelText('Shared material');

    await waitFor(() => expect(materialList).toHaveTextContent('spec.pdf'));
    expect(materialList).toHaveTextContent('Runout ownership');
  });

  it('describes a PDF by its page count and an email by who sent it and when', async () => {
    // "Which of these did that figure come from?" is the question a PO asks of their own workspace.
    mockReadPdf.mockResolvedValue({ kind: 'pdf', id: 'pdf-1', fileName: 'spec.pdf', pageCount: 40, text: 'x' });
    mockReadMessage.mockResolvedValue({
      kind: 'email',
      id: 'email-1',
      fileName: 'runout.msg',
      subject: 'Runout ownership',
      senderName: 'Reynolds, Kevin',
      sentDate: 'Mon, 17 Aug 2026',
      text: 'y',
    });

    const picker = await openBatchAndFindPicker();
    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'spec.pdf'), new File(['b'], 'runout.msg')] },
    });

    const materialList = await screen.findByLabelText('Shared material');

    await waitFor(() => expect(materialList).toHaveTextContent('40 pages'));
    expect(materialList).toHaveTextContent('Email from Reynolds, Kevin, Mon, 17 Aug 2026');
  });

  it('keeps the files that read and NAMES the one that did not', async () => {
    // A single scan among thirty documents must not throw the other twenty-nine away, and "3 files
    // failed" sends somebody hunting — the file and the reason say whether it was a scan or a lock.
    mockReadPdf
      .mockRejectedValueOnce(new PdfReadError('"scan.pdf" has no text in it — it is almost certainly a scan.'))
      .mockResolvedValueOnce({ kind: 'pdf', id: 'pdf-1', fileName: 'good.pdf', pageCount: 2, text: 'x' });

    const picker = await openBatchAndFindPicker();
    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'scan.pdf'), new File(['b'], 'good.pdf')] },
    });

    const failures = await screen.findByLabelText('Files that could not be read');

    expect(failures).toHaveTextContent('scan.pdf');
    expect(failures).toHaveTextContent(/almost certainly a scan/);
    expect(await screen.findByLabelText('Shared material')).toHaveTextContent('good.pdf');
  });

  it('mints a distinct id for every file added in the same run', async () => {
    // Ids are minted against what has already been accepted in this run, before anything is saved —
    // otherwise two files chosen together would both be "pdf-1" and one would overwrite the other.
    mockReadPdf.mockImplementation(async (file: File, existing: readonly { id: string }[]) => ({
      kind: 'pdf',
      id: `pdf-${existing.length + 1}`,
      fileName: file.name,
      pageCount: 1,
      text: 'x',
    }));

    const picker = await openBatchAndFindPicker();
    fireEvent.change(picker, {
      target: { files: [new File(['a'], 'one.pdf'), new File(['b'], 'two.pdf')] },
    });

    const materialList = await screen.findByLabelText('Shared material');

    await waitFor(() => expect(materialList).toHaveTextContent('one.pdf'));
    expect(materialList).toHaveTextContent('two.pdf');
    expect(within(materialList).getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
  });
});

// ── A reply that parsed but carried nothing (GH #376) ──────────────────────

describe('BulkRewriteTab empty reply', () => {
  it('explains an empty item list instead of doing nothing at all', async () => {
    // The shape of a prompt cut short when pasted: the issues sit after the notes, so the assistant
    // read instructions about issues it never saw and answered about none of them. Saying nothing sent
    // somebody looking for a bug in their own reply.
    const user = userEvent.setup();
    setAiAssistUnlocked(true);
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: 'd', customfield_10200: 'ac' } });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));
    await user.click(await screen.findByRole('button', { name: /build the prompt/i }));

    fireEvent.change(await screen.findByLabelText(/paste the assistant/i), {
      target: { value: '{"kind":"featureRewriteBatch","items":[]}' },
    });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    expect(await screen.findByText(/contained no issues at all/)).toBeInTheDocument();
    expect(screen.getByText(/cut short when it was pasted/)).toBeInTheDocument();
  });

  it('says nothing about truncation when the reply simply rejected keys', async () => {
    // A reply that named the wrong issues is a different problem, and the existing message covers it.
    const user = userEvent.setup();
    setAiAssistUnlocked(true);
    mockJiraGet.mockResolvedValue({ fields: { summary: 'S', description: 'd', customfield_10200: 'ac' } });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.type(screen.getByLabelText('Jira keys'), 'ABC-1');
    await user.click(screen.getByRole('button', { name: /capture originals/i }));
    await user.click(await screen.findByRole('button', { name: /build the prompt/i }));

    fireEvent.change(await screen.findByLabelText(/paste the assistant/i), {
      target: { value: '{"kind":"featureRewriteBatch","items":[{"key":"OTHER-9","description":"x"}]}' },
    });
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    // Reported in both the panel error list and the ingest notice, which is deliberate.
    await waitFor(() => expect(screen.getAllByText(/not in this batch/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/contained no issues at all/)).not.toBeInTheDocument();
  });
});

// ── Approving here, and approving on the page (GH #376) ────────────────────

describe('BulkRewriteTab approving', () => {
  /** A batch with one item already approved in this tab. */
  function seedApprovedBatch(): void {
    saveBatch({
      id: 'batch-approve',
      name: 'Approve',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: { description: 'Description:\nnew', acceptanceCriteria: 'ac', isEdited: false },
        state: 'approved',
        captureError: null,
        submitResult: null,
      }],
    });
  }

  it('offers to write what is approved HERE, without needing a Confluence page', async () => {
    // The write used to read the page first and take its tick boxes as the truth, so an in-app
    // approval was downgraded to "reviewing" and the write then refused.
    const user = userEvent.setup();
    seedApprovedBatch();

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('button', { name: 'Write 1 approved to Jira' })).toBeEnabled();
  });

  it('counts the approvals in the button, so it is clear what will be written', async () => {
    const user = userEvent.setup();
    seedApprovedBatch();

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('button', { name: /Write 1 approved to Jira/ })).toBeInTheDocument();
  });

  it('refuses to write when nothing is approved, and says where to approve', async () => {
    const user = userEvent.setup();
    saveBatch({
      id: 'batch-none',
      name: 'None approved',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: { description: 'Description:\nnew', acceptanceCriteria: 'ac', isEdited: false },
        state: 'reviewing',
        captureError: null,
        submitResult: null,
      }],
    });

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('button', { name: /Write 0 approved to Jira/ })).toBeDisabled();
    expect(screen.getByText(/Mark items Approve in Step 4/)).toBeInTheDocument();
  });

  it('keeps pulling the page ticks as its own, separately named action', async () => {
    // Un-approving is a real thing that page wants to do; it must be something somebody asked for and
    // not a side effect of trying to submit.
    const user = userEvent.setup();
    seedApprovedBatch();

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('button', { name: 'Pull approvals from the page' })).toBeInTheDocument();
  });

  it('does not offer to pull approvals without a page to pull them from', async () => {
    const user = userEvent.setup();
    seedApprovedBatch();

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('button', { name: 'Pull approvals from the page' })).toBeDisabled();
  });
});

// ── The guided strip (GH #376) ─────────────────────────────────────────────

describe('BulkRewriteTab guided strip', () => {
  /** A batch whose items are in the given state. */
  function seedBatchInState(id: string, state: ItemStateForTest, hasProposal: boolean): void {
    saveBatch({
      id,
      name: 'Guided',
      teamProfileId: 'team-1',
      createdAtIso: '2026-08-21T00:00:00.000Z',
      updatedAtIso: '2026-08-21T00:00:00.000Z',
      items: [{
        jiraKey: 'ABC-1',
        original: { summary: 'S', description: 'd', acceptanceCriteria: 'a', capturedAtIso: '2026-08-21T00:00:00.000Z' },
        proposed: hasProposal ? { description: 'Description:\nx', acceptanceCriteria: 'ac', isEdited: false } : null,
        state,
        captureError: null,
        submitResult: null,
      }],
    });
  }

  it('names the one thing to do next, above everything else', async () => {
    // Five panels that all look equally ready to be pressed answer "what are the steps"; nobody was
    // asking that.
    const user = userEvent.setup();
    seedBatchInState('guided-1', 'captured', false);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByText(/Do this next:/)).toBeInTheDocument();
    expect(screen.getByText(/Add the notes these issues should be re-written from/)).toBeInTheDocument();
  });

  it('shows all five steps, so the shape of the run is never a surprise', async () => {
    const user = userEvent.setup();
    seedBatchInState('guided-2', 'captured', false);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    const strip = await screen.findByLabelText('Progress');

    ['Notes', 'Condense', 'Draft', 'Review', 'Send'].forEach((label) => {
      expect(strip).toHaveTextContent(label);
    });
  });

  it('marks exactly one step as the one you are on', async () => {
    const user = userEvent.setup();
    seedBatchInState('guided-3', 'proposed', true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    const strip = await screen.findByLabelText('Progress');
    const currentSteps = within(strip).getAllByRole('listitem').filter(
      (step) => step.getAttribute('aria-current') === 'step',
    );

    expect(currentSteps).toHaveLength(1);
    expect(currentSteps[0]).toHaveTextContent('Review');
  });

  it('moves the instruction on as the run progresses', async () => {
    const user = userEvent.setup();
    seedBatchInState('guided-4', 'approved', true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByText(/Write N approved to Jira/)).toBeInTheDocument();
  });

  it('says the run is finished rather than pointing at another step', async () => {
    const user = userEvent.setup();
    seedBatchInState('guided-5', 'submitted', true);

    render(<BulkRewriteTab dashboardTeamProfileId="team-1" />);
    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByText(/Finished\./)).toBeInTheDocument();
    expect(screen.queryByText(/Do this next:/)).not.toBeInTheDocument();
  });
});
