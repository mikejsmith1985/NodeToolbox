// aiReplySections.ts — Reads a prose reply's named sections, whether written as "MARKER:" lines or as headings.
//
// Several AI rounds ask for fields as "SHORT_DESCRIPTION: …" lines. Google's AI Mode — the team's only assistant since
// 2026-11 (GH #499) — ignores the markers but does follow the structure: it writes a document with readable headings
// ("Short Description", "Risk and Impact Analysis", "Backout Plan"), an intro sentence, and a closing offer to help
// more. This reader finds each section by its marker OR its heading, drops the intro and the closing offer, and reports
// which sections are still missing so the round can offer a follow-up instead of a dead end.

// ── Types ──

/** One section a round reads: the marker its prompt asks for, and the headings an assistant writes for it instead. */
export interface ReplySection<TSectionKey extends string = string> {
  key: TSectionKey;
  /** The asked-for marker, e.g. "SHORT_DESCRIPTION". Matched in upper case, followed by ":" or "|". */
  marker: string;
  /** A heading written for this section, tested against the whole heading line once marks and a colon are removed. */
  headingPattern: RegExp;
}

// ── Named constants ──

/** A heading longer than this is a sentence, not a heading. */
const MAXIMUM_HEADING_LENGTH = 70;
// Markdown marks around a heading: "## Backout Plan", "**Backout Plan**", "__Backout Plan__".
const HEADING_MARK_PATTERN = /^#{1,6}\s*|\*\*|__/g;
// A line that is a list entry — "• Backout owner: …", "- Impact: High", "1. Deploy" — is content, never a heading.
const LIST_ENTRY_PATTERN = /^\s*(?:[•\-*–◦▪]|\d+[.)])\s+/;
// A parenthetical a heading carries: "Justification (Why it is needed)".
const PARENTHETICAL_PATTERN = /\s*\([^)]*\)\s*/g;
// A code fence line, which a code-block reply is wrapped in.
const CODE_FENCE_LINE_PATTERN = /^\s*```[\w-]*\s*$/;
// The closing offer an answer engine ends with: "If you provide the missing details…", "Let me know if…".
const CLOSING_OFFER_PATTERN = /^(?:if you(?:'d| would)? (?:like|want|provide|share|can|need|send|give)|let me know|would you like|do you want|i can also|feel free|happy to|want me to)/i;

// ── Reading a reply ──

/** A heading line's plain words: marks, a trailing colon and any parenthetical removed. */
function readHeadingText(replyLine: string): string {
  return replyLine.replace(HEADING_MARK_PATTERN, '').replace(PARENTHETICAL_PATTERN, ' ').trim().replace(/:$/, '').trim();
}

/** The section a line starts, with any text after its marker or heading, or null when the line does not start one. */
function readSectionStart<TSectionKey extends string>(
  replyLine: string,
  sections: readonly ReplySection<TSectionKey>[],
): { section: ReplySection<TSectionKey>; firstText: string } | null {
  const trimmedLine = replyLine.trim();
  // The asked-for marker first: "TEST_PLAN: …" — longest first, so DESCRIPTION is never read inside SHORT_DESCRIPTION.
  const markerSections = [...sections].sort((first, second) => second.marker.length - first.marker.length);
  for (const section of markerSections) {
    const markerMatch = new RegExp(`^\\**${section.marker}\\**\\s*[:|]\\s*(.*)$`, 'i').exec(trimmedLine);
    if (markerMatch) return { section, firstText: markerMatch[1] };
  }
  if (trimmedLine === '' || LIST_ENTRY_PATTERN.test(trimmedLine)) return null;
  // A heading alone on its line ("Backout Plan"), or a heading with its value after a colon ("Short Description: …").
  const colonIndex = trimmedLine.indexOf(':');
  const headingCandidates = [
    { headingText: readHeadingText(trimmedLine), firstText: '' },
    ...(colonIndex > 0 ? [{ headingText: readHeadingText(trimmedLine.slice(0, colonIndex)), firstText: trimmedLine.slice(colonIndex + 1).trim() }] : []),
  ];
  for (const { headingText, firstText } of headingCandidates) {
    if (headingText === '' || headingText.length > MAXIMUM_HEADING_LENGTH) continue;
    const section = sections.find((candidate) => candidate.headingPattern.test(headingText));
    if (section) return { section, firstText: firstText.replace(HEADING_MARK_PATTERN, '').trim() };
  }
  return null;
}

/** The section's text without the answer engine's closing offer and the blank lines around it. */
function trimSectionText(sectionLines: readonly string[]): string {
  const keptLines = [...sectionLines];
  const offerIndex = keptLines.findIndex((sectionLine) => CLOSING_OFFER_PATTERN.test(sectionLine.trim()));
  if (offerIndex !== -1) keptLines.splice(offerIndex);
  return keptLines.join('\n').trim();
}

/**
 * Each section's text, found by its marker or its heading. A section runs to the next section's start; text before the
 * first section (an intro, a block of header facts) is dropped, and so is a closing offer to help further. A section
 * named a second time is read as text of the section it appears in.
 */
export function readReplySections<TSectionKey extends string>(
  replyText: string,
  sections: readonly ReplySection<TSectionKey>[],
): Partial<Record<TSectionKey, string>> {
  const sectionLines = new Map<TSectionKey, string[]>();
  let currentLines: string[] | null = null;
  for (const replyLine of replyText.split(/\r?\n/)) {
    if (CODE_FENCE_LINE_PATTERN.test(replyLine)) continue;
    const sectionStart = readSectionStart(replyLine, sections);
    // A section named again is quoted inside another one ("Description: …" in a plan's step) — it stays that one's text.
    if (sectionStart && !sectionLines.has(sectionStart.section.key)) {
      currentLines = [sectionStart.firstText];
      sectionLines.set(sectionStart.section.key, currentLines);
      continue;
    }
    currentLines?.push(replyLine);
  }
  const sectionTexts: Partial<Record<TSectionKey, string>> = {};
  for (const [sectionKey, linesOfSection] of sectionLines) {
    const sectionText = trimSectionText(linesOfSection);
    if (sectionText !== '') sectionTexts[sectionKey] = sectionText;
  }
  return sectionTexts;
}

/** The sections a reply left out, in the round's own order. */
export function listMissingSections<TSectionKey extends string>(
  sectionTexts: Partial<Record<TSectionKey, string>>,
  sections: readonly ReplySection<TSectionKey>[],
): ReplySection<TSectionKey>[] {
  return sections.filter((section) => !sectionTexts[section.key]);
}

/**
 * The follow-up for a reply that left sections out or could not be read: only those sections, each to start on its own
 * line with its marker. It asks for the missing text only, so what the reply already gave is kept.
 */
export function buildSectionsFollowUpPrompt(missingSections: readonly ReplySection[], wasReplyUnreadable: boolean): string {
  const openingLine = wasReplyUnreadable
    ? 'Your last reply was not in the form I need, so it could not be read. Keep what you wrote, but lay it out as below.'
    : `Your last reply did not include ${missingSections.map((section) => section.marker).join(', ')}. Write only those now.`;
  return [
    openingLine,
    'Start each one on its own line with its label exactly as written below, followed by a colon and its text. Write '
      + 'nothing before the first label or after the last one, and ask no questions — give your best judgement.',
    '',
    ...missingSections.map((section) => `${section.marker}: [text]`),
  ].join('\n');
}
