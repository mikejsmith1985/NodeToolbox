// snowAttachmentUpload.ts — Attaching one file to a ServiceNow change through the browser relay.
//
// ServiceNow's Attachment API takes the raw bytes as the request body and the target record in
// the query string; the relay's base64 path is what carries those bytes out of the browser.

import { snowUploadFile } from '../../../services/snowApi.ts';

/** The table a change request lives in. */
export const CHANGE_REQUEST_TABLE = 'change_request';
const ATTACHMENT_FILE_API_PATH = '/api/now/attachment/file';
const ZIP_CONTENT_TYPE = 'application/zip';

/** What ServiceNow says about the attachment it stored. */
export interface AttachedFileRecord {
  sysId: string;
  fileName: string;
  sizeBytes: number;
}

/** How the Attachment API answers a successful upload. Loose because instances add fields freely. */
interface AttachmentUploadResponse {
  result?: {
    sys_id?: string;
    file_name?: string;
    size_bytes?: string | number;
  };
}

/** Builds the Attachment API path that files `fileName` against one record of `tableName`. */
export function buildAttachmentUploadPath(tableName: string, recordSysId: string, fileName: string): string {
  // encodeURIComponent rather than URLSearchParams: the latter writes a space as "+", which
  // ServiceNow keeps literally in the stored file name.
  return `${ATTACHMENT_FILE_API_PATH}`
    + `?table_name=${encodeURIComponent(tableName)}`
    + `&table_sys_id=${encodeURIComponent(recordSysId)}`
    + `&file_name=${encodeURIComponent(fileName)}`;
}

/**
 * Attaches a zip to a change and returns what ServiceNow recorded.
 *
 * The recorded size is checked against the bytes sent. That is not pedantry: a Toolbox Relay
 * bookmarklet from before the base64 path existed posts the base64 TEXT as JSON, ServiceNow
 * happily stores it under the zip's name, and the only visible difference is that its size is a
 * third larger. Saying "re-install the bookmarklet" here beats a reviewer opening a corrupt zip.
 */
export async function attachFileToChange(
  changeSysId: string,
  fileName: string,
  fileBytes: Uint8Array,
): Promise<AttachedFileRecord> {
  if (changeSysId.trim() === '') {
    throw new Error('No change record to attach to — load the change first.');
  }

  const uploadPath = buildAttachmentUploadPath(CHANGE_REQUEST_TABLE, changeSysId, fileName);
  const response = await snowUploadFile<AttachmentUploadResponse>(uploadPath, fileBytes, ZIP_CONTENT_TYPE);
  const record = response?.result;
  if (!record?.sys_id) {
    throw new Error('ServiceNow did not confirm the attachment — nothing was recorded on the change.');
  }

  const recordedSize = Number(record.size_bytes ?? 0) || 0;
  if (recordedSize !== fileBytes.length) {
    throw new Error(
      `ServiceNow stored ${recordedSize} bytes but ${fileBytes.length} were sent. The Toolbox Relay `
      + 'bookmarklet in the ServiceNow tab is probably out of date — re-install it from the Relay panel, '
      + `then delete the bad attachment (${record.file_name ?? fileName}) from the change and try again.`,
    );
  }

  return { sysId: record.sys_id, fileName: record.file_name ?? fileName, sizeBytes: recordedSize };
}
