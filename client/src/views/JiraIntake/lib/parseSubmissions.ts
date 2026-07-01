// parseSubmissions.ts — Reads a dropped Excel/CSV export into header-keyed rows using the bundled
// SheetJS parser. This is the only file-I/O boundary of the importer; row interpretation lives in
// normalizeSubmission.ts. SheetJS is loaded via dynamic import (matching PiReviewTab /
// useMyIssuesState) so its weight stays out of the main bundle. See research.md R1/R2.

/** The SheetJS module type, referenced without statically bundling the library. */
type XlsxModule = typeof import('xlsx');

/** The preferred worksheet/table name the Phase-1 flow writes to; falls back to the first sheet. */
const PREFERRED_SHEET_NAME = 'Submissions';

/** One raw row as header→cell-text pairs (SheetJS `raw:false` yields formatted strings). */
export type RawRow = Record<string, string>;

/** Thrown when a dropped file cannot be read as a workbook, so the UI can show a clear message. */
export class IntakeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntakeParseError';
  }
}

/**
 * Selects the target sheet (prefers `Submissions`, else the first) and returns its rows as
 * header→string maps. Pure over an already-parsed workbook + SheetJS module so it is unit-testable.
 * Values come back as strings so ISO timestamps and Unicode text (e.g. curly quotes) survive.
 */
export function rowsFromWorkbook(workbook: import('xlsx').WorkBook, xlsx: XlsxModule): RawRow[] {
  const sheetName = workbook.SheetNames.includes(PREFERRED_SHEET_NAME)
    ? PREFERRED_SHEET_NAME
    : workbook.SheetNames[0];
  if (!sheetName) {
    throw new IntakeParseError('The workbook contains no worksheets.');
  }

  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json<RawRow>(worksheet, { defval: '', raw: false });
}

/**
 * Reads a dropped File into rows. Loads SheetJS on demand, wrapping a read failure in a typed,
 * user-facing error so the dropzone can show a clear message (FR-6.1).
 */
export async function parseWorkbook(file: File): Promise<RawRow[]> {
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    throw new IntakeParseError('The dropped file could not be read. Try downloading it again.');
  }

  const xlsx = await import('xlsx');
  let workbook: import('xlsx').WorkBook;
  try {
    workbook = xlsx.read(data, { type: 'array' });
  } catch {
    throw new IntakeParseError('This file could not be read as an Excel or CSV workbook.');
  }
  return rowsFromWorkbook(workbook, xlsx);
}
