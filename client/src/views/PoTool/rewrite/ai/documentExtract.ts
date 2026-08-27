// documentExtract.ts — Reducing one long document to the few things a re-write actually needs.
//
// The corpus is bigger than any prompt. A folder of emails, a stack of PDFs and a OneNote notebook
// run to hundreds of thousands of characters; a prompt holds sixteen thousand, and the issues being
// re-written have to fit in there too. Dividing the shared-material budget across thirty documents
// gives each about two hundred characters, which is not a summary of anything.
//
// So the corpus is read in the only order that fits: one document at a time, each reduced to a small
// structured extract, and the extracts consolidated afterwards (see corpusBrief.ts). This is the
// first half — the map.
//
// Three things make the extract worth more than a paragraph of prose would be:
//
//   - it is LISTS, so the consolidation step can spot the same decision recorded in four documents
//     and the contradiction between two of them, which no amount of re-reading prose will surface;
//   - it carries its SOURCE, so a claim that later turns out to be wrong can be traced to the page
//     it came from rather than argued about;
//   - it is CAPPED per list, because an assistant asked for "the requirements" of a forty-page
//     document will happily return two hundred of them, and a two-hundred-item extract has simply
//     moved the original problem one step down the pipeline.
//
// Pure: no fetch, no storage, no clock — the extraction time is passed in.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import { describeSourceOrigin, describeSourceTitle, readSourceText } from '../../sources/sourceModel.ts';
import type { ReferencedSource } from '../../sources/sourceModel.ts';

export const DOCUMENT_EXTRACT_REPLY_KIND = 'documentExtract';

/**
 * How much of a document one extract prompt carries.
 *
 * Far larger than any document's share of the shared-material budget, because here the document has
 * the prompt to itself — that headroom is the entire reason for reading them one at a time.
 */
export const MAX_DOCUMENT_CHARS_PER_PROMPT = 12000;

/** The most items kept per list, so a long document cannot return an extract as long as itself. */
export const MAX_ITEMS_PER_LIST = 12;

/** What one document turned out to be saying. */
export interface DocumentExtract {
  /** The source it came from, so every line in the brief can be traced back to a document. */
  sourceId: string;
  sourceTitle: string;
  sourceOrigin: string;
  /** One or two sentences: what this document IS, which is what tells you whether to trust it. */
  summary: string;
  /** Choices already made. These are the lines that stop a re-write re-opening settled questions. */
  decisions: string[];
  /** What the work must do, as stated here. */
  requirements: string[];
  /** What this document leaves undecided — the material a validation marker is made of. */
  openQuestions: string[];
  /** Numbers, dates, systems and names worth carrying forward verbatim. */
  facts: string[];
  extractedAtIso: string;
}

/** Splits a document's text into prompt-sized parts, breaking on a line end where one is near. */
function splitTextIntoParts(documentText: string): string[] {
  const parts: string[] = [];
  let remainingText = documentText;

  while (remainingText.length > MAX_DOCUMENT_CHARS_PER_PROMPT) {
    const hardLimit = remainingText.slice(0, MAX_DOCUMENT_CHARS_PER_PROMPT);
    // Cutting mid-sentence loses a requirement across the seam; a line end within the last tenth is
    // close enough to the limit to be worth preferring.
    const lastLineEnd = hardLimit.lastIndexOf('\n');
    const cutAt = lastLineEnd > MAX_DOCUMENT_CHARS_PER_PROMPT * 0.9 ? lastLineEnd : MAX_DOCUMENT_CHARS_PER_PROMPT;
    parts.push(remainingText.slice(0, cutAt).trim());
    remainingText = remainingText.slice(cutAt);
  }

  const lastPart = remainingText.trim();
  if (lastPart !== '' || parts.length === 0) {
    parts.push(lastPart);
  }
  return parts;
}

/** The fixed instruction wrapping one part of one document. */
function buildExtractShell(source: ReferencedSource, partText: string, partIndex: number, partCount: number): string {
  const partLabel = partCount === 1 ? '' : ` (part ${partIndex} of ${partCount})`;

  return [
    'You are reading ONE document from a larger body of material, so that a set of Jira Features can',
    'later be re-written from all of it at once. The document is too long to carry into that re-write',
    'whole — reduce it to the few things that would change how the work is written.',
    '',
    `Document: ${describeSourceTitle(source)}${partLabel}`,
    `Where it came from: ${describeSourceOrigin(source)}`,
    '',
    '--- document ---',
    partText,
    '--- end of document ---',
    '',
    'Record only what THIS document says. Do not infer, do not fill gaps from what you know about',
    'systems of this kind, and do not repeat the same point in two lists. If the document settles a',
    'question, that is a decision; if it leaves one open, that is an open question — the difference',
    'matters more here than anywhere else, because a settled question re-opened wastes a review cycle.',
    `Keep each list to at most ${MAX_ITEMS_PER_LIST} entries, chosen for what carries the most weight.`,
    partCount === 1 ? '' : 'This is one part of a longer document; cover only what is in this part.',
    '',
    'Reply with ONLY this JSON:',
    `{"kind":"${DOCUMENT_EXTRACT_REPLY_KIND}","summary":"...","decisions":["..."],`
      + '"requirements":["..."],"openQuestions":["..."],"facts":["..."]}',
  ].filter((line) => line !== '').join('\n');
}

