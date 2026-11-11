// corpusBrief.ts — Turning thirty document extracts into the one brief a re-write can carry.
//
// Extracting each document (documentExtract.ts) shrinks the corpus by a factor of ten, and it is
// still too big. Thirty extracts at roughly eight hundred characters each is twenty-four thousand,
// against a prompt cap of sixteen thousand that also has to hold the issues being re-written. The
// map halves the problem; it does not finish it.
//
// So the extracts are consolidated once more, into a single brief. This is the step that pays for
// the structure the extracts were forced into:
//
//   - the same decision recorded in six documents collapses to ONE line, and six documents' worth of
//     budget comes back;
//   - two documents that disagree stop being two plausible statements in a pile and become a named
//     CONFLICT, which is the single most valuable thing to hand a PO — a contradiction nobody spotted
//     is how a Feature gets written against last year's answer;
//   - every line keeps the documents behind it, so the brief can be challenged and checked rather
//     than trusted.
//
// The brief is what the batch is re-written from. That makes its provenance load-bearing, not a nicety.
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores a request for JSON, so the prompt asks for five
// labelled headings with one "- point [Source; Source]" line each, conflicts as a subject line with its positions
// indented beneath. A JSON reply is still read.
//
// Pure: no fetch, no storage, no clock.

import {
  buildSectionsFollowUpPrompt,
  listMissingSections,
  readReplySections,
  type ReplySection,
} from '../../../../utils/aiReplySections.ts';
import { renderDocumentExtract } from './documentExtract.ts';
import type { DocumentExtract } from './documentExtract.ts';
import { isEmptyListEntry, readKindedJsonReply, readListEntries, readListEntryText } from './replyListSections.ts';

export const CORPUS_BRIEF_REPLY_KIND = 'corpusBrief';

/** The five parts of a brief, as the reply's headings name them. */
type BriefSectionKey = 'overview' | 'conflicts' | 'decisions' | 'requirements' | 'openQuestions';

/** Each heading the prompt asks for, and the headings an answer engine writes for it instead. */
const BRIEF_SECTIONS: readonly ReplySection<BriefSectionKey>[] = [
  { key: 'overview', marker: 'OVERVIEW', headingPattern: /^(?:overview|summary|brief overview)$/i },
  { key: 'conflicts', marker: 'CONFLICTS', headingPattern: /^(?:conflicts|contradictions|disagreements)$/i },
  { key: 'decisions', marker: 'DECISIONS', headingPattern: /^(?:key )?decisions?(?: made)?$/i },
  { key: 'requirements', marker: 'REQUIREMENTS', headingPattern: /^(?:key )?requirements$/i },
  { key: 'openQuestions', marker: 'OPEN_QUESTIONS', headingPattern: /^open (?:questions|issues)$|^unresolved questions$/i },
];

/** The error shown when a reply is neither the headed lists nor JSON — the wording every round already uses. */
const UNREADABLE_REPLY_MESSAGE = 'No JSON object found in the assistant response.';
// Where a point names its documents: "[Doc A; Doc B]", "(Sources: Doc A, Doc B)", "— Source: Doc A".
const BRACKETED_SOURCES_PATTERN = /\s*\[([^\]]+)\]\s*\.?$/;
const LABELLED_SOURCES_PATTERN = /\s*(?:\(\s*(?:sources?|from)\s*:\s*([^)]+)\)|[—–-]\s*sources?\s*:\s*(.+))\s*\.?$/i;
// A conflict's subject line may carry its own label: "Subject: Runout ownership".
const SUBJECT_LABEL_PATTERN = /^(?:subject|topic|conflict)\s*:\s*/i;
// A line indented under another, or marked as a sub-entry ("◦", "o"), is a position under the conflict above it.
const NESTED_ENTRY_PATTERN = /^(?:\s{2,}|\t)|^\s*[◦o]\s+/;

/**
 * The most extract text one consolidation prompt carries.
 *
 * Deliberately larger than a re-write prompt: this prompt holds nothing but extracts, and the whole
 * value of consolidating is that every extract is present at once. An extract left out of this step
 * cannot be de-duplicated against, and its contradictions go unnoticed.
 */
export const MAX_EXTRACT_CHARS_PER_PROMPT = 40000;

