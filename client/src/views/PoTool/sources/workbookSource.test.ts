// workbookSource.test.ts — Proves a dropped spreadsheet becomes reference material, that a multi-sheet
// file never silently shows only its first sheet, and that an unreadable file costs the PO nothing
// (FR-023a, SC-019).

import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';

import { readWorkbookSource, WORKBOOK_FILE_ACCEPT, WorkbookReadError } from './workbookSource';

/** Builds a real .xlsx in memory, so the parser is genuinely exercised rather than mocked away. */
function buildWorkbookFile(
  sheets: Record<string, Record<string, string>[]>,
  fileName = 'volumes.xlsx',
): File {
  const workbook = xlsx.utils.book_new();
  Object.entries(sheets).forEach(([sheetName, rows]) => {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), sheetName);
  });
  const workbookBytes = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([workbookBytes], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('WORKBOOK_FILE_ACCEPT', () => {
  it('accepts the spreadsheet formats a PO actually has', () => {
    expect(WORKBOOK_FILE_ACCEPT).toBe('.xlsx,.xls,.csv');
  });
});

describe('readWorkbookSource — reading a file', () => {
  it('reads rows as header-keyed text', async () => {
    const file = buildWorkbookFile({ Summary: [{ Region: 'North', Claims: '3000' }] });

    const source = await readWorkbookSource(file, []);

    expect(source.rows).toEqual([{ Region: 'North', Claims: '3000' }]);
  });

  it('keeps the file name, so the PO can see where a figure came from', async () => {
    const file = buildWorkbookFile({ Summary: [{ Region: 'North' }] }, 'claim-volumes.xlsx');

    const source = await readWorkbookSource(file, []);

    expect(source.fileName).toBe('claim-volumes.xlsx');
  });

  it('reads numbers as text, so an id or a date is never mangled into a float', async () => {
    const file = buildWorkbookFile({ Summary: [{ Claims: '3000' }] });

    const source = await readWorkbookSource(file, []);

    expect(source.rows[0].Claims).toBe('3000');
  });

  it('mints an id unique within the workspace', async () => {
    const file = buildWorkbookFile({ Summary: [{ Region: 'North' }] });

    const source = await readWorkbookSource(file, []);

    expect(source.id).toBe('workbook-1');
  });
});

describe('readWorkbookSource — multi-sheet files (spec edge case)', () => {
  it('reports EVERY sheet, so the PO can see the file has more than one', async () => {
    const file = buildWorkbookFile({
      Summary: [{ Region: 'North' }],
      Detail: [{ Claim: 'C-1' }],
    });

    const source = await readWorkbookSource(file, []);

    expect(source.availableSheetNames).toEqual(['Summary', 'Detail']);
  });

  it('says which sheet it is showing rather than leaving the PO to assume', async () => {
    const file = buildWorkbookFile({ Summary: [{ Region: 'North' }], Detail: [{ Claim: 'C-1' }] });

    const source = await readWorkbookSource(file, []);

    expect(source.sheetName).toBe('Summary');
  });

  it('reads the sheet the PO asked for', async () => {
    const file = buildWorkbookFile({ Summary: [{ Region: 'North' }], Detail: [{ Claim: 'C-1' }] });

    const source = await readWorkbookSource(file, [], 'Detail');

    expect(source.sheetName).toBe('Detail');
    expect(source.rows).toEqual([{ Claim: 'C-1' }]);
  });

  it('falls back to the first sheet when the requested one is gone', async () => {
    const file = buildWorkbookFile({ Summary: [{ Region: 'North' }] });

    const source = await readWorkbookSource(file, [], 'Deleted');

    expect(source.sheetName).toBe('Summary');
  });
});

describe('readWorkbookSource — a file it cannot read (FR-023a)', () => {
  it('rejects a file that is plainly not a spreadsheet, in plain language', async () => {
    const notASpreadsheet = new File([new Uint8Array([1, 2, 3, 4])], 'report.pdf', {
      type: 'application/pdf',
    });

    await expect(readWorkbookSource(notASpreadsheet, [])).rejects.toThrow(WorkbookReadError);
    await expect(readWorkbookSource(notASpreadsheet, [])).rejects.toThrow(
      /could not be read as a spreadsheet/i,
    );
  });

  it('rejects a PDF that has been RENAMED .xlsx, rather than filling the workspace with nonsense', async () => {
    // The reason the signature check exists. SheetJS is deliberately forgiving: handed bytes it does
    // not recognise it falls back to reading them as CSV, so a renamed PDF parses "successfully" into
    // rows of mojibake. Without this guard a PO would get convincing garbage and no warning at all.
    const renamedPdf = new File([new TextEncoder().encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\nbinary junk')], 'volumes.xlsx');

    await expect(readWorkbookSource(renamedPdf, [])).rejects.toThrow(WorkbookReadError);
    await expect(readWorkbookSource(renamedPdf, [])).rejects.toThrow(/named like a spreadsheet/i);
  });

  it('names the file in the message, so the PO knows which one to fix', async () => {
    const damagedFile = new File([new Uint8Array([1, 2, 3])], 'broken.xlsx');

    await expect(readWorkbookSource(damagedFile, [])).rejects.toThrow(/"broken.xlsx"/);
  });

  it('rejects rather than returning an empty source, so the draft is never quietly polluted', async () => {
    const damagedFile = new File([new Uint8Array([1, 2, 3])], 'broken.xlsx');

    await expect(readWorkbookSource(damagedFile, [])).rejects.toBeInstanceOf(WorkbookReadError);
  });

  it('accepts a genuine CSV, which has no signature to check', async () => {
    const csvFile = new File([new TextEncoder().encode('Region,Claims\nNorth,3000\n')], 'volumes.csv');

    const source = await readWorkbookSource(csvFile, []);

    expect(source.rows).toEqual([{ Region: 'North', Claims: '3000' }]);
  });
});

describe('readWorkbookSource — an empty sheet', () => {
  it('reads no rows without throwing, because an empty sheet is a fact, not a failure', async () => {
    const file = buildWorkbookFile({ Summary: [] });

    const source = await readWorkbookSource(file, []);

    expect(source.rows).toEqual([]);
    expect(source.sheetName).toBe('Summary');
  });
});
