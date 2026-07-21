// FeatureCompositionTab.test.tsx — Proves all four source types land in one workspace, that Confluence
// failures are told apart, and that enriching an existing Feature never creates a duplicate
// (quickstart Scenarios F, G, H — SC-012, SC-017, SC-018).

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as xlsx from 'xlsx';

const {
  mockJiraGet,
  mockCreateIssue,
  mockCreateIssueLink,
  mockGetProjectIssueTypes,
  mockGetIssueTypeFields,
  mockSaveSimpleField,
  mockFetchConfluencePageByReference,
  mockResolveConfluencePageId,
  mockShowToast,
} = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockCreateIssue: vi.fn(),
  mockCreateIssueLink: vi.fn(),
  mockGetProjectIssueTypes: vi.fn(),
  mockGetIssueTypeFields: vi.fn(),
  mockSaveSimpleField: vi.fn(),
  mockFetchConfluencePageByReference: vi.fn(),
  mockResolveConfluencePageId: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  createIssue: mockCreateIssue,
  // runCommit imports this at module level for its default dependencies.
  createIssueLink: mockCreateIssueLink,
  getProjectIssueTypes: mockGetProjectIssueTypes,
  getIssueTypeFields: mockGetIssueTypeFields,
}));

vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: mockSaveSimpleField,
}));

vi.mock('../../services/confluenceApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/confluenceApi.ts')>();
  return {
    ConfluenceRequestError: actual.ConfluenceRequestError,
    fetchConfluencePageByReference: mockFetchConfluencePageByReference,
    resolveConfluencePageIdFromReference: mockResolveConfluencePageId,
  };
});

vi.mock('../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

import { ConfluenceRequestError } from '../../services/confluenceApi.ts';
import FeatureCompositionTab from './FeatureCompositionTab';

/** Every call that would WRITE to Jira. */
function countJiraWrites(): number {
  return mockCreateIssue.mock.calls.length + mockSaveSimpleField.mock.calls.length;
}

function buildWorkbookFile(): File {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([{ Region: 'North', Claims: '3000' }]), 'Summary');
  const bytes = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'volumes.xlsx');
}

function renderTab() {
  return render(<FeatureCompositionTab dashboardTeamProfileId="profile-alpha" defaultProjectKey="ABC" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockJiraGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/rest/api/2/field')) {
      return [{ id: 'customfield_10200', name: 'Acceptance Criteria' }];
    }
    if (path.includes('/issue/ABC-9')) {
      return { key: 'ABC-9', fields: { summary: 'Document storage spike', status: { name: 'Done' } } };
    }
    if (path.includes('/issue/ABC-7')) {
      return { key: 'ABC-7', fields: { summary: 'Stub from last week', description: 'Thin.' } };
    }
    throw new Error(`Unexpected read: ${path}`);
  });
  mockGetProjectIssueTypes.mockResolvedValue({ values: [{ id: '10001', name: 'Feature', subtask: false }] });
  mockGetIssueTypeFields.mockResolvedValue({
    values: [
      { fieldId: 'summary', name: 'Summary', required: true },
      { fieldId: 'customfield_10200', name: 'Acceptance Criteria', required: false },
    ],
  });
  mockCreateIssue.mockResolvedValue({ id: '9', key: 'ABC-100', self: '' });
  mockSaveSimpleField.mockResolvedValue(undefined);
  mockResolveConfluencePageId.mockReturnValue('12345');
  mockFetchConfluencePageByReference.mockResolvedValue({
    id: '12345',
    title: 'Claims brief',
    version: { number: 2 },
    body: { storage: { value: '<p>Claimants cannot attach documents.</p>' } },
  });
});

describe('FeatureCompositionTab — coaching (SC-005, SC-013)', () => {
  it('shows the Definition of Ready with nothing loaded and no AI unlocked', () => {
    renderTab();

    expect(screen.getByText(/what "ready" looks like/i)).toBeInTheDocument();
    expect(screen.getByText('The problem is stated, not the solution')).toBeInTheDocument();
  });

  it('renders no AI control, because the gate is locked', () => {
    renderTab();

    expect(screen.queryByText(/\bAI\b/)).toBeNull();
  });
});

