// useMentionTrigger.ts — Decides when typing "@" means "tag someone", and inserts the result.
//
// Everything here is a pure function over the draft text and the caret position: no React state and
// no DOM access, so the rules that decide whether a popup appears while someone is typing can be
// tested exhaustively without rendering anything.
//
// The word-boundary rule is the important one. Opening the picker on ANY "@" would fire in the
// middle of every email address a user ever types, leaving them to notice and dismiss it each time.
// Requiring the "@" to begin a word means an email address simply never triggers it — the same
// convention Slack, GitHub, and Jira itself use.

/** Below this many characters a search matches too much to be useful and is not worth a request. */
export const MIN_MENTION_QUERY_LENGTH = 2;

/** The live mention query: where its "@" sits, and what has been typed since. */
export interface ActiveMentionQuery {
  atIndex: number;
  query: string;
}

/** The draft text and caret position after inserting a mention. */
export interface MentionInsertion {
  text: string;
  caretIndex: number;
}

/** True when the character is whitespace, which is what makes a following "@" begin a word. */
function isWhitespaceCharacter(character: string): boolean {
  return /\s/.test(character);
}

/**
 * True when the "@" at `atIndex` begins a word — at the start of the draft, or straight after
 * whitespace. Anything else (a letter, a bracket, another "@") means this is not a tag attempt.
 */
export function isMentionTriggerPosition(draftText: string, atIndex: number): boolean {
  if (draftText[atIndex] !== '@') {
    return false;
  }
  if (atIndex === 0) {
    return true;
  }
  return isWhitespaceCharacter(draftText[atIndex - 1]);
}

/**
 * Finds the mention being typed at the caret, or null when the user is not tagging anyone.
 *
 * Scans back from the caret for an "@" that begins a word, stopping at the first whitespace since a
 * mention query is a single token — so typing a space closes the picker.
 */
export function readActiveMentionQuery(draftText: string, caretIndex: number): ActiveMentionQuery | null {
  for (let scanIndex = caretIndex - 1; scanIndex >= 0; scanIndex -= 1) {
    const character = draftText[scanIndex];
    if (isWhitespaceCharacter(character)) {
      return null;
    }
    if (character === '@') {
      return isMentionTriggerPosition(draftText, scanIndex)
        ? { atIndex: scanIndex, query: draftText.slice(scanIndex + 1, caretIndex) }
        : null;
    }
  }
  return null;
}

/**
 * Replaces the "@query" being typed with a real mention token, leaving the rest of the draft exactly
 * as it was. A trailing space is added so the user can carry straight on typing, and the caret is
 * reported so the composer can place it there.
 */
export function insertMentionAtTrigger(
  draftText: string,
  atIndex: number,
  caretIndex: number,
  tokenRaw: string,
): MentionInsertion {
  const textBeforeMention = draftText.slice(0, atIndex);
  const textAfterQuery = draftText.slice(caretIndex);
  const insertedText = `${tokenRaw} `;

  return {
    text: `${textBeforeMention}${insertedText}${textAfterQuery}`,
    caretIndex: textBeforeMention.length + insertedText.length,
  };
}
