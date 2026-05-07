// csvExport.ts — Builds standards-compliant CSV downloads for Dev Panel activity logs.

import type { DevPanelEntry } from '../hooks/useDevPanelLog.ts';

const CSV_HEADER = ['timestamp', 'method', 'url', 'status', 'durationMs', 'error'];
const CSV_QUOTE = '"';
const CSV_ESCAPED_QUOTE = '""';
const CSV_ROW_SEPARATOR = '\n';
const CSV_NEEDS_QUOTING_PATTERN = /[",\n]/;

/** Converts Dev Panel entries into the exact CSV shape expected by support/debug workflows. */
export function buildCsv(entries: DevPanelEntry[]): string {
  const csvRows = [CSV_HEADER.join(',')];
  csvRows.push(...entries.map((entry) => buildCsvRow(entry)));
  return csvRows.join(CSV_ROW_SEPARATOR);
}

/** Escapes one CSV cell using RFC 4180 quoting so spreadsheet imports preserve the original text. */
export function sanitizeCell(cellValue: string | number | null): string {
  if (cellValue === null) return '';

  const rawCellText = String(cellValue);
  const escapedCellText = rawCellText.replaceAll(CSV_QUOTE, CSV_ESCAPED_QUOTE);
  if (!CSV_NEEDS_QUOTING_PATTERN.test(escapedCellText)) return escapedCellText;

  return `${CSV_QUOTE}${escapedCellText}${CSV_QUOTE}`;
}

function buildCsvRow(entry: DevPanelEntry): string {
  return [
    entry.timestamp,
    entry.method,
    entry.url,
    entry.status,
    entry.durationMs,
    entry.errorMessage,
  ].map((cellValue) => sanitizeCell(cellValue)).join(',');
}
