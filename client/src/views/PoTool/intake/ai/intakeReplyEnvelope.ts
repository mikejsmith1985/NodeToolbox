// intakeReplyEnvelope.ts — Reads the common `{ "kind": …, "items": [ … ] }` envelope every Epic Intake reply uses,
// turning a whole-reply problem into one plain sentence instead of a throw (spec 037, contracts/ai-rounds.md §0).
//
// Google's AI Mode — the team's only assistant — ignores a JSON reply format and answers as a document, so every round
// now asks for a fill-in table that already lists each item (GH #499). Given the round's table spec, this reader turns
// that table back into the same envelope, so each round's own checks keep applying unchanged; JSON is still read.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  type ReplyRecordSpec,
} from '../../../../utils/aiReplyRecords.ts';
import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';

/** A request ready to copy out: its text, and the ids of the items it asks about (the only ids a reply may use). */
export interface IntakeRoundRequest {
  text: string;
  itemIds: string[];
}

/** One raw item from a reply, not yet validated. */
export type RawReplyItem = Record<string, unknown>;

/** The envelope's items and any top-level extras, or the single reason the reply as a whole could not be used. */
export interface ReplyEnvelope {
  items: RawReplyItem[];
  payload: Record<string, unknown>;
  wholeReplyError: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a reply with neither the table nor JSON is told: the follow-up asks the same chat for the table. */
export const UNREADABLE_TABLE_REPLY_ERROR = 'The answer table was not found in what you pasted — copy the follow-up below into the same chat.';

function parsePayload(replyText: string, tableSpec?: ReplyRecordSpec): { payload: Record<string, unknown> | null; error: string | null } {
  let jsonText: string;
  try {
    jsonText = tableSpec ? extractRecordReplyPayload(replyText, tableSpec) : extractJsonPayload(replyText);
  } catch {
    return { payload: null, error: tableSpec ? UNREADABLE_TABLE_REPLY_ERROR : 'No JSON object was found in what you pasted.' };
  }
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return isPlainObject(parsed)
      ? { payload: parsed, error: null }
      : { payload: null, error: 'What you pasted is JSON, but not an object.' };
  } catch {
    return { payload: null, error: 'What you pasted is not valid JSON — copy the whole answer and try again.' };
  }
}

/**
 * Pulls the items out of a pasted reply of the expected kind. Never throws: a missing, malformed or wrong-kind
 * reply comes back as `wholeReplyError` so the PO can simply paste again, and it costs no decision an attempt.
 * With a table spec, the round's fill-in table is read first and a JSON reply second.
 */
export function readReplyEnvelope(replyText: string, expectedKind: string, tableSpec?: ReplyRecordSpec): ReplyEnvelope {
  const { payload, error } = parsePayload(replyText, tableSpec);
  if (payload === null) {
    return { items: [], payload: {}, wholeReplyError: error };
  }
  if (payload.kind !== expectedKind) {
    return { items: [], payload, wholeReplyError: `This answer is for "${String(payload.kind)}", not "${expectedKind}".` };
  }
  if (!Array.isArray(payload.items)) {
    return { items: [], payload, wholeReplyError: 'The answer has no "items" list.' };
  }
  return { items: payload.items.filter(isPlainObject), payload, wholeReplyError: null };
}

/** Matches a reply's item id to a known id, ignoring case and surrounding spaces; null when it is not one of them. */
export function resolveItemId(rawId: unknown, knownItemIds: readonly string[]): string | null {
  if (typeof rawId !== 'string') {
    return null;
  }
  const normalizedId = rawId.trim().toLowerCase();
  return knownItemIds.find((knownId) => knownId.toLowerCase() === normalizedId) ?? null;
}

/** A trimmed non-empty string no longer than `maxLength`, or null. */
export function readBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmedValue = value.trim();
  return trimmedValue !== '' && trimmedValue.length <= maxLength ? trimmedValue : null;
}

/** Matches a value to one of a closed vocabulary, ignoring case; returns the vocabulary's own spelling. */
export function readVocabularyValue<TValue extends string>(value: unknown, vocabulary: readonly TValue[]): TValue | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalizedValue = value.trim().toLowerCase();
  return vocabulary.find((candidate) => candidate.toLowerCase() === normalizedValue) ?? null;
}

// ── Fill-in table follow-ups ──

/** A cell's text made safe for one table cell: one line, no "|" that would split it. */
export function sanitizeTableCell(cellText: string): string {
  return cellText.replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '/').trim();
}

/** The item ids the request asked about that the parsed answer left out entirely, in the request's order. */
export function listUnansweredItemIds(askedItemIds: readonly string[], answeredItemIds: readonly string[]): string[] {
  const answered = new Set(answeredItemIds);
  return askedItemIds.filter((itemId) => !answered.has(itemId));
}

/**
 * The follow-up for a table round, for the SAME chat: the whole table again when the reply could not be read, only
 * the rows it left out when it skipped items, and '' when every asked item came back. It asks for the form or the
 * missing rows only — nothing is ever filled in on the assistant's behalf.
 */
export function buildTableFollowUpPrompt(
  tableSpec: ReplyRecordSpec,
  rowNamingCells: readonly (readonly string[])[],
  wasReplyUnreadable: boolean,
  unansweredItemIds: readonly string[],
): string {
  if (wasReplyUnreadable) {
    return buildRecordFormatFixPrompt(tableSpec, rowNamingCells);
  }
  const missingRows = rowNamingCells.filter((namingCells) => unansweredItemIds.includes(namingCells[0]));
  if (missingRows.length === 0) {
    return '';
  }
  return [
    `Your last reply did not answer ${missingRows.map((namingCells) => namingCells[0]).join(', ')} in full. Answer only those now, in this table.`,
    buildRecordReplyInstructions(tableSpec, missingRows),
  ].join('\n');
}