/**
 * Builds the prompt (or ordered set of prompts) that reduces one document to an extract.
 *
 * A document longer than one prompt is split rather than truncated. Truncating would silently drop
 * the back half of a notebook page, and the extract would look complete — which is worse than an
 * extra round trip, because nothing on screen would say anything was missing.
 */
export function buildDocumentExtractPrompts(source: ReferencedSource): string[] {
  const documentText = readSourceText(source).trim();
  if (documentText === '') {
    return [];
  }

  const parts = splitTextIntoParts(documentText);
  return parts.map((partText, partIndex) => buildExtractShell(source, partText, partIndex + 1, parts.length));
}

/** Reads a JSON array as a trimmed, de-duplicated, capped list of strings. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const keptItems: string[] = [];
  value.forEach((entry) => {
    const text = typeof entry === 'string' ? entry.trim() : '';
    if (text !== '' && !keptItems.includes(text) && keptItems.length < MAX_ITEMS_PER_LIST) {
      keptItems.push(text);
    }
  });
  return keptItems;
}

/**
 * Parses one `{kind:'documentExtract'}` reply into an extract for the given source.
 *
 * The source is supplied rather than read from the reply: the assistant has no way to know a source
 * id, and asking it to echo a title back is one more thing it can get subtly wrong while the wrong
 * provenance rides all the way through to the brief.
 *
 * Throws only when the reply is unusable as a whole. A missing list is an empty list — a document
 * that settles nothing genuinely has no decisions, and refusing the extract over that would demand
 * a fabricated one.
 */
export function parseDocumentExtractReply(
  replyText: string,
  source: ReferencedSource,
  extractedAtIso: string,
): DocumentExtract {
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== DOCUMENT_EXTRACT_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${DOCUMENT_EXTRACT_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }

  return {
    sourceId: source.id,
    sourceTitle: describeSourceTitle(source),
    sourceOrigin: describeSourceOrigin(source),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    decisions: readStringList(parsed.decisions),
    requirements: readStringList(parsed.requirements),
    openQuestions: readStringList(parsed.openQuestions),
    facts: readStringList(parsed.facts),
    extractedAtIso,
  };
}

/** Joins two lists, keeping order, dropping repeats, and holding to the cap. */
function mergeStringLists(firstList: readonly string[], secondList: readonly string[]): string[] {
  const mergedItems = [...firstList];
  secondList.forEach((entry) => {
    if (!mergedItems.includes(entry) && mergedItems.length < MAX_ITEMS_PER_LIST) {
      mergedItems.push(entry);
    }
  });
  return mergedItems;
}

/**
 * Combines the extracts from two parts of one document.
 *
 * Ingesting part two must ADD to part one, never replace it: a forty-thousand-character notebook page
 * takes four prompts, and a fourth reply that overwrote the first three would leave an extract of the
 * document's last quarter wearing the whole document's name.
 */
export function mergeDocumentExtracts(earlier: DocumentExtract, later: DocumentExtract): DocumentExtract {
  return {
    ...later,
    summary: earlier.summary === '' || earlier.summary === later.summary
      ? later.summary
      : `${earlier.summary} ${later.summary}`.trim(),
    decisions: mergeStringLists(earlier.decisions, later.decisions),
    requirements: mergeStringLists(earlier.requirements, later.requirements),
    openQuestions: mergeStringLists(earlier.openQuestions, later.openQuestions),
    facts: mergeStringLists(earlier.facts, later.facts),
  };
}

/** Renders one list as a titled block, or nothing when it is empty. */
function renderList(heading: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [`${heading}:`, ...items.map((item) => `  - ${item}`)];
}

/**
 * Renders an extract as the compact block that stands in for the document from here on.
 *
 * Named with its origin, because the brief built from these is the thing a PO will be challenged on,
 * and "which document said that?" needs an answer that is already written down.
 */
export function renderDocumentExtract(extract: DocumentExtract): string {
  return [
    `### ${extract.sourceTitle} (${extract.sourceOrigin})`,
    ...(extract.summary === '' ? [] : [extract.summary]),
    ...renderList('Decisions', extract.decisions),
    ...renderList('Requirements', extract.requirements),
    ...renderList('Open questions', extract.openQuestions),
    ...renderList('Facts', extract.facts),
  ].join('\n');
}

/** True when an extract carried nothing usable, so the UI can say so rather than show an empty block. */
export function isDocumentExtractEmpty(extract: DocumentExtract): boolean {
  return extract.summary === ''
    && extract.decisions.length === 0
    && extract.requirements.length === 0
    && extract.openQuestions.length === 0
    && extract.facts.length === 0;
}
