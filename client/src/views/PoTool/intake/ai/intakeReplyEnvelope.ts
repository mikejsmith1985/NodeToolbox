// intakeReplyEnvelope.ts — Reads the common `{ "kind": …, "items": [ … ] }` envelope every Epic Intake reply uses,
// turning a whole-reply problem into one plain sentence instead of a throw (spec 037, contracts/ai-rounds.md §0).

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';

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

function parsePayload(replyText: string): { payload: Record<string, unknown> | null; error: string | null } {
  let jsonText: string;
  try {
    jsonText = extractJsonPayload(replyText);
  } catch {
    return { payload: null, error: 'No JSON object was found in what you pasted.' };
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
 */
export function readReplyEnvelope(replyText: string, expectedKind: string): ReplyEnvelope {
  const { payload, error } = parsePayload(replyText);
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
