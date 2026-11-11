// aiReplyRecords.ts — Lets every JSON-reply AI round accept a filled-in table instead, for Google's AI Mode.
//
// The app's AI rounds ask for a {kind, items[]} JSON object. The team's only assistant is now Google Search AI Mode, an
// answer engine that ignores reply syntax: it answers in prose and tables, rarely in JSON (GH #499). Asking it to fill in
// a table that already lists every item is followed far more reliably. So each round's prompt ends with a fill-in table,
// and its reader turns the table back into the same {kind, items[]} JSON text its parser already validates — every
// per-item rule (unknown keys dropped, enums checked, notes capped) keeps applying unchanged. A JSON reply is still read,
// so a reply from any other assistant keeps working. A reply that is neither gets a follow-up asking for the table.

import { extractJsonPayload } from './extractJsonPayload.ts';
import { FILL_IN_BLANK, buildFillInTable, splitReplyCellsKeepingBlanks } from './aiReplyTable.ts';

// ── Types ──

/** How a cell's text becomes the JSON value the round's parser expects. */
export type ReplyRecordValueKind = 'text' | 'boolean' | 'number' | 'list';

/** One column of a round's fill-in table, and the JSON field its cells fill. */
export interface ReplyRecordColumn {
  /** The JSON field name the round's parser reads, e.g. "issueKey". */
  field: string;
  /** The column's header as the prompt shows it, e.g. "Issue key". */
  header: string;
  /** How the cell is turned into a value. Text when omitted. */
  valueKind?: ReplyRecordValueKind;
  /** A column the prompt fills in to name the item (a summary) — shown, never read back. */
  isNamingOnly?: boolean;
  /** What a blank in this column means, said once in the rules: "XS, S, M, L, XL or XXL". */
  answerHint?: string;
}

/** One round's table: the envelope kind its parser checks, the line the table starts after, and its columns. */
export interface ReplyRecordSpec {
  kind: string;
  /** The line the table follows, e.g. "PI_REVIEW_TABLE:". Lets the reader skip any prose before the table. */
  replyMarker: string;
  /** The columns in order. The first is the item's key, which the prompt always fills in. */
  columns: readonly ReplyRecordColumn[];
}

// ── Named constants ──

/** The error a round's parser already shows when nothing usable came back — kept word for word. */
const NO_REPLY_PAYLOAD_MESSAGE = 'No JSON object found in the assistant response.';
// Cell texts that mean "nothing to say": the blank left unfilled, or an assistant's own way of writing nothing.
const EMPTY_CELL_PATTERN = /^(?:_{2,}|-{1,2}|—|n\/?a|none|null)$/i;
const TRUE_CELL_PATTERN = /^(?:yes|y|true|x|✓|✔|✅)$/i;
const FALSE_CELL_PATTERN = /^(?:no|n|false|✗|✘|❌)$/i;
// Separators between the entries of a list cell: "DENP-1; DENP-2", "a, b".
const LIST_CELL_SEPARATOR = /\s*[;,]\s*/;
/** A row naming at least this many columns (or every column of a two-column table) is the header row. */
const MINIMUM_HEADER_MATCHES = 2;

// ── Building the prompt's table ──