/** One consolidated statement, and the documents that support it. */
export interface BriefPoint {
  text: string;
  /** Titles of the documents this came from. Empty when the reply named none that we recognise. */
  sourceTitles: string[];
}

/** Two documents saying different things about the same subject. */
export interface BriefConflict {
  subject: string;
  /** Each side, as its document put it. */
  positions: BriefPoint[];
}

/** The consolidated corpus, small enough to ride in every re-write prompt. */
export interface CorpusBrief {
  /** What this body of material is about, in a few sentences. */
  overview: string;
  decisions: BriefPoint[];
  requirements: BriefPoint[];
  openQuestions: BriefPoint[];
  conflicts: BriefConflict[];
  /** How many extracts fed it, so a brief built from half the corpus cannot pass as the whole. */
  extractCount: number;
  builtAtIso: string;
}

/** Renders the extracts, stopping at the cap and saying plainly which ones did not fit. */
function renderExtractsWithinBudget(extracts: readonly DocumentExtract[]): { text: string; omittedTitles: string[] } {
  const renderedBlocks: string[] = [];
  const omittedTitles: string[] = [];
  let usedChars = 0;

  extracts.forEach((extract) => {
    const block = renderDocumentExtract(extract);
    if (usedChars + block.length > MAX_EXTRACT_CHARS_PER_PROMPT && renderedBlocks.length > 0) {
      omittedTitles.push(extract.sourceTitle);
      return;
    }
    renderedBlocks.push(block);
    usedChars += block.length;
  });

  return { text: renderedBlocks.join('\n\n'), omittedTitles };
}

/**
 * Builds the prompt that consolidates every extract into one brief.
 *
 * Returns an empty string when there is nothing to consolidate. One extract needs no consolidation
 * either — it IS the brief already, and asking for a round trip to restate it wastes somebody's time
 * for no gain.
 */
export function buildCorpusBriefPrompt(extracts: readonly DocumentExtract[]): string {
  if (extracts.length < 2) {
    return '';
  }

  const { text: extractsText, omittedTitles } = renderExtractsWithinBudget(extracts);

  return [
    `You are consolidating ${extracts.length} document extracts into ONE brief. That brief is the only`,
    'form in which this material reaches the work it informs, so anything you leave out is gone.',
    '',
    'Do three things, in this order of importance:',
    '  1. Where several documents say the same thing, write it ONCE and name all of them.',
    '  2. Where two documents DISAGREE, record it as a conflict with both positions and their sources.',
    '     Do not pick a winner and do not smooth it over — an unnoticed contradiction is exactly what',
    '     this step exists to catch.',
    '  3. Keep every decision, requirement and open question that survives that, with its sources.',
    '',
    'Use the document titles below verbatim as sources. Do not add material that is not in an extract.',
    ...(omittedTitles.length === 0
      ? []
      : ['', `NOTE: these extracts did not fit and are NOT below: ${omittedTitles.join(', ')}.`]),
    '',
    '--- extracts ---',
    extractsText,
    '--- end of extracts ---',
    '',
    ...describeBriefReplyForm(),
  ].join('\n');
}

/**
 * The reply form: five labelled headings, one point per line with its documents in square brackets. An answer engine
 * follows headings and bullet lists; it does not follow a JSON template.
 */
function describeBriefReplyForm(): string[] {
  return [
    'Answer with exactly these five labels, each on its own line and in this order. Under OVERVIEW write a few',
    'sentences. Under each other label put one point per line, starting with "- " and ending with its document',
    'titles in square brackets, separated by ";" — for example: - Statements are consolidated [Doc A; Doc B].',
    'Under CONFLICTS put each subject on its own line starting with "- ", and each position on an indented line',
    'beneath it: "    - what one document says [Doc A]". Under a label with nothing to record, write "- None".',
    'Do not answer in JSON or a table, write nothing before the first label or after the last, and ask no questions.',
    ...BRIEF_SECTIONS.map((section) => `${section.marker}:`),
  ];
}

/** Coerces one reply entry into a point, keeping only source titles the extracts actually carried. */
function readPoint(value: unknown, knownTitles: ReadonlySet<string>): BriefPoint | null {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (text === '') {
    return null;
  }

  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  const sourceTitles: string[] = [];
  rawSources.forEach((rawTitle) => {
    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
    // An invented title is dropped rather than shown. Provenance that cannot be followed back to a
    // document is worse than none: it reads as verified and is not.
    if (title !== '' && knownTitles.has(title) && !sourceTitles.includes(title)) {
      sourceTitles.push(title);
    }
  });

  return { text, sourceTitles };
}