describe('FeatureCompositionTab — all four source types in one place (SC-017)', () => {
  it('adds a Confluence page by URL, as readable text', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/confluence page url/i), 'https://wiki/pages/12345/Brief');
    await userEvent.click(screen.getByRole('button', { name: /add page/i }));

    const sources = await screen.findByLabelText('Referenced sources');
    expect(within(sources).getByText('Claims brief')).toBeInTheDocument();
    expect(within(sources).getByText('Claimants cannot attach documents.')).toBeInTheDocument();
  });

  it('adds an uploaded spreadsheet', async () => {
    renderTab();

    await userEvent.upload(screen.getByLabelText('Spreadsheet file'), buildWorkbookFile());

    const sources = await screen.findByLabelText('Referenced sources');
    // The file name is both the title and the origin for a single-sheet file, hence getAllByText.
    expect(within(sources).getAllByText('volumes.xlsx').length).toBeGreaterThan(0);
    expect(within(sources).getByText(/Region: North/)).toBeInTheDocument();
  });

  it('adds a related Jira issue', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/related jira issue/i), 'ABC-9');
    await userEvent.click(screen.getByRole('button', { name: /add issue/i }));

    const sources = await screen.findByLabelText('Referenced sources');
    expect(within(sources).getByText(/ABC-9 — Document storage spike/)).toBeInTheDocument();
  });

  it('adds a pasted note', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/paste anything else/i), 'Teams thread');
    await userEvent.type(screen.getByLabelText('Pasted content'), 'Jana confirmed the SLA.');
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));

    const sources = await screen.findByLabelText('Referenced sources');
    expect(within(sources).getByText('Teams thread')).toBeInTheDocument();
  });

  it('shows where every source came from (FR-024)', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/confluence page url/i), 'https://wiki/pages/12345/Brief');
    await userEvent.click(screen.getByRole('button', { name: /add page/i }));

    const sources = await screen.findByLabelText('Referenced sources');
    expect(within(sources).getByText('https://wiki/pages/12345/Brief')).toBeInTheDocument();
  });

  it('lets the PO remove a source', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText(/related jira issue/i), 'ABC-9');
    await userEvent.click(screen.getByRole('button', { name: /add issue/i }));
    await screen.findByText(/ABC-9 — Document storage spike/);

    await userEvent.click(within(screen.getByLabelText('Referenced sources')).getByRole('button', { name: /remove/i }));

    expect(screen.queryByText(/ABC-9 — Document storage spike/)).toBeNull();
  });

  it('gathers sources without writing anything to Jira', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/confluence page url/i), 'https://wiki/pages/12345/Brief');
    await userEvent.click(screen.getByRole('button', { name: /add page/i }));
    await screen.findByText('Claims brief');

    expect(countJiraWrites()).toBe(0);
  });
});

describe('FeatureCompositionTab — Confluence failures are told apart (SC-018, Scenario G)', () => {
  async function addPageExpectingFailure(error: unknown): Promise<void> {
    mockFetchConfluencePageByReference.mockRejectedValue(error);
    renderTab();
    await userEvent.type(screen.getByLabelText(/confluence page url/i), 'https://wiki/pages/12345/Brief');
    await userEvent.click(screen.getByRole('button', { name: /add page/i }));
  }

  it('says a missing page is missing', async () => {
    await addPageExpectingFailure(new ConfluenceRequestError('failed', 404));

    expect(await screen.findByText(/does not exist/i)).toBeInTheDocument();
  });

  it('says a forbidden page is a permission problem, not a missing one', async () => {
    await addPageExpectingFailure(new ConfluenceRequestError('failed', 403));

    expect(await screen.findByText(/cannot see it/i)).toBeInTheDocument();
  });

  it('names the VPN when Confluence is unreachable', async () => {
    await addPageExpectingFailure(new ConfluenceRequestError('failed', 502, 'Proxy error'));

    expect(await screen.findByText(/VPN/i)).toBeInTheDocument();
  });

  it('says Confluence is not set up, rather than blaming the connection', async () => {
    await addPageExpectingFailure(new ConfluenceRequestError('failed', 502, 'Confluence not configured'));

    expect(await screen.findByText(/not set up/i)).toBeInTheDocument();
  });

  it('leaves the draft untouched when a page cannot be added', async () => {
    await addPageExpectingFailure(new ConfluenceRequestError('failed', 404));
    await screen.findByText(/does not exist/i);

    expect(screen.queryByLabelText('Referenced sources')?.children.length ?? 0).toBe(0);
  });

  it('rejects a renamed PDF rather than filling the workspace with nonsense', async () => {
    renderTab();
    const renamedPdf = new File([new TextEncoder().encode('%PDF-1.4\nbinary junk')], 'volumes.xlsx');

    await userEvent.upload(screen.getByLabelText('Spreadsheet file'), renamedPdf);

    expect(await screen.findByText(/named like a spreadsheet/i)).toBeInTheDocument();
  });
});

