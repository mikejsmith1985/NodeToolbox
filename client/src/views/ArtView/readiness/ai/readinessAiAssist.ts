// readinessAiAssist.ts — The readiness AI prompt, and the parser that reads the reply back.
//
// Pure functions, no React and no I/O (the piReviewAiAssist model). One prompt covers the active
// lens's features and ends with a fill-in table listing each one — Google's AI Mode, the team's only
// assistant (GH #499), ignores JSON but completes a table. The shared record reader turns the table
// back into the {kind, items[]} envelope (a JSON reply is still read), so a reply pasted from another
// surface is still caught by the kind guard. Only estimate,
// target-end, and due-date are writable on accept; ownership and insight are display-only guidance —
// the model cannot know valid account identities, so a wrong-owner write is never armed.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  type ReplyRecordSpec,
} from '../../../../utils/aiReplyRecords.ts';
import type { ReadinessFeature } from '../readinessScan.ts';

/** The envelope kind. A reply echoing anything else is a wrong reply, not a partial one. */
export const READINESS_REPLY_KIND = 'featureReadiness';

/** Longest note text the model may contribute, matching the house cap used by other AI surfaces. */
const MAX_NOTE_LENGTH = 300;
const BLANKISH_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', '-', '--', 'tbd', 'unknown']);
// A "|" or line break inside a summary would split its table row, so it is written as a space.
const TABLE_CELL_BREAKING_PATTERN = /[|\r\n]+/g;

/** The fill-in table: every Feature by key and summary, each suggestion left blank. */
const READINESS_REPLY_SPEC: ReplyRecordSpec = {
  kind: READINESS_REPLY_KIND,
  replyMarker: 'READINESS_TABLE:',
  columns: [
    { field: 'issueKey', header: 'Issue key' },
    { field: 'summary', header: 'Feature', isNamingOnly: true },
    { field: 'estimateSuggestion', header: 'Estimate', answerHint: 'a size/estimate, only when the Feature has none' },
    { field: 'targetEndSuggestion', header: 'Target end', answerHint: 'YYYY-MM-DD, only when missing or clearly wrong' },
    { field: 'dueDateSuggestion', header: 'Due date', answerHint: 'YYYY-MM-DD, only when missing or clearly wrong' },
    { field: 'ownershipSuggestion', header: 'Ownership', answerHint: 'who should own it — text only, never an account id' },
    { field: 'insight', header: 'Insight', answerHint: 'one line on risk or readiness' },
  ],
};

/** One AI proposal for one feature. Only the three date/estimate fields are writable on accept. */
export interface ReadinessAiProposal {
  issueKey: string;
  estimateSuggestion: string | null;
  targetEndSuggestion: string | null;
  dueDateSuggestion: string | null;
  /** Display-only guidance — never written to Jira. */
  ownershipSuggestion: string | null;
  /** Narrative note — display only. */
  insight: string | null;
}

/** The outcome of parsing one reply: usable proposals plus an honest account of what was not. */
export interface ReadinessAiRunResult {
  proposals: ReadinessAiProposal[];
  unknownKeys: string[];
  unparsedCount: number;
  /** Features the reply listed but left every suggestion blank for — an answer ("no basis"), not a gap. */
  blankKeys: string[];
}

// ── Prompt ──

/** One feature block: identity, state, and the alerts that name its real gaps. */
function buildFeatureBlock(feature: ReadinessFeature): string {
  const lines = [`- ${feature.key} · ${feature.statusName} — ${feature.summary}`];
  lines.push(`    alerts: ${feature.alerts.join(', ') || '(none)'}`);
  if (feature.impedimentReasons.length > 0) lines.push(`    impediments: ${feature.impedimentReasons.join(', ')}`);
  lines.push(`    current estimate: ${feature.estimateValue ?? '(none)'} · target end: ${feature.targetEndIso ?? '(none)'} · due: ${feature.dueDateIso ?? '(none)'}`);
  return lines.join('\n');
}

/** Builds one prompt covering the active lens's features, keyed for per-feature acceptance. */
export function buildReadinessAiPrompt(features: readonly ReadinessFeature[]): string {
  const featureBlocks = features.map(buildFeatureBlock).join('\n');
  const issueKeyList = features.map((feature) => feature.key).join(', ');

  return `You are helping an RTE assess feature readiness for ${features.length} SAFe Features.

For each Feature below, where the data supports it, suggest:
  1. Estimate: a size/estimate when the Feature has none and the material implies one.
  2. Target end: an ISO date (YYYY-MM-DD) when the target end is missing or clearly wrong.
  3. Due date: an ISO date (YYYY-MM-DD) when the due date is missing or clearly wrong.
  4. Ownership: guidance on who should own it — TEXT ONLY, the app never writes this.
  5. Insight: one line on risk or readiness the RTE should hear.

Rules:
  - Use only the issue keys listed below. Never invent a Feature or a key.
  - Leave ___ in any cell you have no basis for — saying nothing is better than a guess a person must catch.
  - Keep every note under ${MAX_NOTE_LENGTH} characters.
  - Do not suggest an owner account id; ownership is guidance for a human, not a value to write.

Features (${features.length} — cover every one):
${featureBlocks}

Issue keys you may use: ${issueKeyList}

${buildRecordReplyInstructions(READINESS_REPLY_SPEC, listFeatureRowNamingCells(features))}`;
}

