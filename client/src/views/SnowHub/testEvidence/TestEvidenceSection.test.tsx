// TestEvidenceSection.test.tsx — One action from "these issues" to "the evidence is on the change".

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockLoadReleaseAttachments, mockLoadReleaseAttachmentsByJql, mockDownloadAttachmentBytes,
  mockCreateZipArchive, mockAttachFileToChange, mockFetchFixVersions,
} = vi.hoisted(() => ({
  mockLoadReleaseAttachments: vi.fn(),
  mockLoadReleaseAttachmentsByJql: vi.fn(),
  mockDownloadAttachmentBytes: vi.fn(),
  mockCreateZipArchive: vi.fn(),
  mockAttachFileToChange: vi.fn(),
  mockFetchFixVersions: vi.fn(),
}));

vi.mock('./evidenceAttachmentFetch.ts', () => ({
  loadReleaseAttachments: mockLoadReleaseAttachments,
  loadReleaseAttachmentsByJql: mockLoadReleaseAttachmentsByJql,
  downloadAttachmentBytes: mockDownloadAttachmentBytes,
}));
vi.mock('./zipArchive.ts', () => ({ createZipArchive: mockCreateZipArchive }));
vi.mock('./snowAttachmentUpload.ts', () => ({ attachFileToChange: mockAttachFileToChange }));
vi.mock('../../ArtView/piPlan/piPlanReleaseSchedule.ts', () => ({ fetchPiWindowFixVersions: mockFetchFixVersions }));

import { TestEvidenceSection } from './TestEvidenceSection.tsx';
import { MAX_ATTACHABLE_BUNDLE_BYTES } from './evidenceBundle.ts';
import { TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY } from './testEvidenceScope.ts';
import type { ChangeRequest } from '../../../types/snow.ts';

/** Class names are irrelevant here; the host tab supplies its own. */
const STYLES = new Proxy({}, { get: (_target, key) => String(key) }) as Record<string, string>;
const ZIP_BYTES = new Uint8Array([80, 75, 3, 4]);

function change(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    sysId: 'change-sys-1',
    number: 'CHG0041298',
    shortDescription: 'Enrollment uplift',
    state: 'Scheduled',
    stateValue: '-2',
    assignedTo: null,
    plannedStartDate: '',
    plannedEndDate: '',
    risk: 'Moderate',
    impact: 'Medium',
    description: 'Deploys ENCUC-2213 and ENCUC-2358.',
    ...overrides,
  } as ChangeRequest;
}

function attachment(attachmentId: string, filename: string, sizeBytes = 1024) {
  return {
    attachmentId,
    filename,
    sizeBytes,
    authorName: 'Ramirez, Dana',
    contentUrl: `https://jira.example.com/secure/attachment/${attachmentId}/${filename}`,
  };
}