describe('FeatureCompositionTab — create vs update (Scenario H, SC-012)', () => {
  it('creates a new Feature in the chosen project when there is no Jira key', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText('Summary'), 'Claimant document submission');
    await waitFor(() => expect(screen.getByLabelText(/issue type/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/issue type/i), '10001');

    await userEvent.click(screen.getByRole('button', { name: /create feature in jira/i }));

    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalledTimes(1));
    expect(mockCreateIssue).toHaveBeenCalledWith({
      fields: expect.objectContaining({
        project: { key: 'ABC' },
        issuetype: { id: '10001' },
        summary: 'Claimant document submission',
      }),
    });
  });

  it('UPDATES an existing Feature and never creates a duplicate', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/enrich an existing feature/i), 'ABC-7');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(screen.getByDisplayValue('Stub from last week')).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText('Summary'));
    await userEvent.type(screen.getByLabelText('Summary'), 'Claimant document submission');
    await userEvent.click(screen.getByRole('button', { name: /save changes to ABC-7/i }));

    await waitFor(() => expect(mockSaveSimpleField).toHaveBeenCalled());
    expect(mockSaveSimpleField).toHaveBeenCalledWith('ABC-7', 'summary', 'Claimant document submission');
    // The whole point: no second Feature.
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it('strips rendered HTML from a loaded description so the PO edits clean prose, not markup', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/rest/api/2/field')) {
        return [{ id: 'customfield_10200', name: 'Acceptance Criteria' }];
      }
      if (path.includes('/issue/ABC-7')) {
        return {
          key: 'ABC-7',
          fields: {
            summary: 'Stub from last week',
            description: '<p data-renderer-start-pos="826"><b>Description</b> Migrate &quot;HPlan&quot; &amp; Facets.</p>',
          },
        };
      }
      throw new Error(`Unexpected read: ${path}`);
    });
    renderTab();

    await userEvent.type(screen.getByLabelText(/enrich an existing feature/i), 'ABC-7');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));

    const descriptionField = await screen.findByLabelText('Description');
    await waitFor(() => expect(descriptionField).toHaveValue('Description Migrate "HPlan" & Facets.'));
    expect((descriptionField as HTMLTextAreaElement).value).not.toContain('<');
  });

  it('does not rewrite an untouched (HTML) description on save, so Jira keeps its formatting', async () => {
    mockJiraGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/rest/api/2/field')) {
        return [{ id: 'customfield_10200', name: 'Acceptance Criteria' }];
      }
      if (path.includes('/issue/ABC-7')) {
        return {
          key: 'ABC-7',
          fields: {
            summary: 'Stub from last week',
            description: '<ol><li><b>Problem</b><p>Members enrolled in the H Contract need migration.</p></li></ol>',
          },
        };
      }
      throw new Error(`Unexpected read: ${path}`);
    });
    renderTab();

    await userEvent.type(screen.getByLabelText(/enrich an existing feature/i), 'ABC-7');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(screen.getByDisplayValue('Stub from last week')).toBeInTheDocument());

    // Change ONLY the summary; the loaded description is left exactly as it came back.
    await userEvent.clear(screen.getByLabelText('Summary'));
    await userEvent.type(screen.getByLabelText('Summary'), 'Renamed feature');
    await userEvent.click(screen.getByRole('button', { name: /save changes to ABC-7/i }));

    await waitFor(() => expect(mockSaveSimpleField).toHaveBeenCalledWith('ABC-7', 'summary', 'Renamed feature'));
    // The untouched description must NOT be written back — that write would flatten Jira's formatting.
    expect(mockSaveSimpleField).not.toHaveBeenCalledWith('ABC-7', 'description', expect.anything());
  });

  it('says plainly which Feature it is editing, so the PO is never surprised', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText(/enrich an existing feature/i), 'ABC-7');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));

    expect(await screen.findByText(/will not create a second one/i)).toBeInTheDocument();
  });

  it('blocks a create when Jira requires a field the draft lacks, naming it (FR-034)', async () => {
    mockGetIssueTypeFields.mockResolvedValue({
      values: [
        { fieldId: 'summary', name: 'Summary', required: true },
        { fieldId: 'customfield_50001', name: 'Business Value', required: true },
      ],
    });
    renderTab();
    await userEvent.type(screen.getByLabelText('Summary'), 'A Feature');
    await waitFor(() => expect(screen.getByLabelText(/issue type/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/issue type/i), '10001');

    expect(await within(await screen.findByLabelText('Blockers')).findByText(/Business Value/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create feature in jira/i })).toBeDisabled();
    expect(countJiraWrites()).toBe(0);
  });
});

