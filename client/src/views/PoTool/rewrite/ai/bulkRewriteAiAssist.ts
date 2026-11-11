// bulkRewriteAiAssist.ts — The propose-only batch re-write AI envelope (spec 030). Mirrors
// compositionAiAssist: build a prompt (or an ordered set when large) from the captured issues, then
// parse a strict {kind:'featureRewriteBatch'} reply keyed by Jira key. Reuses featureDocSections so each
// re-written description is the same nine-section, validation-flagged, AI-attribution-stripped format as
// single-issue composition. There is NO automated/background AI — the operator runs the prompt and pastes back.
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores a request for JSON, and a nine-section re-write is
// far too long for a table cell. So the prompt asks for what an answer engine does follow: one block per issue, opened
// by an "ISSUE ABC-1" line, holding the nine sections under their labels. The reader finds each block by that line (or
// by a heading naming the key), and a JSON reply is still read. Blocks are keyed, so a follow-up asking only for the
// issues a reply left out can be pasted and read on its own.

import { SECTION_LABELS, normalizeFeatureDescription, parseSections, stripAiAttribution, VALIDATION_MARKER } from '../../ai/featureDocSections.ts';
import type { BatchReplyParseResult, CapturedOriginal, ProposedRewrite } from '../rewriteBatchModel';
import { buildSharedMaterialBlock } from './sharedMaterial.ts';
import { describeEnterpriseFeatureRules } from '../../../../domain/featureStateGates.ts';
import type { ReferencedSource } from '../../sources/sourceModel.ts';
import type { CorpusBrief } from './corpusBrief.ts';
import type { DocumentExtract } from './documentExtract.ts';
import { readKindedJsonReply } from './replyListSections.ts';

export const BULK_REWRITE_REPLY_KIND = 'featureRewriteBatch';

