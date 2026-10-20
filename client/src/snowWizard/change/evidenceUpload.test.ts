// evidenceUpload.test.ts — Proves evidence is refused up front when too big, and attached to every change once they exist.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { attachFileToChange } from '../../views/SnowHub/testEvidence/snowAttachmentUpload.ts';
import { attachEvidenceToChanges, checkEvidenceSize } from './evidenceUpload.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../views/SnowHub/testEvidence/snowAttachmentUpload.ts', () => ({ attachFileToChange: vi.fn() }));
vi.mock('../../views/SnowHub/testEvidence/zipArchive.ts', () => ({ createZipArchive: vi.fn(() => new Uint8Array([1, 2, 3])) }));

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
