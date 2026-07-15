// confluenceStorageText.ts — Reduces Confluence storage-format markup to readable plain text.
//
// Why this exists: the server has an equivalent stripper, but it is CommonJS under `src/` and cannot be
// imported by the React client. This is the client-side counterpart, used when a Confluence page is
// pulled into a workspace as reference material.
//
// Why text and not HTML: the page is reference reading, not something to re-render. Injecting remote
// markup would mean `dangerouslySetInnerHTML` on content this app does not control, and there is no
// sanitizer in the project — a real XSS surface for zero benefit. Text is all the workspace needs.
//
// This goes slightly further than the server's version, which only has to satisfy a machine parser:
// it also drops script/style CONTENT, breaks table cells onto their own lines, and collapses blank
// runs — because a human reads this.

/** Elements whose content must never survive into the text — their bodies are not readable prose. */
const NON_CONTENT_ELEMENT_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Confluence wraps macros in these; the wrapper is noise but the rich-text body inside is real content. */
const MACRO_PARAMETER_PATTERN = /<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi;

/** A line break in the source is a line break in the reading. */
const LINE_BREAK_PATTERN = /<br\s*\/?>/gi;

/** Closing a block element ends a line, matching how the rendered page reads. */
const BLOCK_ELEMENT_CLOSE_PATTERN = /<\/(p|div|h[1-6]|li|td|th|tr|blockquote)>/gi;

/** Any remaining markup, once the structural cases above have had their say. */
const ANY_TAG_PATTERN = /<[^>]+>/g;

/** Three or more line breaks read as a gap; two is enough, and blank-only lines add nothing. */
const BLANK_LINE_RUN_PATTERN = /\n\s*\n+/g;

/** The named entities Confluence actually emits. Ordered so `&amp;` is decoded last. */
const HTML_ENTITY_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  // Last: decoding this first would turn "&amp;lt;" into "<" instead of the literal "&lt;".
  [/&amp;/gi, '&'],
];

/**
 * Converts a Confluence page's storage-format value into readable plain text.
 *
 * Safe to call with any string — an empty or unreadable page yields empty text rather than throwing,
 * because a source that cannot be read must never take the workspace down with it.
 */
export function readConfluenceStorageText(storageValue: string): string {
  const decodedText = String(storageValue ?? '')
    .replace(NON_CONTENT_ELEMENT_PATTERN, '')
    .replace(MACRO_PARAMETER_PATTERN, '')
    .replace(LINE_BREAK_PATTERN, '\n')
    .replace(BLOCK_ELEMENT_CLOSE_PATTERN, '\n')
    .replace(ANY_TAG_PATTERN, '');

  const withDecodedEntities = HTML_ENTITY_REPLACEMENTS.reduce(
    (text, [entityPattern, replacement]) => text.replace(entityPattern, replacement),
    decodedText,
  );

  return withDecodedEntities
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(BLANK_LINE_RUN_PATTERN, '\n')
    .trim();
}
