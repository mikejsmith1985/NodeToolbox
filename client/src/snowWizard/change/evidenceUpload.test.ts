// evidenceUpload.test.ts — Proves evidence is refused up front when too big, and attached to every change once they exist.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { attachFileToChange } from '../../views/SnowHub/testEvidence/snowAttachmentUpload.ts';
import { createZipArchive } from '../../views/SnowHub/testEvidence/zipArchive.ts';
import { attachAllEvidenceToChanges, attachEvidenceToChanges, checkEvidenceSize } from './evidenceUpload.ts';
import { downloadJiraEvidence, type JiraEvidenceAttachment } from './jiraEvidence.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../views/SnowHub/testEvidence/snowAttachmentUpload.ts', () => ({ attachFileToChange: vi.fn() }));
vi.mock('../../views/SnowHub/testEvidence/zipArchive.ts', () => ({ createZipArchive: vi.fn(() => new Uint8Array([1, 2, 3])) }));
vi.mock('./jiraEvidence.ts', async (importOriginal) => ({ ...await importOriginal<object>(), downloadJiraEvidence: vi.fn() }));

const MEGABYTE = 1024 * 1024;
const NOW = new Date('2026-10-20T00:00:00Z');

function buildEvidence(issueKey: string, attachmentId: string, filename: string, sizeBytes = 10): JiraEvidenceAttachment {
  return { issueKey, issueSummary: `Story ${issueKey}`, attachment: { attachmentId, filename, sizeBytes, contentUrl: `https://jira/secure/attachment/${attachmentId}/${filename}` } };
}

/** A file-like value with just what the uploader reads. */
function buildFile(fileName: string, sizeBytes: number): File {
  return { name: fileName, size: sizeBytes, arrayBuffer: async () => new ArrayBuffer(sizeBytes) } as unknown as File;
}

describe('checkEvidenceSize', () => {
  it('refuses files that add up past ServiceNow\'s limit, stating the limit', () => {
    expect(checkEvidenceSize([buildFile('huge.zip', 80 * 1024 * 1024)])).toMatch(/80\.0 MB.*75\.0 MB/);
  });

  it('accepts files within the limit', () => {
    expect(checkEvidenceSize([buildFile('small.pdf', 1024)])).toBeNull();
  });

  it('counts the ticked Jira files too', () => {
    expect(checkEvidenceSize([buildFile('small.pdf', 10 * MEGABYTE)], 70 * MEGABYTE)).toMatch(/80\.0 MB/);
  });
});

describe('attachEvidenceToChanges', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
    vi.mocked(attachFileToChange).mockReset();
  });

  it('bundles the files once and attaches the bundle to each change, reporting each result', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: [{ sys_id: 'sys-1' }] } as never)
      .mockResolvedValueOnce({ result: [] } as never);
    vi.mocked(attachFileToChange).mockResolvedValue({ sysId: 'att', fileName: 'x.zip', sizeBytes: 3 });

    const results = await attachEvidenceToChanges([buildFile('results.pdf', 10)], ['CHG1', 'CHG2'], new Date('2026-10-20T00:00:00Z'));

    expect(attachFileToChange).toHaveBeenCalledWith('sys-1', 'Test-Evidence_CHG1_2026-10-20.zip', new Uint8Array([1, 2, 3]));
    expect(results).toEqual({ CHG1: 'attached', CHG2: 'ServiceNow has no change CHG2.' });
  });

  it('attaches nothing when no file was chosen', async () => {
    expect(await attachEvidenceToChanges([], ['CHG1'])).toEqual({});
    expect(snowFetch).not.toHaveBeenCalled();
  });
});

