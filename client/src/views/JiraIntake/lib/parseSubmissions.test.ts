// parseSubmissions.test.ts — Verifies the SheetJS boundary against real, in-memory workbooks built
// with the same library (no mocks). Covers sheet preference, Unicode preservation, the
// no-worksheet error, and the unreadable-file error path.

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { IntakeParseError, parseWorkbook, rowsFromWorkbook } from './parseSubmissions.ts';

const HEADERS = [
  'id', 'submittedAt', 'status', 'submitterDisplayName', 'submitterEmail',
  'summary', 'description', 'acceptanceCriteria', 'issueType', 'priority',
];

/** Builds an xlsx ArrayBuffer from a header row + data rows, on the given sheet name. */
function buildWorkbook(rows: string[][], sheetName = 'Submissions'): ArrayBuffer {
  const worksheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Wraps a buffer in a minimal File-like object exposing arrayBuffer(). */
function fileFrom(buffer: ArrayBuffer): File {
  return { arrayBuffer: async () => buffer } as unknown as File;
}

describe('parseWorkbook', () => {
  it('reads the Submissions sheet into header-keyed rows', async () => {
    const buffer = buildWorkbook([
      ['id-1', '2026-07-01T11:25:42.1202199Z', 'New', 'Michael Smith', 'm@corp.com',
        'A summary', 'A description', 'Some AC', 'Story', 'Highest'],
    ]);
    const rows = await parseWorkbook(fileFrom(buffer));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('id-1');
    expect(rows[0].submittedAt).toBe('2026-07-01T11:25:42.1202199Z');
    expect(rows[0].issueType).toBe('Story');
  });

  it('preserves Unicode / smart quotes in free-text fields', async () => {
    const buffer = buildWorkbook([
      ['id-2', '2026-07-01T12:00:00Z', 'New', 'M', 'm@corp.com',
        's', 'I’d like work done', 'ac', 'Story', 'High'],
    ]);
    const rows = await parseWorkbook(fileFrom(buffer));
    expect(rows[0].description).toBe('I’d like work done');
  });

  it('falls back to the first sheet when there is no Submissions sheet', async () => {
    const buffer = buildWorkbook([['id-3', '', 'New', '', '', 's', '', '', '', '']], 'Sheet1');
    const rows = await parseWorkbook(fileFrom(buffer));
    expect(rows[0].id).toBe('id-3');
  });

  it('throws IntakeParseError when the file cannot be read', async () => {
    const fileLike = { arrayBuffer: async () => { throw new Error('read failed'); } } as unknown as File;
    await expect(parseWorkbook(fileLike)).rejects.toThrow(IntakeParseError);
  });
});

describe('rowsFromWorkbook', () => {
  it('throws IntakeParseError when the workbook has no worksheets', () => {
    const emptyWorkbook = { SheetNames: [], Sheets: {} } as unknown as XLSX.WorkBook;
    expect(() => rowsFromWorkbook(emptyWorkbook, XLSX)).toThrow(IntakeParseError);
    expect(() => rowsFromWorkbook(emptyWorkbook, XLSX)).toThrow(/no worksheets/i);
  });
});
