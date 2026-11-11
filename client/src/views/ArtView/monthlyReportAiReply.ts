// monthlyReportAiReply.ts — The Monthly Report AI round's reply form, and the reader that turns a reply into pillar entries.
//
// The Monthly Report asks an assistant to classify a team's month into business pillars and draft each pillar's
// narrative. Google's AI Mode — the team's only assistant (GH #499) — ignores a "reply with JSON" instruction, so the
// prompt ends with a fill-in table: one row per pillar, the narrative fields as columns. The assistant fills the rows
// its work belongs to and leaves the rest blank. The reader turns that table back into the same entries the JSON
// reply produced; a JSON array or object from any other assistant is still read.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  readRecordTableItems,
  type ReplyRecordSpec,
} from '../../utils/aiReplyRecords.ts';

// ── Named constants ──

/** The pillars a month's work is classified into — the table's pre-filled rows. */
export const MONTHLY_REPORT_PILLAR_NAMES = ['Growth', 'Affordability', 'Operating Model'] as const;
/** The error shown when a reply holds neither the table nor JSON — the words this round has always shown. */
const NO_REPLY_PAYLOAD_MESSAGE = 'No JSON found in the response.';
// A list inside one table cell is written "• first • second"; each bullet becomes its own line again.
const CELL_BULLET_PATTERN = /\s*•\s*/;
const BULLET_LINE_PREFIX = '• ';

/** The fill-in table: the pillar names down the side, the narrative fields across the top. */
const MONTHLY_REPORT_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'monthlyReport',
  replyMarker: 'MONTHLY_REPORT_TABLE:',
  columns: [
    { field: 'pillar', header: 'Pillar' },
    { field: 'initiativeName', header: 'Initiative name' },
    { field: 'productAreas', header: 'Product areas' },
    { field: 'accomplished', header: 'What was accomplished', answerHint: 'a list as "• first • second", all on one line' },
    { field: 'outcomes', header: 'Business outcomes' },
    { field: 'stakeholders', header: 'Stakeholders' },
  ],
};

// ── The prompt's reply form ──

/** The table column a narrative field is written in, so the prompt's questions name the column the reply uses. */
export function readMonthlyReportColumnHeader(fieldName: string): string {
  return MONTHLY_REPORT_REPLY_SPEC.columns.find((column) => column.field === fieldName)?.header ?? fieldName;
}

/** One pre-filled row per pillar, so the reply cannot invent a pillar. */
function listPillarRows(): string[][] {
  return MONTHLY_REPORT_PILLAR_NAMES.map((pillarName) => [pillarName]);
}

/**
 * The lines the Monthly Report prompt ends with: fill in the row of every pillar the work belongs to, leave the
 * other pillars' rows blank, then the table itself.
 */
export function buildMonthlyReportReplyForm(): string {
  return [
    'Fill in the row of every pillar this work belongs to, and leave the other pillars\' rows as ___. When the work '
      + 'spans more than one pillar, split the accomplishments between their rows.',
    'Inside one cell, write a list as "• first point • second point" on a single line.',
    buildRecordReplyInstructions(MONTHLY_REPORT_REPLY_SPEC, listPillarRows()),
  ].join('\n');
}

/** The follow-up for a reply that could not be read: the same table again, asking for the form only. */
export function buildMonthlyReportFollowUpPrompt(): string {
  return buildRecordFormatFixPrompt(MONTHLY_REPORT_REPLY_SPEC, listPillarRows());
}

// ── Reading a reply ──

/** A cell's "• a • b" list as one bullet per line; a cell with no bullets is kept as written. */
function restoreCellBulletLines(cellText: string): string {
  if (!cellText.includes('•')) {
    return cellText;
  }
  return cellText
    .split(CELL_BULLET_PATTERN)
    .filter((bulletText) => bulletText !== '')
    .map((bulletText) => `${BULLET_LINE_PREFIX}${bulletText}`)
    .join('\n');
}

/** One table row as an entry, or null when every narrative cell was left blank (the work is not in that pillar). */
function readPillarRow(tableItem: Record<string, unknown>): Record<string, unknown> | null {
  const entry: Record<string, unknown> = { pillar: tableItem.pillar };
  for (const [fieldName, cellValue] of Object.entries(tableItem)) {
    if (fieldName !== 'pillar' && typeof cellValue === 'string') entry[fieldName] = restoreCellBulletLines(cellValue);
  }
  return Object.keys(entry).length > 1 ? entry : null;
}

/** The first JSON array or object in a possibly-fenced reply — kept so a JSON reply from another assistant still reads. */
function extractJsonArrayOrObject(replyText: string): string {
  const firstBracket = replyText.indexOf('[');
  const lastBracket = replyText.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return replyText.slice(firstBracket, lastBracket + 1);
  }
  const firstBrace = replyText.indexOf('{');
  const lastBrace = replyText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(NO_REPLY_PAYLOAD_MESSAGE);
  }
  return replyText.slice(firstBrace, lastBrace + 1);
}

/**
 * The reply's pillar entries as raw records, for the caller's own field checks. A filled-in table is read first —
 * markdown or tab-separated, with any intro or closing offer around it — and its blank pillar rows are dropped. A
 * JSON array or single object is read as before. Throws "No JSON found in the response." when the reply is neither.
 */
export function readMonthlyReportReplyEntries(replyText: string): Record<string, unknown>[] {
  const tableItems = readRecordTableItems(replyText, MONTHLY_REPORT_REPLY_SPEC);
  if (tableItems && tableItems.length > 0) {
    return tableItems
      .map((tableItem) => readPillarRow(tableItem))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  // Table brackets such as "[CONFIRM]" are not JSON, so a reply that fails to parse reads as unreadable.
  let parsedReply: unknown;
  try {
    parsedReply = JSON.parse(extractJsonArrayOrObject(replyText));
  } catch {
    throw new Error(NO_REPLY_PAYLOAD_MESSAGE);
  }
  const rawEntries = Array.isArray(parsedReply) ? parsedReply : [parsedReply];
  return rawEntries.filter((rawEntry): rawEntry is Record<string, unknown> => Boolean(rawEntry) && typeof rawEntry === 'object');
}
