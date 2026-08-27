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
// Pure: no fetch, no storage, no clock.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import { renderDocumentExtract } from './documentExtract.ts';
import type { DocumentExtract } from './documentExtract.ts';

export const CORPUS_BRIEF_REPLY_KIND = 'corpusBrief';

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
    'Reply with ONLY this JSON:',
    `{"kind":"${CORPUS_BRIEF_REPLY_KIND}","overview":"...",`
      + '"decisions":[{"text":"...","sources":["Doc A"]}],'
      + '"requirements":[{"text":"...","sources":["Doc A"]}],'
      + '"openQuestions":[{"text":"...","sources":["Doc A"]}],'
      + '"conflicts":[{"subject":"...","positions":[{"text":"...","sources":["Doc A"]}]}]}',
  ].join('\n');
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
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== CORPUS_BRIEF_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${CORPUS_BRIEF_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }

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