/** A header cell's words, lower-cased with punctuation dropped, so "Issue key:" and "**issue  key**" compare equal. */
function normalizeHeaderText(headerText: string): string {
  return headerText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The lines a round's prompt ends with: how to fill the table, what each column takes, then the table itself — one row
 * per item, its naming cells filled in and a blank for every answer. Each row's naming cells are the key first, then
 * any naming-only columns, in column order.
 */
export function buildRecordReplyInstructions(spec: ReplyRecordSpec, rowNamingCells: readonly (readonly string[])[]): string {
  return [...describeRecordTableRules(spec), '', spec.replyMarker, ...buildRecordFillInTable(spec, rowNamingCells)].join('\n');
}

/** The table alone: the header row and one row per item. */
export function buildRecordFillInTable(spec: ReplyRecordSpec, rowNamingCells: readonly (readonly string[])[]): string[] {
  return buildFillInTable(spec.columns.map((column) => column.header), rowNamingCells);
}

/** The rule lines before a round's table, worded for an assistant that answers in its own shape. */
export function describeRecordTableRules(spec: ReplyRecordSpec): string[] {
  const columnHints = spec.columns
    .filter((column) => column.answerHint)
    .map((column) => `- ${column.header}: ${column.answerHint}`);
  return [
    `Answer ONLY by copying the table below, starting with the line ${spec.replyMarker}, and replacing every `
      + `${FILL_IN_BLANK} with your answer. Keep one row per item, in this order, with its first column exactly as written.`,
    'Do not add, remove or rename rows or columns, and do not answer in JSON, bullet points or paragraphs. Keep each cell '
      + 'on one line, and never put a "|" inside a cell.',
    `Leave ${FILL_IN_BLANK} in a cell when you have nothing useful to put there. Write nothing before or after the table, `
      + 'and ask no questions: when something is unclear, give your best judgement.',
    ...(columnHints.length > 0 ? ['What each column takes:', ...columnHints] : []),
  ];
}

/**
 * The follow-up for a reply that could not be read: the same rules and table again. It asks for the form only, so the
 * judgement the assistant already made is kept.
 */
export function buildRecordFormatFixPrompt(spec: ReplyRecordSpec, rowNamingCells: readonly (readonly string[])[]): string {
  return [
    'Your last reply was not in the form I need, so it could not be read. Keep the answers you already gave, but put them in this table.',
    buildRecordReplyInstructions(spec, rowNamingCells),
  ].join('\n');
}

// ── Reading a reply ──

/** Where each column sits when these cells are the table's header row, or null when they are not it. */
function findRecordHeaderColumns(cells: readonly string[], spec: ReplyRecordSpec): Map<ReplyRecordColumn, number> | null {
  const normalizedCells = cells.map(normalizeHeaderText);
  const columnIndexes = new Map<ReplyRecordColumn, number>();
  for (const column of spec.columns) {
    const columnIndex = normalizedCells.indexOf(normalizeHeaderText(column.header));
    if (columnIndex !== -1) columnIndexes.set(column, columnIndex);
  }
  const neededMatches = Math.min(MINIMUM_HEADER_MATCHES, spec.columns.length);
  return columnIndexes.size >= neededMatches && columnIndexes.has(spec.columns[0]) ? columnIndexes : null;
}

/** A cell's text as the JSON value its column expects, or undefined when the cell says nothing. */
function readCellValue(cellText: string, valueKind: ReplyRecordValueKind): unknown {
  const trimmedText = cellText.trim();
  if (trimmedText === '' || EMPTY_CELL_PATTERN.test(trimmedText)) return undefined;
  if (valueKind === 'boolean') {
    if (TRUE_CELL_PATTERN.test(trimmedText)) return true;
    if (FALSE_CELL_PATTERN.test(trimmedText)) return false;
    return undefined;
  }
  if (valueKind === 'number') {
    const numberValue = Number(trimmedText.replace(/[^\d.-]/g, ''));
    return Number.isFinite(numberValue) && /\d/.test(trimmedText) ? numberValue : undefined;
  }
  if (valueKind === 'list') return trimmedText.split(LIST_CELL_SEPARATOR).filter((entryText) => entryText !== '');
  return trimmedText;
}

/** One table row as an item, or null when its key cell is empty. Naming-only columns are never read back. */
function readRecordRow(cells: readonly string[], columnIndexes: Map<ReplyRecordColumn, number>, spec: ReplyRecordSpec): Record<string, unknown> | null {
  const replyItem: Record<string, unknown> = {};
  for (const [column, columnIndex] of columnIndexes) {
    if (column.isNamingOnly || columnIndex >= cells.length) continue;
    const cellValue = readCellValue(cells[columnIndex], column.valueKind ?? 'text');
    if (cellValue !== undefined) replyItem[column.field] = cellValue;
  }
  return replyItem[spec.columns[0].field] === undefined ? null : replyItem;
}

/** Every item in the reply's table, or null when the reply holds no table with this round's header. */
export function readRecordTableItems(replyText: string, spec: ReplyRecordSpec): Record<string, unknown>[] | null {
  let columnIndexes: Map<ReplyRecordColumn, number> | null = null;
  const replyItems: Record<string, unknown>[] = [];
  for (const replyLine of replyText.split(/\r?\n/)) {
    const cells = splitReplyCellsKeepingBlanks(replyLine);
    if (cells.length === 0) continue;
    // A header row may appear more than once (a follow-up's table pasted under the first) — each one re-reads the layout.
    const headerColumns = findRecordHeaderColumns(cells, spec);
    if (headerColumns) {
      columnIndexes = headerColumns;
      continue;
    }
    const replyItem = columnIndexes ? readRecordRow(cells, columnIndexes, spec) : null;
    if (replyItem) replyItems.push(replyItem);
  }
  return columnIndexes ? replyItems : null;
}

/**
 * The reply as the {kind, items[]} JSON text the round's parser reads — a drop-in for extractJsonPayload. A filled-in
 * table is read first (it is what the prompt asks for); a JSON reply is read as before. Throws the same "No JSON object
 * found" error when the reply is neither, so every round's existing "could not read" message still shows.
 */
export function extractRecordReplyPayload(replyText: string, spec: ReplyRecordSpec): string {
  const tableItems = readRecordTableItems(replyText, spec);
  if (tableItems && tableItems.length > 0) return JSON.stringify({ kind: spec.kind, items: tableItems });
  try {
    return extractJsonPayload(replyText);
  } catch {
    // Neither a table nor JSON — reported in the words every round already shows.
    throw new Error(NO_REPLY_PAYLOAD_MESSAGE);
  }
}

/** True when a reply holds neither this round's table nor a JSON object — the cue to offer the follow-up. */
export function isUnreadableRecordReply(replyText: string, spec: ReplyRecordSpec): boolean {
  try {
    extractRecordReplyPayload(replyText, spec);
    return false;
  } catch {
    return true;
  }
}
