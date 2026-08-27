// bulkRewriteAiAssist.ts — The propose-only batch re-write AI envelope (spec 030). Mirrors
// compositionAiAssist: build a prompt (or an ordered set when large) from the captured issues, then
// parse a strict {kind:'featureRewriteBatch'} reply keyed by Jira key. Reuses featureDocSections so each
// re-written description is the same nine-section, validation-flagged, AI-attribution-stripped format as
// single-issue composition. There is NO automated/background AI — the operator runs the prompt and pastes back.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import { normalizeFeatureDescription, stripAiAttribution, VALIDATION_MARKER } from '../../ai/featureDocSections.ts';
import type { BatchReplyParseResult, CapturedOriginal, ProposedRewrite } from '../rewriteBatchModel';
import { buildSharedMaterialBlock } from './sharedMaterial.ts';
import { describeEnterpriseFeatureRules } from '../../../../domain/featureStateGates.ts';
import type { ReferencedSource } from '../../sources/sourceModel.ts';
import type { CorpusBrief } from './corpusBrief.ts';

export const BULK_REWRITE_REPLY_KIND = 'featureRewriteBatch';

/** One prompt is capped here; a batch exceeding it splits across an ordered set of prompts. */
const MAX_CHARS_PER_PROMPT = 16000;
/** Each issue's source text is capped so one long issue cannot crowd out the rest (matches composition). */
const MAX_SOURCE_CHARS = 4000;

/** Trims a source field and says plainly when it was cut. */
function capSource(text: string): string {
  return text.length <= MAX_SOURCE_CHARS ? text : `${text.slice(0, MAX_SOURCE_CHARS)}\n… (truncated)`;
}

/** The per-issue block handed to the assistant. */
function buildIssueBlock(jiraKey: string, original: CapturedOriginal): string {
  return [
    `--- ${jiraKey} ---`,
    `Current summary: ${original.summary}`,
    `Current description:\n${capSource(original.description)}`,
    `Current acceptance criteria:\n${capSource(original.acceptanceCriteria)}`,
  ].join('\n');
}

/** The fixed instruction header + reply template wrapping the issue blocks (part N of M). */
function buildPromptShell(blocks: string[], partIndex: number, partCount: number, sharedMaterialBlock = ''): string {
  return [
    `You are re-writing existing Jira Features into a standard format. This is part ${partIndex} of ${partCount}.`,
    'Re-write EACH issue below. Structure each description as these nine sections, in this exact order, each a "Label:" heading:',
    '  Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, Non-Functional Requirements (NFR).',
    'Where the material is insufficient, still propose content but BEGIN that section with one of these exact markers:',
    `  ${VALIDATION_MARKER.business}  |  ${VALIDATION_MARKER.technical}  |  ${VALIDATION_MARKER.both}`,
    'Put the FULL acceptance criteria both in the description\'s "Acceptance Criteria" section AND in the item\'s acceptanceCriteria.',
    'Never state or imply that any of this was written, generated, or drafted by AI — a marker means information is missing, not AI authorship.',
    describeEnterpriseFeatureRules(),
    '',
    // Repeated in EVERY part, deliberately. A large batch is split across prompts, and material
    // carried only in part one would leave every issue after the split re-written from nothing.
    ...(sharedMaterialBlock === '' ? [] : [sharedMaterialBlock, '']),
    'Issues:',
    blocks.join('\n\n'),
    '',
    'Reply with ONLY this JSON (every issue in this part, keyed by its Jira key):',
    `{"kind":"${BULK_REWRITE_REPLY_KIND}","items":[{"key":"ABC-1","description":"...","acceptanceCriteria":"..."}]}`,
  ].join('\n');
}

/** Greedily packs issue blocks into groups that each fit the prompt cap (a lone oversized block stands alone). */
function partitionBlocks(blocks: string[], shellOverhead: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = shellOverhead;
  for (const block of blocks) {
    if (current.length > 0 && currentLength + block.length > MAX_CHARS_PER_PROMPT) {
      groups.push(current);
      current = [];
      currentLength = shellOverhead;
    }
    current.push(block);
    currentLength += block.length;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

/** Builds an ordered set of prompts covering every issue (one when the batch fits the cap). */
export function buildBulkRewritePrompts(
  items: { jiraKey: string; original: CapturedOriginal }[],
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
): string[] {
  if (items.length === 0) {
    return [];
  }
  const sharedMaterialBlock = buildSharedMaterialBlock(sharedSources, sharedBrief);
  const blocks = items.map((each) => buildIssueBlock(each.jiraKey, each.original));
  // The material counts against the budget: it rides in every part, so ignoring its size here would
  // build parts that overflow the cap by exactly the length of the documents.
  const shellOverhead = buildPromptShell([], 1, 1, sharedMaterialBlock).length;
  const groups = partitionBlocks(blocks, shellOverhead);
  return groups.map((group, index) => buildPromptShell(group, index + 1, groups.length, sharedMaterialBlock));
}

/** Coerces to a trimmed string. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parses one {kind:'featureRewriteBatch'} reply. Strict per key (an unknown key is rejected), lenient
 * per field (an item with no usable description is counted, not fatal). Each description is normalized to
 * the nine sections and stripped of AI attribution. Throws only on a missing/blank reply or wrong kind.
 * Ingesting multiple prompt-parts merges by key (later parts add keys — `Object.assign` the results).
 */
export function parseBulkRewriteReply(replyText: string, knownKeys: string[]): BatchReplyParseResult {
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== BULK_REWRITE_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${BULK_REWRITE_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }
  const knownKeySet = new Set(knownKeys);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
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