/** The word that opens each issue's block in the reply: "ISSUE ABC-1". */
const ISSUE_BLOCK_MARKER = 'ISSUE';
/** The error shown when a reply is neither the blocks nor JSON — the wording every round already uses. */
const UNREADABLE_REPLY_MESSAGE = 'No JSON object found in the assistant response.';
// "ISSUE ABC-1", "Issue: ABC-1", optionally followed by a short title after a colon or dash — never a sentence, so a
// line in a requirement such as "Issue ABC-2 must ship first" is not read as a new block.
const ISSUE_MARKER_LINE_PATTERN = /^issue\s*[:#-]?\s*([A-Z][A-Z0-9]+-\d+)\s*(?:[:—–|-].*)?$/i;
// A Jira key leading a line: "ABC-1", "ABC-1: Login fix".
const LEADING_JIRA_KEY_PATTERN = /^([A-Z][A-Z0-9]+-\d+)\b/;
// A markdown heading line, or a line that is bold from end to end — how an answer engine titles a block.
const MARKDOWN_HEADING_LINE_PATTERN = /^\s*#{1,6}\s+/;
const BOLD_WHOLE_LINE_PATTERN = /^\s*(?:\*\*|__).+(?:\*\*|__)\s*:?\s*$/;
// Marks removed before a heading line is compared: leading "#"s, bold and code marks.
const HEADING_MARKS_PATTERN = /^\s*#{1,6}\s*|\*\*|__|`/g;
// Lines that carry no content: a horizontal rule or a code fence.
const DECORATION_LINE_PATTERN = /^\s*(?:[-*_]{3,}|```[\w-]*)\s*$/;
// The closing offer an answer engine ends with: "If you would like…", "Let me know if…".
const CLOSING_OFFER_PATTERN = /^(?:if you(?:'d| would)? (?:like|want|provide|share|can|need|send|give)|let me know|would you like|do you want|i can also|feel free|happy to|want me to)/i;
// The ways an answer engine titles the last section: "Non-Functional Requirements", "NFRs".
const NFR_HEADING_ALIAS_PATTERN = /^(?:non[- ]?functional requirements?|nfrs?)(?:\s*\(nfrs?\))?$/i;
/** The canonical last section label, which an alias heading is rewritten to. */
const NFR_SECTION_LABEL = SECTION_LABELS[SECTION_LABELS.length - 1];

/**
 * One prompt is capped here; a batch exceeding it splits across an ordered set of prompts.
 *
 * Sized for the CHAT BOX it gets pasted into, not for the model behind it. At sixteen thousand the
 * paste was silently cut short by the assistant's own input limit — and because the issues come after
 * the shared material, what got cut was the issues. The reply then came back as an empty item list,
 * with nothing on either side saying why (GH #376).
 */
export const MAX_CHARS_PER_PROMPT = 9000;
/** Each issue's source text is capped so one long issue cannot crowd out the rest (matches composition). */
const MAX_SOURCE_CHARS = 4000;

/**
 * The room reserved for a working draft when deciding where the batch splits, whether or not one
 * exists yet.
 *
 * Sizing on the ACTUAL draft would make the split move under the operator: ingesting part one gives
 * those issues a draft, their blocks grow, the batch re-packs, and part two's panel disappears from
 * under an in-flight review (GH #220). Reserving the room up front keeps the split identical before
 * and after every ingest, which is the only property that makes a multi-part run reviewable.
 *
 * Set to what a nine-section draft typically costs, NOT to the worst case. A part carrying several
 * unusually long drafts may therefore run over the prompt cap — which is the right trade: the cap is
 * a comfort guideline, while truncating a requirement to respect it would destroy the very detail
 * this whole pass exists to preserve.
 */
const WORKING_DRAFT_ALLOWANCE_CHARS = 2000;

/** Trims a source field and says plainly when it was cut. */
function capSource(text: string): string {
  return text.length <= MAX_SOURCE_CHARS ? text : `${text.slice(0, MAX_SOURCE_CHARS)}\n… (truncated)`;
}

/** The per-issue block handed to the assistant. */
function buildIssueBlock(jiraKey: string, original: CapturedOriginal, working: ProposedRewrite | null): string {
  const lines = [
    `--- ${jiraKey} ---`,
    `Current summary: ${original.summary}`,
    `Original description:\n${capSource(original.description)}`,
    `Original acceptance criteria:\n${capSource(original.acceptanceCriteria)}`,
  ];

  // Sent so a second pass EXTENDS the draft rather than re-deriving it. Without this, every re-run
  // started from the original text again, and everything the first pass got right had to be got
  // right a second time by luck.
  if (working !== null && working.description.trim() !== '') {
    lines.push(
      `WORKING DRAFT — extend this, do not start again:\n${capSource(working.description)}`,
      `Working acceptance criteria:\n${capSource(working.acceptanceCriteria)}`,
    );
  }

  return lines.join('\n');
}

/**
 * How the reply is to be laid out: one block per issue, in order, each opened by its "ISSUE" line and holding the nine
 * sections under their labels. Shown in every prompt part and again in every follow-up.
 */
function describeRewriteReplyForm(jiraKeys: readonly string[]): string[] {
  const exampleKey = jiraKeys[0] ?? 'ABC-1';
  return [
    `Answer with one block per issue, in this order: ${jiraKeys.join(', ')}.`,
    `Start each block with a line holding only "${ISSUE_BLOCK_MARKER}" and the issue's key exactly as written (for example`,
    `${ISSUE_BLOCK_MARKER} ${exampleKey}), then write the nine sections, each starting on its own line with its label and a colon.`,
    'Do not answer in JSON or a table, write nothing before the first block or after the last, and ask no questions:',
    'where something is unclear, give your best judgement and use a validation marker.',
    'Each block looks like this:',
    `${ISSUE_BLOCK_MARKER} ${exampleKey}`,
    ...SECTION_LABELS.flatMap((label) => [`${label}:`, '...']),
  ];
}

