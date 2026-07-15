// workbookSource.ts — Reads a dropped spreadsheet into the composition workspace as reference material.
//
// SheetJS is loaded via dynamic import, matching how the rest of the app uses it: the parser is large,
// and most PO Tool sessions never drop a file, so its weight must stay out of the main bundle (SC-019).
//
// This mirrors the Jira Intake importer's pattern rather than reusing its components directly — that
// importer's copy and preferred-sheet logic are specific to its job, and reshaping a shipped importer to
// serve a new tab would put an unrelated tool at risk for no user gain (research R5).
//
// A workbook here is READING MATERIAL. No row becomes an issue; that is Jira Intake's job.

import { mintSourceId, type ReferencedSource, type WorkbookSource } from './sourceModel';

/** The SheetJS module type, referenced without statically bundling the library. */
type XlsxModule = typeof import('xlsx');

/** What the file picker and dropzone accept. */
export const WORKBOOK_FILE_ACCEPT = '.xlsx,.xls,.csv';

/** The extensions this reader will attempt. Drag-and-drop ignores the picker's filter, so re-check. */
const SUPPORTED_FILE_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv'];

/**
 * First bytes that prove a file really is what its name claims.
 *
 * This check exists because SheetJS is deliberately forgiving: handed anything it does not recognise, it
 * falls back to reading it as CSV. A PDF renamed `.xlsx` therefore parses "successfully" into rows of
 * mojibake instead of failing — which would put convincing nonsense into a PO's workspace with no
 * warning at all. Checking the signature is what turns that silent corruption into a clear message.
 */
const FILE_SIGNATURES: Readonly<Record<string, readonly number[]>> = {
  // .xlsx/.xlsm are ZIP archives.
  '.xlsx': [0x50, 0x4b],
  '.xlsm': [0x50, 0x4b],
  // Legacy .xls is an OLE2 compound file.
  '.xls': [0xd0, 0xcf, 0x11, 0xe0],
  // .csv is plain text and has no signature — its content check is that it decodes at all.
};

/** Thrown when a dropped file cannot be read, so the tab can say something a PO understands. */
export class WorkbookReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookReadError';
  }
}

/** The file's extension, lowercased, including the dot. */
function readFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex === -1 ? '' : fileName.slice(lastDotIndex).toLowerCase();
}

/** Rejects a file whose bytes do not match what its name claims. */
function assertFileLooksLikeItsExtension(file: File, fileData: ArrayBuffer, fileExtension: string): void {
  const expectedSignature = FILE_SIGNATURES[fileExtension];
  if (!expectedSignature) {
    return;
  }
  const leadingBytes = new Uint8Array(fileData.slice(0, expectedSignature.length));
  const doesSignatureMatch =
    leadingBytes.length === expectedSignature.length
    && expectedSignature.every((expectedByte, byteIndex) => leadingBytes[byteIndex] === expectedByte);

  if (!doesSignatureMatch) {
    throw new WorkbookReadError(
      `"${file.name}" is named like a spreadsheet but its contents are not one — it may be a different kind of file that was renamed, or it may be damaged. Try re-exporting it from Excel.`,
    );
  }
}

/** Reads one sheet as header→cell-text rows. Strings throughout, so dates and unicode survive intact. */
export function readSheetRows(
  workbook: import('xlsx').WorkBook,
  sheetName: string,
  xlsx: XlsxModule,
): Record<string, string>[] {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new WorkbookReadError(`This file has no sheet called "${sheetName}".`);
  }
  return xlsx.utils.sheet_to_json<Record<string, string>>(worksheet, { defval: '', raw: false });
}

/**
 * Reads a dropped file into a referenced source.
 *
 * Any failure is wrapped in a message a non-developer can act on. The caller keeps the draft untouched
 * on failure — a bad file must cost the PO nothing (FR-023a).
 */
export async function readWorkbookSource(
  file: File,
  existingSources: readonly ReferencedSource[],
  preferredSheetName?: string,
): Promise<WorkbookSource> {
  // Checked before anything is read: a dropzone's accept filter only governs the file PICKER, so a
  // drag-and-drop can deliver anything at all.
  const fileExtension = readFileExtension(file.name);
  if (!SUPPORTED_FILE_EXTENSIONS.includes(fileExtension)) {
    throw new WorkbookReadError(
      `"${file.name}" could not be read as a spreadsheet. Excel (.xlsx, .xls) and CSV files are supported.`,
    );
  }

  let fileData: ArrayBuffer;
  try {
    fileData = await file.arrayBuffer();
  } catch {
    throw new WorkbookReadError('That file could not be read. Try saving it again and re-adding it.');
  }

  assertFileLooksLikeItsExtension(file, fileData, fileExtension);

  // Loaded on demand: most sessions never drop a file, and this parser is large.
  const xlsx = await import('xlsx');

  let workbook: import('xlsx').WorkBook;
  try {
    workbook = xlsx.read(fileData, { type: 'array' });
  } catch {
    throw new WorkbookReadError(
      `"${file.name}" could not be read as a spreadsheet. Excel (.xlsx, .xls) and CSV files are supported.`,
    );
  }

  const availableSheetNames = workbook.SheetNames ?? [];
  if (availableSheetNames.length === 0) {
    throw new WorkbookReadError(`"${file.name}" contains no worksheets.`);
  }

  // A named sheet wins; otherwise the first, which is what a spreadsheet opens on.
  const sheetName = preferredSheetName && availableSheetNames.includes(preferredSheetName)
    ? preferredSheetName
    : availableSheetNames[0];

  const rows = readSheetRows(workbook, sheetName, xlsx);

  return {
    kind: 'workbook',
    id: mintSourceId(existingSources, 'workbook'),
    fileName: file.name,
    sheetName,
    availableSheetNames,
    rows,
  };
}
