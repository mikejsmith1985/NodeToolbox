// jiraEvidence.test.ts — Proves the change's Jira issues are read for their files, ticked like Toolbox (everything that fits), and downloaded one by one without one failure stopping the rest.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAttachmentBytes, loadReleaseAttachments } from '../../views/SnowHub/testEvidence/evidenceAttachmentFetch.ts';
import type { EvidenceAttachment } from '../../views/SnowHub/testEvidence/evidenceBundle.ts';
import {
  chooseDefaultTicks, describeFileType, downloadJiraEvidence, listJiraEvidence, resolveJiraEvidenceAtFinish, sumJiraEvidenceBytes,
  type JiraEvidenceAttachment,
} from './jiraEvidence.ts';

vi.mock('../../views/SnowHub/testEvidence/evidenceAttachmentFetch.ts', () => ({
  loadReleaseAttachments: vi.fn(),
  downloadAttachmentBytes: vi.fn(),
}));

const MEGABYTE = 1024 * 1024;

function buildAttachment(attachmentId: string, filename: string, sizeBytes = 100): EvidenceAttachment {
  return { attachmentId, filename, sizeBytes, contentUrl: `https://jira.example.com/secure/attachment/${attachmentId}/${filename}` };
}

function buildEvidence(issueKey: string, attachmentId: string, filename: string, sizeBytes = 100): JiraEvidenceAttachment {
  return { issueKey, issueSummary: `Story ${issueKey}`, attachment: buildAttachment(attachmentId, filename, sizeBytes) };
}

describe('listJiraEvidence', () => {
  beforeEach(() => vi.mocked(loadReleaseAttachments).mockReset());

  it('lists every file in issue order, and names issues with no files and keys Jira could not find', async () => {
    vi.mocked(loadReleaseAttachments).mockResolvedValue({
      issues: [
        { key: 'ENCUC-10', summary: 'Ten', attachments: [buildAttachment('3', 'zeta.pdf'), buildAttachment('2', 'alpha.png')] },
        { key: 'ENCUC-9', summary: 'Nine', attachments: [buildAttachment('1', 'report.pdf')] },
        { key: 'ENCUC-11', summary: 'Eleven', attachments: [] },
      ],
      missingKeys: ['ENCUC-99'],
    });

    const listing = await listJiraEvidence(['ENCUC-10', 'ENCUC-9', 'ENCUC-11', 'ENCUC-99']);

    expect(listing.attachments.map((evidence) => `${evidence.issueKey}/${evidence.attachment.filename}`))
      .toEqual(['ENCUC-9/report.pdf', 'ENCUC-10/alpha.png', 'ENCUC-10/zeta.pdf']);
    expect(listing.attachments[0].issueSummary).toBe('Nine');
    expect(listing.issuesWithoutFiles).toEqual(['ENCUC-11']);
    expect(listing.missingKeys).toEqual(['ENCUC-99']);
  });

  it('asks Jira nothing when the change has no issues', async () => {
    expect(await listJiraEvidence([])).toEqual({ attachments: [], issuesWithoutFiles: [], missingKeys: [] });
    expect(loadReleaseAttachments).not.toHaveBeenCalled();
  });
});

describe('resolveJiraEvidenceAtFinish', () => {
  beforeEach(() => vi.mocked(loadReleaseAttachments).mockReset());

  it('uses the ticks the user made on the evidence step', async () => {
    const ticked = [buildEvidence('ENCUC-9', '1', 'report.pdf')];
    expect(await resolveJiraEvidenceAtFinish({ tickedEvidence: ticked, hasChoice: true, issueKeys: ['ENCUC-9'], localBytes: 0 })).toEqual(ticked);
    expect(loadReleaseAttachments).not.toHaveBeenCalled();
  });

  it('gathers every Jira file like Toolbox when the evidence step was never opened', async () => {
    vi.mocked(loadReleaseAttachments).mockResolvedValue({
      issues: [{ key: 'ENCUC-9', summary: 'Nine', attachments: [buildAttachment('1', 'report.pdf'), buildAttachment('2', 'shot.png')] }],
      missingKeys: [],
    });
    const gathered = await resolveJiraEvidenceAtFinish({ tickedEvidence: [], hasChoice: false, issueKeys: ['ENCUC-9'], localBytes: 0 });
    expect(gathered.map((evidence) => evidence.attachment.filename)).toEqual(['report.pdf', 'shot.png']);
  });
});

describe('chooseDefaultTicks', () => {
  it('ticks every file, like Toolbox gathers every attachment', () => {
    const attachments = [buildEvidence('A-1', '1', 'a.pdf'), buildEvidence('A-1', '2', 'b.pdf')];
    expect(chooseDefaultTicks(attachments, [], 0)).toEqual({ tickedIds: ['1', '2'], leftOutForSize: [] });
  });

  it('keeps a file the user unticked earlier unticked', () => {
    const attachments = [buildEvidence('A-1', '1', 'a.pdf'), buildEvidence('A-1', '2', 'b.pdf')];
    expect(chooseDefaultTicks(attachments, ['2'], 0).tickedIds).toEqual(['1']);
  });

  it('leaves out, and names, files that would push the set past what ServiceNow takes', () => {
    const attachments = [buildEvidence('A-1', '1', 'a.mp4', 50 * MEGABYTE), buildEvidence('A-1', '2', 'b.mp4', 30 * MEGABYTE)];
    expect(chooseDefaultTicks(attachments, [], 0)).toEqual({ tickedIds: ['1'], leftOutForSize: ['b.mp4'] });
    expect(chooseDefaultTicks(attachments, [], 60 * MEGABYTE)).toEqual({ tickedIds: [], leftOutForSize: ['a.mp4', 'b.mp4'] });
  });
});

describe('sumJiraEvidenceBytes and describeFileType', () => {
  it('adds the sizes up', () => {
    expect(sumJiraEvidenceBytes([buildEvidence('A-1', '1', 'a', 10), buildEvidence('A-1', '2', 'b', 5)])).toBe(15);
  });

  it('names the type from the file ending, in plain words', () => {
    expect(describeFileType('results.final.pdf')).toBe('PDF');
    expect(describeFileType('screen.PNG')).toBe('PNG');
    expect(describeFileType('README')).toBe('File');
  });
});

describe('downloadJiraEvidence', () => {
  beforeEach(() => vi.mocked(downloadAttachmentBytes).mockReset());

  it('downloads each file in turn, reporting progress, and one failure never stops the others', async () => {
    vi.mocked(downloadAttachmentBytes)
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockRejectedValueOnce(new Error('Attachment download failed (403)'))
      .mockResolvedValueOnce(new Uint8Array([3]));
    const onProgress = vi.fn();
    const attachments = [buildEvidence('A-1', '1', 'a.pdf'), buildEvidence('A-2', '2', 'b.pdf'), buildEvidence('A-3', '3', 'c.pdf')];

    const outcome = await downloadJiraEvidence(attachments, onProgress);

    expect(outcome.downloaded.map((download) => download.evidence.attachment.filename)).toEqual(['a.pdf', 'c.pdf']);
    expect(outcome.downloaded[1].bytes).toEqual(new Uint8Array([3]));
    expect(outcome.problems).toEqual([expect.stringMatching(/b\.pdf.*A-2.*403/)]);
    expect(onProgress).toHaveBeenCalledWith('Getting file 2 of 3 from Jira: b.pdf…');
    expect(downloadAttachmentBytes).toHaveBeenCalledWith('https://jira.example.com/secure/attachment/1/a.pdf');
  });
});