/** The fixed instruction header + reply template wrapping the issue blocks (part N of M). */
function buildPromptShell(
  blocks: string[],
  jiraKeys: readonly string[],
  partIndex: number,
  partCount: number,
  sharedMaterialBlock = '',
): string {
  return [
    `You are re-writing existing Jira Features into a standard format. This is part ${partIndex} of ${partCount}.`,
    'Re-write EACH issue below. Structure each description as these nine sections, in this exact order, each a "Label:" heading:',
    '  Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, Non-Functional Requirements (NFR).',
    'Where the material is insufficient, still propose content but BEGIN that section with one of these exact markers:',
    `  ${VALIDATION_MARKER.business}  |  ${VALIDATION_MARKER.technical}  |  ${VALIDATION_MARKER.both}`,
    'Write the FULL acceptance criteria in the "Acceptance Criteria" section — that section also fills the issue\'s acceptance criteria field.',
    'Never state or imply that any of this was written, generated, or drafted by AI — a marker means information is missing, not AI authorship.',
    // The hard part of a second pass is that it pulls two ways. Told to preserve, an assistant appends
    // the new notes as extra bullets and the requirement becomes a pile of sediment nobody can read.
    // Told to re-write, it produces something clean that quietly lost half of last week's decisions.
    // Separating the INFORMATION (which must survive) from the WORDING AND ORDER (which must not) is
    // what lets both be true at once.
    'Where an issue shows a WORKING DRAFT, that draft is the current state of the requirement.',
    'RE-WRITE IT WHOLE as one coherent requirement covering everything now known. Do NOT append the new',
    'material to the end of what is there, and do not leave the draft standing with additions bolted on.',
    'Every FACT, decision, constraint and acceptance criterion already in the draft must survive. Its',
    'WORDING and ORDER must not: restate, merge and re-order freely so the result reads as though it',
    'had been written once, in a single sitting, with all of this material to hand.',
    'Say each thing ONCE. Two bullets making the same point is the clearest sign new material was',
    'appended rather than folded in.',
    'Where the new material CONTRADICTS the draft, the new material wins AND that section must begin',
    'with the matching validation marker above — a reversal nobody has agreed to yet is exactly what',
    'those markers are for.',
    'Never return a requirement that has lost detail already agreed.',
    describeEnterpriseFeatureRules(),
    '',
    // Repeated in EVERY part, deliberately. A large batch is split across prompts, and material
    // carried only in part one would leave every issue after the split re-written from nothing.
    ...(sharedMaterialBlock === '' ? [] : [sharedMaterialBlock, '']),
    'Issues:',
    blocks.join('\n\n'),
    '',
    ...describeRewriteReplyForm(jiraKeys),
  ].join('\n');
}

/**
 * Greedily packs issue blocks into groups that each fit the prompt cap (a lone oversized block stands
 * alone).
 *
 * Packs by a SIZING length rather than the block's own, so the split can reserve room for a draft that
 * does not exist yet and therefore never moves once one does.
 */