describe('FeatureCompositionTab — the readiness checklist is advisory (FR-029)', () => {
  it('grades the draft against the team\'s own rules as it is typed', async () => {
    renderTab();

    await userEvent.type(screen.getByLabelText('Description'), 'Some description with no summary yet.');

    const checklist = await screen.findByLabelText('Readiness checklist');
    expect(within(checklist).getByText(/summary/i)).toBeInTheDocument();
  });

  it('NEVER blocks the commit — only Jira\'s own required fields do that', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText('Summary'), 'A Feature with no acceptance criteria');
    await waitFor(() => expect(screen.getByLabelText(/issue type/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/issue type/i), '10001');

    // Hygiene will have something to say, but the button stays live.
    expect(screen.getByRole('button', { name: /create feature in jira/i })).toBeEnabled();
  });
});

describe('FeatureCompositionTab — drafts (FR-042, FR-047)', () => {
  it('warns when the browser will not keep drafts', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    renderTab();

    expect(screen.getByText(/your work will be lost if you reload/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('lets the PO throw a draft away', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText('Summary'), 'Something');

    await userEvent.click(screen.getByRole('button', { name: /discard draft/i }));

    expect(screen.getByLabelText('Summary')).toHaveValue('');
    expect(mockShowToast).toHaveBeenCalledWith('Composition draft discarded.', 'success');
  });
});

// ── Accessibility and large artifacts (T061) ──

describe('FeatureCompositionTab — reachable without a mouse', () => {
  it('opens the file picker from the keyboard, so the dropzone is not mouse-only', async () => {
    renderTab();
    const dropzone = screen.getByRole('button', { name: /add a spreadsheet/i });

    // The dropzone is a div; without an explicit key handler it would be unreachable by keyboard.
    dropzone.focus();
    expect(dropzone).toHaveFocus();
    expect(dropzone).toHaveAttribute('tabindex', '0');
  });

  it('labels every input, so a screen reader announces what each box is for', () => {
    renderTab();

    expect(screen.getByLabelText('Summary')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText(/acceptance criteria/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your own words/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confluence page url/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Pasted content')).toBeInTheDocument();
  });

  it('names its lists, so they are navigable rather than anonymous', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText(/paste anything else/i), 'A note');
    await userEvent.type(screen.getByLabelText('Pasted content'), 'text');
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));

    expect(await screen.findByLabelText('Referenced sources')).toBeInTheDocument();
  });
});

describe('FeatureCompositionTab — a very large artifact (spec edge case)', () => {
  it('accepts a long pasted page without freezing, and still shows the draft', async () => {
    renderTab();
    const longPage = 'Claimants cannot attach documents. '.repeat(2000);

    await userEvent.type(screen.getByLabelText(/paste anything else/i), 'Long brief');
    // paste rather than type: typing 70k characters would take minutes and prove nothing.
    await userEvent.click(screen.getByLabelText('Pasted content'));
    await userEvent.paste(longPage);
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));

    expect(await screen.findByLabelText('Referenced sources')).toBeInTheDocument();
    expect(screen.getByLabelText('Summary')).toBeInTheDocument();
  });

  it('summarises a huge spreadsheet rather than listing every row at the PO', async () => {
    const workbook = xlsx.utils.book_new();
    const manyRows = Array.from({ length: 500 }, (_, rowIndex) => ({ Claim: `C-${rowIndex + 1}` }));
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(manyRows), 'Claims');
    const bytes = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    renderTab();
    await userEvent.upload(screen.getByLabelText('Spreadsheet file'), new File([bytes], 'big.xlsx'));

    const sources = await screen.findByLabelText('Referenced sources');
    // Says what it left out rather than truncating silently.
    expect(within(sources).getByText(/and 450 more rows/)).toBeInTheDocument();
  });
});