/** Reads a list of points, dropping the unusable ones. */
function readPointList(value: unknown, knownTitles: ReadonlySet<string>): BriefPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readPoint(entry, knownTitles))
    .filter((point): point is BriefPoint => point !== null);
}

/** Reads the conflicts, keeping only those that actually have a subject and a position. */
function readConflicts(value: unknown, knownTitles: ReadonlySet<string>): BriefConflict[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const conflicts: BriefConflict[] = [];
  value.forEach((entry) => {
    const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const subject = typeof record.subject === 'string' ? record.subject.trim() : '';
    const positions = readPointList(record.positions, knownTitles);
    if (subject !== '' && positions.length > 0) {
      conflicts.push({ subject, positions });
    }
  });
  return conflicts;
}

// ── Reading a headed-list reply ──

/**
 * One point line as the {text, sources} object the JSON form carried. Every candidate title is passed on — a title
 * split on ";" and, in case the assistant used commas, on "," too — and readPoint keeps only titles a document had.
 */
function readPointLine(entryText: string): { text: string; sources: string[] } {
  const sourcesMatch = BRACKETED_SOURCES_PATTERN.exec(entryText) ?? LABELLED_SOURCES_PATTERN.exec(entryText);
  if (!sourcesMatch) return { text: entryText.trim(), sources: [] };
  const sourcesText = sourcesMatch[1] ?? sourcesMatch[2] ?? '';
  const sources = sourcesText.split(';').flatMap((sourcePiece) => [sourcePiece.trim(), ...sourcePiece.split(',').map((title) => title.trim())]);
  return { text: entryText.slice(0, sourcesMatch.index).trim(), sources };
}

/** A section's lines as point objects. */
function readPointLines(sectionText: string | undefined): { text: string; sources: string[] }[] {
  return readListEntries(sectionText).map(readPointLine);
}

/** True when a conflict line is a position (indented, a sub-entry, or naming its documents) rather than a subject. */
function isConflictPositionLine(replyLine: string, entryText: string): boolean {
  return NESTED_ENTRY_PATTERN.test(replyLine) || BRACKETED_SOURCES_PATTERN.test(entryText) || LABELLED_SOURCES_PATTERN.test(entryText);
}

/**
 * The conflicts section as {subject, positions} objects: a subject line, then the position lines beneath it. A
 * position with no subject above it is dropped — readConflicts already refuses a conflict without a subject.
 */
function readConflictLines(sectionText: string | undefined): { subject: string; positions: { text: string; sources: string[] }[] }[] {
  const conflicts: { subject: string; positions: { text: string; sources: string[] }[] }[] = [];
  for (const replyLine of (sectionText ?? '').split(/\r?\n/)) {
    const entryText = readListEntryText(replyLine);
    if (entryText === '' || isEmptyListEntry(entryText)) continue;
    if (isConflictPositionLine(replyLine, entryText)) {
      conflicts[conflicts.length - 1]?.positions.push(readPointLine(entryText));
      continue;
    }
    conflicts.push({ subject: entryText.replace(SUBJECT_LABEL_PATTERN, '').replace(/:$/, '').trim(), positions: [] });
  }
  return conflicts;
}

/**
 * The reply as the same field object the JSON form carried: a JSON reply is checked for its kind, a headed-list reply
 * is read section by section. Throws when the reply is neither, so the panel says it could not be read.
 */
function readBriefReplyFields(replyText: string): Record<string, unknown> {
  const jsonPayload = readKindedJsonReply(replyText);
  if (jsonPayload !== null) {
    if (jsonPayload.kind !== CORPUS_BRIEF_REPLY_KIND) {
      throw new Error(`Expected an AI reply with {"kind":"${CORPUS_BRIEF_REPLY_KIND}"}, got "${String(jsonPayload.kind)}".`);
    }
    return jsonPayload;
  }
  const sectionTexts = readReplySections(replyText, BRIEF_SECTIONS);
  if (Object.keys(sectionTexts).length === 0) {
    throw new Error(UNREADABLE_REPLY_MESSAGE);
  }
  return {
    overview: readListEntries(sectionTexts.overview).join(' '),
    conflicts: readConflictLines(sectionTexts.conflicts),
    decisions: readPointLines(sectionTexts.decisions),
    requirements: readPointLines(sectionTexts.requirements),
    openQuestions: readPointLines(sectionTexts.openQuestions),
  };
}

