// replyListSections.ts — Small readers the rewrite rounds share for answers written as headed bullet lists.
//
// Google's AI Mode, the team's only assistant (GH #499), ignores a request for JSON and answers as a document: a short
// intro, headings, bullet lists, and a closing offer to help more. The condense rounds (document extract, corpus brief)
// therefore ask for exactly that shape — a labelled heading per list, one entry per line — and these helpers turn such a
// list back into entries. A reply from an assistant that still answers in JSON is recognised first and read as before.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';

// ── Named constants ──

// A list entry's leading mark: "- ", "• ", "* ", "◦ ", "1. ", "2) ".
const LIST_MARK_PATTERN = /^\s*(?:[•\-*–◦▪o]\s+|\d+[.)]\s+)/;
// Bold and code marks an assistant wraps around a whole entry.
const INLINE_MARK_PATTERN = /\*\*|__|`/g;
// An entry that only says the list is empty: "None", "None stated.", "(nothing recorded)", "N/A".
const EMPTY_ENTRY_PATTERN = /^\(?\s*(?:none|n\/a|nothing)(?:\s+(?:stated|recorded|found|identified|mentioned|noted|given|in this document|at this time))*\s*\.?\s*\)?$/i;
// A horizontal rule or a code fence line, which carry no content.
const DECORATION_LINE_PATTERN = /^\s*(?:[-*_]{3,}|```[\w-]*)\s*$/;

// ── Reading entries ──

/** One reply line as a plain entry: list mark and emphasis removed, trimmed. '' for a blank or decoration line. */
export function readListEntryText(replyLine: string): string {
  if (DECORATION_LINE_PATTERN.test(replyLine)) return '';
  return replyLine.replace(LIST_MARK_PATTERN, '').replace(INLINE_MARK_PATTERN, '').trim();
}

/** True when an entry only says its list is empty ("None stated."), so it is not kept as content. */
export function isEmptyListEntry(entryText: string): boolean {
  return EMPTY_ENTRY_PATTERN.test(entryText.trim());
}

/**
 * A section's text as its list entries: one per non-blank line, marks removed, "None" lines dropped. Lines are kept in
 * order; capping and de-duplicating stay with the round that owns the list.
 */
export function readListEntries(sectionText: string | undefined): string[] {
  if (sectionText === undefined) return [];
  return sectionText
    .split(/\r?\n/)
    .map(readListEntryText)
    .filter((entryText) => entryText !== '' && !isEmptyListEntry(entryText));
}

/**
 * The reply's JSON object when it is one that names a "kind" — the shape every round asked for before AI Mode — or null
 * when the reply is a document instead. A prose reply that happens to hold a stray brace is not mistaken for JSON.
 */
export function readKindedJsonReply(replyText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(replyText));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const payload = parsed as Record<string, unknown>;
    return payload.kind === undefined ? null : payload;
  } catch {
    return null;
  }
}
