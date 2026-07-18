// readinessAiAssist.ts — The readiness AI prompt, and the parser that reads the reply back.
//
// Two pure functions, no React and no I/O (the piReviewAiAssist model). One prompt covers the active
// lens's features; the reply is the shared {kind, items[]} envelope so extractJsonPayload works
// unmodified and a reply pasted from another surface is caught by the kind guard. Only estimate,
// target-end, and due-date are writable on accept; ownership and insight are display-only guidance —
// the model cannot know valid account identities, so a wrong-owner write is never armed.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import type { ReadinessFeature } from '../readinessScan.ts';

/** The envelope kind. A reply echoing anything else is a wrong reply, not a partial one. */
export const READINESS_REPLY_KIND = 'featureReadiness';

/** Longest note text the model may contribute, matching the house cap used by other AI surfaces. */
const MAX_NOTE_LENGTH = 300;
const BLANKISH_VALUES = new Set(['', 'n/a', 'na', 'none', 'no', '-', '--', 'tbd', 'unknown']);

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
  1. "estimateSuggestion": a size/estimate when the Feature has none and the material implies one.
  2. "targetEndSuggestion": an ISO date (YYYY-MM-DD) when the target end is missing or clearly wrong.
  3. "dueDateSuggestion": an ISO date (YYYY-MM-DD) when the due date is missing or clearly wrong.
  4. "ownershipSuggestion": guidance on who should own it — TEXT ONLY, the app never writes this.
  5. "insight": one line on risk or readiness the RTE should hear.

Rules:
  - Use only the issue keys listed below. Never invent a Feature or a key.
  - Omit any field you have no basis for — saying nothing is better than a guess a person must catch.
  - Keep every note under ${MAX_NOTE_LENGTH} characters.
  - Do not suggest an owner account id; ownership is guidance for a human, not a value to write.

Features (${features.length} — cover every one):
${featureBlocks}

Issue keys you may use: ${issueKeyList}

Reply with this JSON object and nothing else:
{
  "kind": "${READINESS_REPLY_KIND}",
  "items": [
    {
      "issueKey": "<one of the keys above>",
      "estimateSuggestion": "<size/estimate, or omit>",
      "targetEndSuggestion": "<YYYY-MM-DD, or omit>",
      "dueDateSuggestion": "<YYYY-MM-DD, or omit>",
      "ownershipSuggestion": "<who should own it, or omit>",
      "insight": "<one line, or omit>"
    }
  ]
}`;
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
 * Parses an AI reply into proposals plus an honest account of what could not be used. Throws only for
 * a wholly wrong reply (not JSON, or another surface's kind); every other problem degrades — an
 * unknown key drops the item, an empty item is counted unparsed.
 */
export function parseReadinessAiReply(replyText: string, knownIssueKeys: readonly string[]): ReadinessAiRunResult {
  const parsedEnvelope = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsedEnvelope.kind !== READINESS_REPLY_KIND) {
    throw new Error(`Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${READINESS_REPLY_KIND}".`);
  }

  const knownKeysUpper = knownIssueKeys.map((issueKey) => issueKey.toUpperCase());
  const rawItems = Array.isArray(parsedEnvelope.items) ? parsedEnvelope.items : [];

  const proposalsByKey = new Map<string, ReadinessAiProposal>();
  const unknownKeys: string[] = [];
  let unparsedCount = 0;

  for (const rawItem of rawItems) {
    if (typeof rawItem !== 'object' || rawItem === null) { unparsedCount += 1; continue; }
    const item = rawItem as Record<string, unknown>;
    const rawKey = typeof item.issueKey === 'string' ? item.issueKey.trim().toUpperCase() : '';
    if (rawKey === '') { unparsedCount += 1; continue; }
    if (!knownKeysUpper.includes(rawKey)) { unknownKeys.push(rawKey); continue; }

    const proposal = readProposal(item, rawKey);
    if (proposal === null) { unparsedCount += 1; continue; }
    proposalsByKey.set(rawKey, proposal);
  }

  const proposals = knownKeysUpper
    .map((issueKey) => proposalsByKey.get(issueKey))
    .filter((proposal): proposal is ReadinessAiProposal => proposal !== undefined);

  return { proposals, unknownKeys, unparsedCount };
}
