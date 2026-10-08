// assistantReplyText.ts — Recovers a pasted assistant reply whose line breaks were lost in copying (GH #395).
//
// Every AI Assist reply is read line by line: a field marker or a review verdict must start its own line.
// But chat assistants render their answer as formatted text, and copying formatted text collapses single
// line breaks — the whole reply arrives as one paragraph, nothing is found at a line start, and nothing is
// applied. Two defences: the prompts ask for the reply inside a code block (copying a code block keeps its
// line breaks), and the readers put the known markers back on their own lines before reading.

/** Asks for the reply inside one code block, whose line breaks survive copying. */
export const CODE_BLOCK_REPLY_INSTRUCTION =
  'Put your ENTIRE reply inside ONE code block that starts with ```text and ends with ```, so its line breaks '
  + 'survive when it is copied. Write nothing outside the code block.';

/**
 * The reply rule for a round where the assistant may ask the owner questions first. Under the plain rule ("write
 * nothing outside the code block") it put its question in a code block too — and the owner pasted the question
 * back as if it were the reply (GH #415).
 */
export const CONVERSATIONAL_REPLY_INSTRUCTION =
  'Ask your questions as normal chat messages — never in a code block. When every question is answered, only your '
  + 'FINAL reply — the fields — goes in ONE code block that starts with ```text and ends with ```, so its line '
  + 'breaks survive when it is copied.';

/** What to tell the owner when the pasted text is the assistant's question rather than its final reply. */
export const PASTED_QUESTION_MESSAGE =
  'That is the assistant\'s question — answer it in the AI chat, then paste its final reply (the fields) here.';

// A reply's field marker at a line start, e.g. "BACKOUT_PLAN:" or "CTASK0012345_BACKOUT_PLAN:".
const FIELD_MARKER_LINE_PATTERN = /^\s*[A-Z][A-Z0-9_]+:/m;

/** True when pasted text holds no field markers but asks something — the assistant's question, not its reply. */
export function isAssistantQuestion(replyText: string): boolean {
  const pastedText = stripCodeFences(replyText);
  return !FIELD_MARKER_LINE_PATTERN.test(pastedText) && pastedText.includes('?');
}

/** The seven field markers a drafting or correcting reply uses, in the order the prompts ask for them. */
export const CHG_FIELD_REPLY_MARKERS: readonly string[] = [
  'SHORT_DESCRIPTION',
  'DESCRIPTION',
  'JUSTIFICATION',
  'RISK_AND_IMPACT',
  'IMPLEMENTATION_PLAN',
  'TEST_PLAN',
  'BACKOUT_PLAN',
];

// A line that is only a code fence, optionally naming its language (```, ```text, ```markdown).
const CODE_FENCE_LINE_PATTERN = /^\s*```[\w-]*\s*$/;

/** Removes the fence lines a code-block reply is wrapped in, keeping everything between them. */
export function stripCodeFences(replyText: string): string {
  return replyText
    .split(/\r?\n/)
    .filter((replyLine) => !CODE_FENCE_LINE_PATTERN.test(replyLine))
    .join('\n')
    .trim();
}

/** Escapes a marker for use inside a regular expression ("N/A" has a slash, others may one day have more). */
function escapeForPattern(marker: string): string {
  return marker.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Puts each marker back at the start of its own line. A marker is recognised only in upper case, only when
 * a space or tab precedes it (so DESCRIPTION inside SHORT_DESCRIPTION is left alone), and only when a colon
 * or pipe follows it — ordinary words in the reply's prose never match.
 */
export function restoreMarkerLineBreaks(replyText: string, markers: readonly string[]): string {
  // Longest first, so a marker that begins another is never preferred over it.
  const markerAlternatives = [...markers]
    .sort((firstMarker, secondMarker) => secondMarker.length - firstMarker.length)
    .map((marker) => escapeForPattern(marker))
    .join('|');
  const markerPattern = new RegExp(`[ \\t]+(?=(?:${markerAlternatives})\\s*[:|])`, 'g');
  return replyText.replace(markerPattern, '\n');
}