async function findAttachments(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Find attachments' }));
  await waitFor(() => expect(mockLoadReleaseAttachments).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockFetchFixVersions.mockResolvedValue([]);
  mockLoadReleaseAttachmentsByJql.mockResolvedValue({ issues: [], totalMatchingCount: 0, isTruncated: false });
  mockLoadReleaseAttachments.mockResolvedValue({ issues: [], missingKeys: [] });
  mockDownloadAttachmentBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockCreateZipArchive.mockReturnValue(ZIP_BYTES);
  mockAttachFileToChange.mockResolvedValue({ sysId: 'att-1', fileName: 'Test-Evidence_CHG0041298_2026-09-05.zip', sizeBytes: 4 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestEvidenceSection', () => {
  it('seeds the release scope from the keys the change itself names', () => {
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);

    const scopeField = screen.getByLabelText('Jira issues') as HTMLTextAreaElement;
    expect(scopeField.value).toBe('ENCUC-2213 ENCUC-2358');
  });

  it('refuses to scan with neither a fix version nor a key, and says so', async () => {
    render(<TestEvidenceSection loadedChange={change({ description: 'no keys here' })} styles={STYLES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Find attachments' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a fix version, or enter at least one Jira key.');
    expect(mockLoadReleaseAttachments).not.toHaveBeenCalled();
    expect(mockLoadReleaseAttachmentsByJql).not.toHaveBeenCalled();
  });

  it("starts from the CHG Generator's project and offers that project's fix versions as a dropdown", async () => {
    // GH #377: the change text named no keys, so the operator needs to pick the release — from
    // Jira's own list, never a typed value that would scan cleanly and find nothing.
    window.localStorage.setItem('ntbx-crg-state', JSON.stringify({ projectKey: 'encuc' }));
    mockFetchFixVersions.mockResolvedValue([
      { name: '2026.09.1' },
      { name: '2026.08.1', released: true },
      { name: '2026.01.1', archived: true },
    ]);
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);

    expect((screen.getByLabelText('Project key') as HTMLInputElement).value).toBe('ENCUC');
    await waitFor(() => expect(mockFetchFixVersions).toHaveBeenCalledWith('ENCUC'));
    const versionSelect = await screen.findByLabelText('Fix version') as HTMLSelectElement;
    await waitFor(() => expect(versionSelect).toBeEnabled());
    expect(Array.from(versionSelect.options).map((option) => option.textContent)).toEqual([
      'Select fix version…', '2026.09.1', '2026.08.1 (released)',
    ]);
  });

  it('remembers a typed project key and reloads the versions for it', async () => {
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);

    fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'denp' } });

    await waitFor(() => expect(mockFetchFixVersions).toHaveBeenCalledWith('DENP'));
    expect(window.localStorage.getItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY)).toBe('DENP');
  });

  it('scans the picked fix version and adds typed keys to it without counting one issue twice', async () => {
    window.localStorage.setItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY, 'ENCUC');
    mockFetchFixVersions.mockResolvedValue([{ name: '2026.09.1' }]);
    mockLoadReleaseAttachmentsByJql.mockResolvedValue({
      issues: [
        { key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'a.png')] },
        { key: 'ENCUC-3000', summary: 'Portal', attachments: [] },
      ],
      totalMatchingCount: 2,
      isTruncated: false,
    });
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [{ key: 'ENCUC-2358', summary: 'Extra', attachments: [attachment('2', 'b.png')] }],
      missingKeys: [],
    });
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);
    const versionSelect = await screen.findByLabelText('Fix version');
    await waitFor(() => expect(versionSelect).toBeEnabled());
    fireEvent.change(versionSelect, { target: { value: '2026.09.1' } });

    await findAttachments();

    expect(mockLoadReleaseAttachmentsByJql).toHaveBeenCalledWith('project = "ENCUC" AND fixVersion = "2026.09.1" ORDER BY key ASC');
    // ENCUC-2213 came back from the fix version, so only ENCUC-2358 is fetched by key.
    expect(mockLoadReleaseAttachments).toHaveBeenCalledWith(['ENCUC-2358']);
    expect(await screen.findByText('2 file(s) across 3 issue(s), 2.0 KB in total.')).toBeInTheDocument();
    expect(screen.getByText('No attachments on: ENCUC-3000.')).toBeInTheDocument();
  });

  it('names the release by its fix version in the manifest', async () => {
    window.localStorage.setItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY, 'ENCUC');
    mockFetchFixVersions.mockResolvedValue([{ name: '2026.09.1' }]);
    mockLoadReleaseAttachmentsByJql.mockResolvedValue({
      issues: [{ key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'a.png')] }],
      totalMatchingCount: 1,
      isTruncated: false,
    });
    render(<TestEvidenceSection loadedChange={change({ description: 'no keys' })} styles={STYLES} />);
    const versionSelect = await screen.findByLabelText('Fix version');
    await waitFor(() => expect(versionSelect).toBeEnabled());
    fireEvent.change(versionSelect, { target: { value: '2026.09.1' } });
    await findAttachments();

    fireEvent.click(await screen.findByRole('button', { name: 'Attach to CHG0041298' }));
    await waitFor(() => expect(mockAttachFileToChange).toHaveBeenCalledTimes(1));

    const zipEntries = mockCreateZipArchive.mock.calls[0][0] as Array<{ path: string; bytes: Uint8Array }>;
    expect(new TextDecoder().decode(zipEntries[1].bytes)).toContain('Test evidence for release 2026.09.1 (CHG0041298)');
  });

  it('says when a release was bigger than one scan holds', async () => {
    window.localStorage.setItem(TEST_EVIDENCE_PROJECT_KEY_STORAGE_KEY, 'ENCUC');
    mockFetchFixVersions.mockResolvedValue([{ name: '2026.09.1' }]);
    mockLoadReleaseAttachmentsByJql.mockResolvedValue({
      issues: [{ key: 'ENCUC-1', summary: 'One', attachments: [] }],
      totalMatchingCount: 900,
      isTruncated: true,
    });
    render(<TestEvidenceSection loadedChange={change({ description: 'no keys' })} styles={STYLES} />);
    const versionSelect = await screen.findByLabelText('Fix version');
    await waitFor(() => expect(versionSelect).toBeEnabled());
    fireEvent.change(versionSelect, { target: { value: '2026.09.1' } });

    await findAttachments();

    expect(await screen.findByText(/Only the first 1 of 900 issues in 2026\.09\.1 were read\./)).toBeInTheDocument();
  });

  it('does nothing to Jira or ServiceNow until asked', () => {
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);

    expect(mockLoadReleaseAttachments).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Attach to CHG0041298' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download zip' })).toBeDisabled();
  });

  it('lists every attachment it found, and says which issues brought nothing', async () => {
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [
        { key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'regression.pdf', 2048)] },
        { key: 'ENCUC-2358', summary: 'Portal', attachments: [] },
      ],
      missingKeys: ['ENCUC-9999'],
    });
    render(<TestEvidenceSection loadedChange={change({ description: 'ENCUC-2213 ENCUC-2358 ENCUC-9999' })} styles={STYLES} />);

    await findAttachments();

    expect(mockLoadReleaseAttachments).toHaveBeenCalledWith(['ENCUC-2213', 'ENCUC-2358', 'ENCUC-9999']);
    expect(await screen.findByText('regression.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('1 file(s) across 2 issue(s), 2.0 KB in total.')).toBeInTheDocument();
    expect(screen.getByText('No attachments on: ENCUC-2358.')).toBeInTheDocument();
    expect(screen.getByText('Not found in Jira: ENCUC-9999.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach to CHG0041298' })).toBeEnabled();
  });

  it('downloads every file, zips it with the manifest, and attaches the zip to the loaded change', async () => {
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [{ key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'a.png'), attachment('2', 'b.png')] }],
      missingKeys: [],
    });
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);
    await findAttachments();

    fireEvent.click(await screen.findByRole('button', { name: 'Attach to CHG0041298' }));

    await waitFor(() => expect(mockAttachFileToChange).toHaveBeenCalledTimes(1));
    expect(mockDownloadAttachmentBytes).toHaveBeenCalledWith('https://jira.example.com/secure/attachment/1/a.png');
    expect(mockDownloadAttachmentBytes).toHaveBeenCalledWith('https://jira.example.com/secure/attachment/2/b.png');
    const zipEntries = mockCreateZipArchive.mock.calls[0][0] as Array<{ path: string; bytes: Uint8Array }>;
    expect(zipEntries.map((entry) => entry.path)).toEqual(['ENCUC-2213/a.png', 'ENCUC-2213/b.png', 'MANIFEST.txt']);
    expect(new TextDecoder().decode(zipEntries[2].bytes)).toContain('Test evidence for release Enrollment uplift (CHG0041298)');
    const [changeSysId, archiveName, archiveBytes] = mockAttachFileToChange.mock.calls[0];
    expect(changeSysId).toBe('change-sys-1');
    expect(archiveName).toMatch(/^Test-Evidence_CHG0041298_\d{4}-\d{2}-\d{2}\.zip$/);
    expect(archiveBytes).toBe(ZIP_BYTES);
    expect(await screen.findByText(/Attached Test-Evidence_CHG0041298_2026-09-05\.zip \(4 B\) to CHG0041298\./)).toBeInTheDocument();
  });

  it('offers the same zip as a download without rebuilding it', async () => {
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [{ key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'a.png')] }],
      missingKeys: [],
    });
    const createObjectUrl = vi.fn().mockReturnValue('blob:evidence');
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl }));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);
    await findAttachments();

    fireEvent.click(await screen.findByRole('button', { name: 'Download zip' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Downloaded Test-Evidence_CHG0041298_.*\.zip \(4 B\)\./)).toBeInTheDocument();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:evidence');

    fireEvent.click(screen.getByRole('button', { name: 'Attach to CHG0041298' }));
    await waitFor(() => expect(mockAttachFileToChange).toHaveBeenCalledTimes(1));

    // Built once, downloaded once: the second action reused the archive the first one built.
    expect(mockCreateZipArchive).toHaveBeenCalledTimes(1);
    expect(mockDownloadAttachmentBytes).toHaveBeenCalledTimes(1);
  });

  it('refuses to attach a bundle the relay cannot carry, but still lets it be downloaded', async () => {
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [{ key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'huge.mp4', MAX_ATTACHABLE_BUNDLE_BYTES + 1)] }],
      missingKeys: [],
    });
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);

    await findAttachments();

    expect(await screen.findByText(/over the 75\.0 MB the relay can attach/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach to CHG0041298' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download zip' })).toBeEnabled();
  });

  it('says why an attach failed rather than reporting nothing', async () => {
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [{ key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'a.png')] }],
      missingKeys: [],
    });
    mockAttachFileToChange.mockRejectedValue(new Error('SNow relay fetch failed: 403'));
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);
    await findAttachments();

    fireEvent.click(await screen.findByRole('button', { name: 'Attach to CHG0041298' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('SNow relay fetch failed: 403');
    expect(screen.getByRole('button', { name: 'Attach to CHG0041298' })).toBeEnabled();
  });

  it('a new scan throws away a zip built from the old one', async () => {
    mockLoadReleaseAttachments.mockResolvedValue({
      issues: [{ key: 'ENCUC-2213', summary: 'Feed', attachments: [attachment('1', 'a.png')] }],
      missingKeys: [],
    });
    render(<TestEvidenceSection loadedChange={change()} styles={STYLES} />);
    await findAttachments();
    fireEvent.click(await screen.findByRole('button', { name: 'Attach to CHG0041298' }));
    await waitFor(() => expect(mockAttachFileToChange).toHaveBeenCalledTimes(1));

    await findAttachments();
    fireEvent.click(await screen.findByRole('button', { name: 'Attach to CHG0041298' }));
    await waitFor(() => expect(mockAttachFileToChange).toHaveBeenCalledTimes(2));

    expect(mockCreateZipArchive).toHaveBeenCalledTimes(2);
  });
});