/** One pre-filled row per Feature — its key and summary — so the reply cannot invent or drop a Feature. */
function listFeatureRowNamingCells(features: readonly ReadinessFeature[]): string[][] {
  return features.map((feature) => [feature.key, feature.summary.replace(TABLE_CELL_BREAKING_PATTERN, ' ')]);
}

/**
 * The follow-up to paste into the same AI chat, or '' when the reply needs none. An unreadable reply gets
 * the whole table again; a reply that dropped Features gets a table of just those. A Feature listed with
 * every cell blank was answered ("no basis") and is not asked about again — nothing is ever guessed.
 *
 * @param runResult - The parsed reply, or null when the reply could not be read at all.
 */
export function buildReadinessAiFollowUpPrompt(
  features: readonly ReadinessFeature[],
  runResult: ReadinessAiRunResult | null,
): string {
  if (runResult === null) {
    return buildRecordFormatFixPrompt(READINESS_REPLY_SPEC, listFeatureRowNamingCells(features));
  }
  const answeredKeys = new Set([...runResult.proposals.map((proposal) => proposal.issueKey), ...runResult.blankKeys]);
  const missingFeatures = features.filter((feature) => !answeredKeys.has(feature.key.toUpperCase()));
  if (missingFeatures.length === 0) {
    return '';
  }
  return [
    `Your last reply left out ${missingFeatures.map((feature) => feature.key).join(', ')}. Answer only those now, in this table.`,
    buildRecordReplyInstructions(READINESS_REPLY_SPEC, listFeatureRowNamingCells(missingFeatures)),
  ].join('\n');
}

// ── Parsing ──

/** Trims, drops "nothing to say" values, and caps length. */
function readNote(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (BLANKISH_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed.length > MAX_NOTE_LENGTH ? `${trimmed.slice(0, MAX_NOTE_LENGTH)}…` : trimmed;
}

/** Turns one reply item into a proposal, or null when it carries nothing usable. */
function readProposal(rawItem: Record<string, unknown>, issueKey: string): ReadinessAiProposal | null {
  const estimateSuggestion = readNote(rawItem.estimateSuggestion);
  const targetEndSuggestion = readNote(rawItem.targetEndSuggestion);
  const dueDateSuggestion = readNote(rawItem.dueDateSuggestion);
  const ownershipSuggestion = readNote(rawItem.ownershipSuggestion);
  const insight = readNote(rawItem.insight);

  const hasAnyContent = estimateSuggestion !== null
    || targetEndSuggestion !== null
    || dueDateSuggestion !== null
    || ownershipSuggestion !== null
    || insight !== null;
  if (!hasAnyContent) return null;

  return { issueKey, estimateSuggestion, targetEndSuggestion, dueDateSuggestion, ownershipSuggestion, insight };
}

/**
 * Parses an AI reply — the filled-in table (markdown or tab-separated) or JSON — into proposals plus an
 * honest account of what could not be used. Throws only for a wholly wrong reply (neither a table nor
 * JSON, or another surface's kind); every other problem degrades — an
 * unknown key drops the item, an empty item is counted unparsed.
 */
export function parseReadinessAiReply(replyText: string, knownIssueKeys: readonly string[]): ReadinessAiRunResult {
  const parsedEnvelope = JSON.parse(extractRecordReplyPayload(replyText, READINESS_REPLY_SPEC)) as Record<string, unknown>;
  if (parsedEnvelope.kind !== READINESS_REPLY_KIND) {
    throw new Error(`Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${READINESS_REPLY_KIND}".`);
  }

  const knownKeysUpper = knownIssueKeys.map((issueKey) => issueKey.toUpperCase());
  const rawItems = Array.isArray(parsedEnvelope.items) ? parsedEnvelope.items : [];

  const proposalsByKey = new Map<string, ReadinessAiProposal>();
  const unknownKeys: string[] = [];
  const blankKeys: string[] = [];
  let unparsedCount = 0;

  for (const rawItem of rawItems) {
    if (typeof rawItem !== 'object' || rawItem === null) { unparsedCount += 1; continue; }
    const item = rawItem as Record<string, unknown>;
    const rawKey = typeof item.issueKey === 'string' ? item.issueKey.trim().toUpperCase() : '';
    if (rawKey === '') { unparsedCount += 1; continue; }
    if (!knownKeysUpper.includes(rawKey)) { unknownKeys.push(rawKey); continue; }

    const proposal = readProposal(item, rawKey);
    if (proposal === null) { unparsedCount += 1; blankKeys.push(rawKey); continue; }
    proposalsByKey.set(rawKey, proposal);
  }

  const proposals = knownKeysUpper
    .map((issueKey) => proposalsByKey.get(issueKey))
    .filter((proposal): proposal is ReadinessAiProposal => proposal !== undefined);

  return { proposals, unknownKeys, unparsedCount, blankKeys };
}
