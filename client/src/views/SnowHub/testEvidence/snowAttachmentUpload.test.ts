// snowAttachmentUpload.test.ts — Attaching a file to a change record, and reading back what landed.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSnowUploadFile } = vi.hoisted(() => ({ mockSnowUploadFile: vi.fn() }));

vi.mock('../../../services/snowApi.ts', () => ({ snowUploadFile: mockSnowUploadFile }));

import { attachFileToChange, buildAttachmentUploadPath } from './snowAttachmentUpload.ts';

const ZIP_BYTES = new Uint8Array([80, 75, 3, 4]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildAttachmentUploadPath', () => {
  it("targets ServiceNow's attachment API for the change table and record", () => {
    expect(buildAttachmentUploadPath('change_request', 'abc123', 'Test-Evidence_CHG1_2026-09-05.zip')).toBe(
      '/api/now/attachment/file?table_name=change_request&table_sys_id=abc123&file_name=Test-Evidence_CHG1_2026-09-05.zip',
    );
  });

  it('encodes a file name that carries reserved characters', () => {
    expect(buildAttachmentUploadPath('change_request', 'abc', 'a b&c.zip')).toContain('file_name=a%20b%26c.zip');
  });
});

describe('attachFileToChange', () => {
  it('uploads the bytes as a zip against the change and reports what ServiceNow recorded', async () => {
    mockSnowUploadFile.mockResolvedValue({
      result: { sys_id: 'att-1', file_name: 'Test-Evidence_CHG1_2026-09-05.zip', size_bytes: '4', content_type: 'application/zip' },
    });

    const attached = await attachFileToChange('chg-sys-1', 'Test-Evidence_CHG1_2026-09-05.zip', ZIP_BYTES);

    expect(mockSnowUploadFile).toHaveBeenCalledWith(
      '/api/now/attachment/file?table_name=change_request&table_sys_id=chg-sys-1&file_name=Test-Evidence_CHG1_2026-09-05.zip',
      ZIP_BYTES,
      'application/zip',
    );
    expect(attached).toEqual({ sysId: 'att-1', fileName: 'Test-Evidence_CHG1_2026-09-05.zip', sizeBytes: 4 });
  });

  it('refuses a missing change id rather than asking ServiceNow to attach to nothing', async () => {
    await expect(attachFileToChange('', 'x.zip', ZIP_BYTES)).rejects.toThrow('change record');
    expect(mockSnowUploadFile).not.toHaveBeenCalled();
  });

  it('treats a response without an attachment record as a failure, not a success', async () => {
    // An older bookmarklet posts the base64 text as JSON; ServiceNow answers 201 with a record
    // whose size is the TEXT's size. The size check is what catches that.
    mockSnowUploadFile.mockResolvedValue({ result: {} });

    await expect(attachFileToChange('chg-sys-1', 'x.zip', ZIP_BYTES)).rejects.toThrow('did not confirm');
  });

  it('refuses a record whose recorded size is not the bytes sent — the sign of an outdated bookmarklet', async () => {
    mockSnowUploadFile.mockResolvedValue({ result: { sys_id: 'att-1', file_name: 'x.zip', size_bytes: '8' } });

    await expect(attachFileToChange('chg-sys-1', 'x.zip', ZIP_BYTES)).rejects.toThrow('bookmarklet');
  });
});