/**
 * The follow-up for the same AI chat after a brief reply, or '' when none is needed.
 *
 * An unreadable reply gets the whole form again; a reply that left headings out gets only those. A brief REPLACES the
 * one before it, so the panel does not build one from a partial reply: the answer to this follow-up is pasted under
 * the first reply and the two are read together.
 */
export function buildCorpusBriefFollowUpPrompt(replyText: string): string {
  if (readKindedJsonReply(replyText) !== null) return '';
  const sectionTexts = readReplySections(replyText, BRIEF_SECTIONS);
  const wasReplyUnreadable = Object.keys(sectionTexts).length === 0;
  const missingSections = wasReplyUnreadable ? [...BRIEF_SECTIONS] : listMissingSections(sectionTexts, BRIEF_SECTIONS);
  if (missingSections.length === 0) return '';
  return [
    buildSectionsFollowUpPrompt(missingSections, wasReplyUnreadable),
    'Under each label put one point per line starting with "- " and ending with its document titles in square',
    'brackets, or "- None" when there is nothing to record.',
  ].join('\n');
}

/** The headings a brief reply left out, by label — so the panel can name them. Empty for a JSON reply. */
export function listMissingCorpusBriefSections(replyText: string): string[] {
  if (readKindedJsonReply(replyText) !== null) return [];
  const sectionTexts = readReplySections(replyText, BRIEF_SECTIONS);
  if (Object.keys(sectionTexts).length === 0) return [];
  return listMissingSections(sectionTexts, BRIEF_SECTIONS).map((section) => section.marker);
}

/**
 * Parses one `{kind:'corpusBrief'}` reply.
 *
 * The extracts are supplied so that every source title in the reply can be checked against the
 * documents that were actually read. Throws only when the reply is unusable as a whole.
 */
export function parseCorpusBriefReply(
  replyText: string,
  extracts: readonly DocumentExtract[],
  builtAtIso: string,
): CorpusBrief {
  const parsed = readBriefReplyFields(replyText);
  const knownTitles = new Set(extracts.map((extract) => extract.sourceTitle));

  return {
    overview: typeof parsed.overview === 'string' ? parsed.overview.trim() : '',
    decisions: readPointList(parsed.decisions, knownTitles),
    requirements: readPointList(parsed.requirements, knownTitles),
    openQuestions: readPointList(parsed.openQuestions, knownTitles),
    conflicts: readConflicts(parsed.conflicts, knownTitles),
    extractCount: extracts.length,
    builtAtIso,
  };
}

/** One point as a line, with its sources in brackets when it has any. */
function renderPoint(point: BriefPoint): string {
  return point.sourceTitles.length === 0
    ? `  - ${point.text}`
    : `  - ${point.text}  [${point.sourceTitles.join('; ')}]`;
}

/** Renders one titled list, or nothing when it is empty. */
function renderPointList(heading: string, points: readonly BriefPoint[]): string[] {
  return points.length === 0 ? [] : [`${heading}:`, ...points.map((point) => renderPoint(point))];
}

/**
 * Renders the brief as the block that rides in every re-write prompt.
 *
 * Conflicts come FIRST, ahead of the settled material. A re-write made against a contradiction
 * nobody flagged is the expensive failure this whole pipeline is built to prevent, and burying it
 * under three lists of agreed points is how it gets missed.
 */
export function renderCorpusBrief(brief: CorpusBrief): string {
  const conflictLines = brief.conflicts.flatMap((conflict) => [
    `  - ${conflict.subject}`,
    ...conflict.positions.map((position) => `    · ${renderPoint(position).trim().replace(/^- /, '')}`),
  ]);

  return [
    `Consolidated from ${brief.extractCount} documents:`,
    ...(brief.overview === '' ? [] : [brief.overview]),
    ...(conflictLines.length === 0
      ? []
      : ['CONFLICTS — these documents disagree; do not assume either side:', ...conflictLines]),
    ...renderPointList('Decisions', brief.decisions),
    ...renderPointList('Requirements', brief.requirements),
    ...renderPointList('Open questions', brief.openQuestions),
  ].join('\n');
}