function partitionBlocks<TBlock extends { sizingLength: number }>(blocks: TBlock[], shellOverhead: number): TBlock[][] {
  const groups: TBlock[][] = [];
  let current: TBlock[] = [];
  let currentLength = shellOverhead;
  for (const block of blocks) {
    if (current.length > 0 && currentLength + block.sizingLength > MAX_CHARS_PER_PROMPT) {
      groups.push(current);
      current = [];
      currentLength = shellOverhead;
    }
    current.push(block);
    currentLength += block.sizingLength;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

/** One prompt part, and the issues it asks about — so a reply can be checked for the ones it left out. */
export interface BulkRewritePromptPart {
  promptText: string;
  jiraKeys: string[];
}

/** Builds an ordered set of prompts covering every issue (one when the batch fits the cap). */
export function buildBulkRewritePrompts(
  ...promptArguments: Parameters<typeof buildBulkRewritePromptParts>
): string[] {
  return buildBulkRewritePromptParts(...promptArguments).map((promptPart) => promptPart.promptText);
}

/** The same parts as buildBulkRewritePrompts, each with the keys of the issues it carries. */
export function buildBulkRewritePromptParts(
  items: { jiraKey: string; original: CapturedOriginal; proposed?: ProposedRewrite | null }[],
  /**
   * Documents that apply to the WHOLE batch — a new standard, a compliance note, a design decision.
   *
   * Optional and empty by default, so a batch without them builds exactly the prompt it always did.
   */
  sharedSources: readonly ReferencedSource[] = [],
  /**
   * A brief consolidated from those documents, when the corpus was too large to carry raw.
   *
   * Optional, so a batch whose material already fits builds exactly the prompt it always did.
   */
  sharedBrief: CorpusBrief | null = null,
  /**
   * Per-document extracts, for material condensed but not consolidated.
   *
   * A single long document never produces a brief — consolidation needs two things to consolidate —
   * so without this its extract would be built, shown, and then ignored.
   */
  sharedExtracts: Readonly<Record<string, DocumentExtract>> = {},
): BulkRewritePromptPart[] {
  if (items.length === 0) {
    return [];
  }
  const sharedMaterialBlock = buildSharedMaterialBlock(sharedSources, sharedBrief, sharedExtracts);
  // Every issue is sized as though it already carried a draft, so the split is the same on the first
  // run as on the fifth.
  const blocks = items.map((each) => {
    const text = buildIssueBlock(each.jiraKey, each.original, each.proposed ?? null);
    const withoutDraft = buildIssueBlock(each.jiraKey, each.original, null);
    return { jiraKey: each.jiraKey, text, sizingLength: withoutDraft.length + WORKING_DRAFT_ALLOWANCE_CHARS };
  });
  // The material counts against the budget: it rides in every part, so ignoring its size here would
  // build parts that overflow the cap by exactly the length of the documents.
  const shellOverhead = buildPromptShell([], [], 1, 1, sharedMaterialBlock).length;
  const groups = partitionBlocks(blocks, shellOverhead);
  return groups.map((group, index) => {
    const jiraKeys = group.map((block) => block.jiraKey);
    const promptText = buildPromptShell(group.map((block) => block.text), jiraKeys, index + 1, groups.length, sharedMaterialBlock);
    return { promptText, jiraKeys };
  });
}

/** Coerces to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parses one {kind:'featureRewriteBatch'} reply. Strict per key (an unknown key is rejected), lenient
 * per field (an item with no usable description is counted, not fatal). Each description is normalized to
 * the nine sections and stripped of AI attribution. Throws only on a reply that is neither the issue blocks nor JSON,
 * or on the wrong kind. Ingesting multiple prompt-parts merges by key (later parts add keys — `Object.assign` the results).
 */
export function parseBulkRewriteReply(replyText: string, knownKeys: string[]): BatchReplyParseResult {
  const items = readRewriteReplyItems(replyText);
  const knownKeySet = new Set(knownKeys);
  const rewritesByKey: Record<string, ProposedRewrite> = {};
  const rejected: { key: string; reason: string }[] = [];
  let unparsedCount = 0;

  items.forEach((rawItem) => {
    const record = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
    const key = readTrimmedString(record.key);
    if (key === '' || !knownKeySet.has(key)) {
      rejected.push({ key, reason: 'not in this batch' });
      return;
    }
    const description = readTrimmedString(record.description);
    if (description === '') {
      unparsedCount += 1;
      return;
    }
    rewritesByKey[key] = {
      description: stripAiAttribution(normalizeFeatureDescription(description)),
      acceptanceCriteria: readTrimmedString(record.acceptanceCriteria),
      isEdited: false,
    };
  });

  return { rewritesByKey, rejected, unparsedCount };
}

// ── Reading the issue blocks ──

/** One issue's block as the reply wrote it: its key and the lines under its opening line. */
interface IssueReplyBlock {
  jiraKey: string;
  lines: string[];
}

/**
 * The Jira key a line opens a block for, or null when it opens none. Three forms count: the asked-for "ISSUE ABC-1"
 * line; a markdown heading or whole-bold line led by a key ("## ABC-1 Login fix"); and a line holding only a key. A
 * key at the start of an ordinary sentence inside a requirement does not count.
 */
function readIssueBlockKey(replyLine: string): string | null {
  const plainText = replyLine.replace(HEADING_MARKS_PATTERN, '').trim();
  const markerMatch = ISSUE_MARKER_LINE_PATTERN.exec(plainText);
  if (markerMatch) return markerMatch[1].toUpperCase();
  const keyMatch = LEADING_JIRA_KEY_PATTERN.exec(plainText);
  if (!keyMatch) return null;
  const isHeadingLine = MARKDOWN_HEADING_LINE_PATTERN.test(replyLine) || BOLD_WHOLE_LINE_PATTERN.test(replyLine);
  const isKeyAlone = plainText.replace(/[:.]$/, '') === keyMatch[1];
  return isHeadingLine || isKeyAlone ? keyMatch[1] : null;
}

/** Splits a reply into its issue blocks. Text before the first block (an intro) is dropped; so are rules and fences. */
function splitIssueBlocks(replyText: string): IssueReplyBlock[] {
  const blocks: IssueReplyBlock[] = [];
  for (const replyLine of replyText.split(/\r?\n/)) {
    if (DECORATION_LINE_PATTERN.test(replyLine)) continue;
    const blockKey = readIssueBlockKey(replyLine);
    if (blockKey !== null) {
      blocks.push({ jiraKey: blockKey, lines: [] });
      continue;
    }
    blocks[blocks.length - 1]?.lines.push(replyLine);
  }
  // The answer engine's closing offer ("If you would like…") trails the last block; it is not part of that re-write.
  const lastBlock = blocks[blocks.length - 1];
  const offerIndex = lastBlock?.lines.findIndex((blockLine) => CLOSING_OFFER_PATTERN.test(blockLine.trim())) ?? -1;
  if (lastBlock && offerIndex !== -1) lastBlock.lines.splice(offerIndex);
  return blocks;
}

/**
 * A block's text with an alias of the last section's heading ("Non-Functional Requirements", "NFRs") rewritten to its
 * canonical label, so its content is not folded into the section above it.
 */
function normalizeSectionHeadingAliases(blockLines: readonly string[]): string {
  return blockLines.map((blockLine) => {
    const colonIndex = blockLine.indexOf(':');
    const headingPart = colonIndex === -1 ? blockLine : blockLine.slice(0, colonIndex);
    const headingText = headingPart.replace(HEADING_MARKS_PATTERN, '').trim();
    if (!NFR_HEADING_ALIAS_PATTERN.test(headingText)) return blockLine;
    const inlineText = colonIndex === -1 ? '' : blockLine.slice(colonIndex + 1).replace(HEADING_MARKS_PATTERN, '').trim();
    return `${NFR_SECTION_LABEL}:${inlineText === '' ? '' : ` ${inlineText}`}`;
  }).join('\n').trim();
}

/**
 * The reply's items in the {key, description, acceptanceCriteria} shape the JSON form carried, so the per-key rules
 * apply to both forms alike. A block's acceptance criteria are its own "Acceptance Criteria" section — the prompt asks
 * for the full criteria there, so nothing is invented. A key named twice keeps its first written block.
 */
function readRewriteReplyItems(replyText: string): unknown[] {
  const jsonPayload = readKindedJsonReply(replyText);
  if (jsonPayload !== null) {
    if (jsonPayload.kind !== BULK_REWRITE_REPLY_KIND) {
      throw new Error(`Expected an AI reply with {"kind":"${BULK_REWRITE_REPLY_KIND}"}, got "${String(jsonPayload.kind)}".`);
    }
    return Array.isArray(jsonPayload.items) ? jsonPayload.items : [];
  }
  const blocks = splitIssueBlocks(replyText);
  if (blocks.length === 0) {
    throw new Error(UNREADABLE_REPLY_MESSAGE);
  }
  const itemsByKey = new Map<string, { key: string; description: string; acceptanceCriteria: string }>();
  for (const block of blocks) {
    const blockText = normalizeSectionHeadingAliases(block.lines);
    if (itemsByKey.get(block.jiraKey)?.description) continue;
    const acceptanceCriteria = parseSections(blockText).get('Acceptance Criteria') ?? '';
    itemsByKey.set(block.jiraKey, { key: block.jiraKey, description: blockText, acceptanceCriteria });
  }
  return [...itemsByKey.values()];
}

// ── The follow-up ──

/**
 * The follow-up for the same AI chat when a reply could not be read, or left issues out: the same block form, for
 * only those issues. Each block is keyed, so its answer can be pasted and read on its own.
 */
export function buildBulkRewriteFollowUpPrompt(missingJiraKeys: readonly string[], wasReplyUnreadable: boolean): string {
  if (missingJiraKeys.length === 0) return '';
  const openingLine = wasReplyUnreadable
    ? 'Your last reply was not in the form I need, so it could not be read. Keep the re-writes you already wrote, but lay them out as below.'
    : `Your last reply did not include a re-write for ${missingJiraKeys.join(', ')}. Write only those now, in the same way.`;
  return [openingLine, '', ...describeRewriteReplyForm(missingJiraKeys)].join('\n');
}