describe('attachAllEvidenceToChanges', () => {
  beforeEach(() => {
    vi.mocked(snowFetch).mockReset();
    vi.mocked(attachFileToChange).mockReset();
    vi.mocked(createZipArchive).mockClear();
    vi.mocked(downloadJiraEvidence).mockReset();
  });

  it('zips the Jira files under their issue with a manifest, like Toolbox, beside the chosen local files', async () => {
    const report = buildEvidence('ENCUC-9', '1', 'report.pdf');
    vi.mocked(downloadJiraEvidence).mockResolvedValue({ downloaded: [{ evidence: report, bytes: new Uint8Array([9]) }], problems: [] });
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ sys_id: 'sys-1' }] } as never);
    vi.mocked(attachFileToChange).mockResolvedValue({ sysId: 'att', fileName: 'x.zip', sizeBytes: 3 });

    const outcome = await attachAllEvidenceToChanges({ localFiles: [buildFile('notes.txt', 4)], jiraAttachments: [report] }, ['CHG1'], { now: NOW });

    const zipEntries = vi.mocked(createZipArchive).mock.calls[0][0];
    expect(zipEntries.map((entry) => entry.path)).toEqual(['notes.txt', 'ENCUC-9/report.pdf', 'MANIFEST.txt']);
    expect(zipEntries[1].bytes).toEqual(new Uint8Array([9]));
    expect(new TextDecoder().decode(zipEntries[2].bytes)).toContain('ENCUC-9 — Story ENCUC-9');
    expect(attachFileToChange).toHaveBeenCalledWith('sys-1', 'Test-Evidence_CHG1_2026-10-20.zip', new Uint8Array([1, 2, 3]));
    expect(outcome).toMatchObject({ results: { CHG1: 'attached' }, problems: [], zippedFileCount: 2, attachedFileNames: { CHG1: 'x.zip' } });
  });

  it('still attaches the other files when one Jira download fails, and says which one was left out', async () => {
    const good = buildEvidence('A-1', '1', 'good.pdf');
    vi.mocked(downloadJiraEvidence).mockResolvedValue({ downloaded: [{ evidence: good, bytes: new Uint8Array([1]) }], problems: ['Could not get bad.pdf'] });
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ sys_id: 'sys-1' }] } as never);
    vi.mocked(attachFileToChange).mockResolvedValue({ sysId: 'att', fileName: 'x.zip', sizeBytes: 3 });

    const outcome = await attachAllEvidenceToChanges({ localFiles: [], jiraAttachments: [good, buildEvidence('A-1', '2', 'bad.pdf')] }, ['CHG1'], { now: NOW });

    expect(outcome).toMatchObject({ results: { CHG1: 'attached' }, problems: ['Could not get bad.pdf'] });
  });

  it('attaches nothing, saying why, when no Jira file could be fetched and no local file was chosen', async () => {
    vi.mocked(downloadJiraEvidence).mockResolvedValue({ downloaded: [], problems: ['Could not get a.pdf'] });

    const outcome = await attachAllEvidenceToChanges({ localFiles: [], jiraAttachments: [buildEvidence('A-1', '1', 'a.pdf')] }, ['CHG1', 'CHG2'], { now: NOW });

    expect(attachFileToChange).not.toHaveBeenCalled();
    expect(outcome.results.CHG1).toMatch(/could not be fetched from Jira/);
    expect(outcome.results.CHG2).toMatch(/could not be fetched from Jira/);
  });

  it('refuses a set too big for ServiceNow before downloading anything', async () => {
    const outcome = await attachAllEvidenceToChanges(
      { localFiles: [], jiraAttachments: [buildEvidence('A-1', '1', 'video.mp4', 90 * MEGABYTE)] }, ['CHG1'], { now: NOW });

    expect(downloadJiraEvidence).not.toHaveBeenCalled();
    expect(outcome.results.CHG1).toMatch(/at most 75\.0 MB/);
  });

  it('reports each step as it goes', async () => {
    vi.mocked(downloadJiraEvidence).mockResolvedValue({ downloaded: [], problems: [] });
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ sys_id: 'sys-1' }] } as never);
    vi.mocked(attachFileToChange).mockResolvedValue({ sysId: 'att', fileName: 'x.zip', sizeBytes: 3 });
    const onProgress = vi.fn();

    await attachAllEvidenceToChanges({ localFiles: [buildFile('a.pdf', 1)], jiraAttachments: [] }, ['CHG1'], { now: NOW, onProgress });

    expect(onProgress).toHaveBeenCalledWith('Putting the evidence on CHG1…');
  });
});
