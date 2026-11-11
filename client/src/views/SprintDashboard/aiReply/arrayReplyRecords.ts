// arrayReplyRecords.ts — Reads a Team Dashboard AI round's reply as a filled-in table, or as the JSON array it used to ask for.
//
// The pointing and risk rounds once asked for a bare JSON array. Google's AI Mode — the team's only assistant since
// 2026-11 (GH #499) — ignores reply syntax and answers in tables, so each round now ends with a pre-filled table and
// reads it back here. A JSON array from any other assistant still reads exactly as before. The shared record reader
// (utils/aiReplyRecords.ts) only falls back to a JSON *object*, which is why these array rounds need this thin layer.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  readRecordTableItems,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';

// ── Types ──

/** What a pasted reply turned out to be: the round's table, a JSON array, or neither (with why). */
export type ArrayReplyReading =
  | { source: 'table'; items: Record<string, unknown>[] }
  | { source: 'json'; items: unknown[] }
  | { source: 'none'; failure: 'noPayload' | 'invalidJson' | 'notArray' };

// ── Named constants ──

// The outermost [...] span in a reply — how the old JSON-array form was found inside prose.
const JSON_ARRAY_SPAN_PATTERN = /\[[\s\S]*\]/;

// ── Reading ──

/** The JSON-array reading of a reply, exactly as the rounds read it before the table existed. */
function readJsonArrayReply(replyText: string): ArrayReplyReading {
  const arrayMatch = JSON_ARRAY_SPAN_PATTERN.exec(replyText);
  if (!arrayMatch) return { source: 'none', failure: 'noPayload' };
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(arrayMatch[0]);
  } catch {
    return { source: 'none', failure: 'invalidJson' };
  }
  return Array.isArray(parsedValue) ? { source: 'json', items: parsedValue } : { source: 'none', failure: 'notArray' };
}

/**
 * The reply read as this round's table first (what the prompt asks for), then as a JSON array. A table with no
 * filled row falls through to the JSON reading, so a reply that merely quotes the header is not mistaken for answers.
 */
export function readArrayOrTableReply(replyText: string, spec: ReplyRecordSpec): ArrayReplyReading {
  const tableItems = readRecordTableItems(replyText, spec);
  if (tableItems && tableItems.length > 0) return { source: 'table', items: tableItems };
  return readJsonArrayReply(replyText);
}

// ── Follow-ups ──

/** The asked keys a reply did not answer usably, in the order they were asked. Compared case-insensitively. */
export function listUnansweredKeys(askedKeys: readonly string[], answeredKeys: ReadonlySet<string>): string[] {
  return askedKeys.filter((askedKey) => !answeredKeys.has(askedKey.trim().toUpperCase()));
}

/**
 * The follow-up for a table that left rows out or blank: only those rows, in the same table. It asks for nothing
 * the reply already answered, and Toolbox never fills the gap itself.
 */
export function buildMissingRowsFollowUpPrompt(spec: ReplyRecordSpec, missingKeys: readonly string[]): string {
  if (missingKeys.length === 0) return '';
  return [
    `Your last reply left out or left blank ${missingKeys.join(', ')}. Answer only these now, in the same table.`,
    buildRecordReplyInstructions(spec, missingKeys.map((missingKey) => [missingKey])),
  ].join('\n');
}

/** The follow-up for a reply that could not be read at all: the whole table again, asking for the form only. */
export function buildArrayFormatFixPrompt(spec: ReplyRecordSpec, askedKeys: readonly string[]): string {
  return askedKeys.length === 0 ? '' : buildRecordFormatFixPrompt(spec, askedKeys.map((askedKey) => [askedKey]));
}
