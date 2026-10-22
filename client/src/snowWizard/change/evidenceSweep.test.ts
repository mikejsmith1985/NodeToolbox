// evidenceSweep.test.ts — Proves the sweep searches the issues, their sub-tasks and linked issues, zips what it finds,
// attaches it, and reports every number — falling back when linked issues cannot be searched.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadReleaseAttachmentsByJql } from '../../views/SnowHub/testEvidence/evidenceAttachmentFetch.ts';
import { attachAllEvidenceToChanges } from './evidenceUpload.ts';
import { buildEvidenceSweepJql, describeFilesByIssue, listAttachedChanges, runEvidenceSweep } from './evidenceSweep.ts';

vi.mock('../../views/SnowHub/testEvidence/evidenceAttachmentFetch.ts', () => ({ loadReleaseAttachmentsByJql: vi.fn() }));
vi.mock('./evidenceUpload.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./evidenceUpload.ts')>()),
  attachAllEvidenceToChanges: vi.fn(),
}));

function buildIssue(key: string, fileNames: string[]) {
  return {
    key, summary: `Story ${key}`,
    attachments: fileNames.map((filename, fileIndex) => ({ attachmentId: `${key}-${fileIndex}`, filename, sizeBytes: 100, contentUrl: `/f/${filename}` })),
  };
}

describe('buildEvidenceSweepJql', () => {
  it('reaches the issues, their sub-tasks and every linked issue', () => {
    expect(buildEvidenceSweepJql(['ABC-1', 'ABC-2'], true)).toBe(
      'key in ("ABC-1","ABC-2") OR parent in ("ABC-1","ABC-2") OR issue in linkedIssues("ABC-1") OR issue in linkedIssues("ABC-2")');
    expect(buildEvidenceSweepJql(['ABC-1'], false)).toBe('key in ("ABC-1") OR parent in ("ABC-1")');
  });
});

describe('runEvidenceSweep', () => {
  beforeEach(() => {
    vi.mocked(loadReleaseAttachmentsByJql).mockReset();
    vi.mocked(attachAllEvidenceToChanges).mockReset();
  });

  it('finds the files on a sub-task, zips them and reports the zip attached', async () => {
    vi.mocked(loadReleaseAttachmentsByJql).mockResolvedValue({ issues: [buildIssue('ABC-1', []), buildIssue('ABC-5', ['run.xlsx', 'shot.png'])], totalMatchingCount: 2, isTruncated: false });
    vi.mocked(attachAllEvidenceToChanges).mockResolvedValue({
      results: { CHG1: 'attached' }, problems: [], zippedFileCount: 2, archiveByteSize: 2048, attachedFileNames: { CHG1: 'Test-Evidence_CHG1_2026-10-22.zip' },
    });
    const report = await runEvidenceSweep(['ABC-1'], ['CHG1']);
    expect(report.sweptIssueKeys).toEqual(['ABC-1', 'ABC-5']);
    expect(describeFilesByIssue(report)).toEqual(['ABC-5: run.xlsx, shot.png']);
    expect(report).toMatchObject({ zippedFileCount: 2, archiveByteSize: 2048, wereLinksSkipped: false });
    expect(listAttachedChanges(report)).toEqual(['CHG1']);
  });

  it('falls back to the issues and sub-tasks when Jira cannot search linked issues', async () => {
    vi.mocked(loadReleaseAttachmentsByJql).mockRejectedValueOnce(new Error('400')).mockResolvedValueOnce({ issues: [buildIssue('ABC-1', [])], totalMatchingCount: 1, isTruncated: false });
    const report = await runEvidenceSweep(['ABC-1'], ['CHG1']);
    expect(report.wereLinksSkipped).toBe(true);
    expect(report.foundFiles).toEqual([]);
    expect(attachAllEvidenceToChanges).not.toHaveBeenCalled();
  });

  it('asks Jira nothing when the change names no issues', async () => {
    const report = await runEvidenceSweep([], ['CHG1']);
    expect(report.sweptIssueKeys).toEqual([]);
    expect(loadReleaseAttachmentsByJql).not.toHaveBeenCalled();
  });
});
