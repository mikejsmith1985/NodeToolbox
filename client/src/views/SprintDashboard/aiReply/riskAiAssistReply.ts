// riskAiAssistReply.ts — The Risk Management AI round's reply form and reader (GH #499, Google AI Mode).
//
// The round asks the assistant to rewrite every PI risk to the enterprise six-part template. A six-line description
// cannot sit in one table cell, so the fill-in table gives each template part its own column and Toolbox joins them
// back into the description Jira receives. A row missing any part is never completed by guesswork: it is left out of
// the update and named in a follow-up for the same AI chat. The old JSON-array reply still reads as before.

import {
  buildArrayFormatFixPrompt,
  buildMissingRowsFollowUpPrompt,
  listUnansweredKeys,
  readArrayOrTableReply,
} from './arrayReplyRecords.ts';
import { buildRecordReplyInstructions, type ReplyRecordSpec } from '../../../utils/aiReplyRecords.ts';

// ── Types ──

/** A single risk update read from the assistant's reply. */
export interface AiAssistRiskItem {
  key: string;
  description: string;
  riskResponse?: string;
  priority?: string;
}

/** The reply's usable updates, an error to show when there are none, and a follow-up when rows are missing. */
export interface RiskAiReplyReading {
  items: AiAssistRiskItem[];
  errorMessage: string | null;
  /** For the same AI chat — the form again, or only the risks left out. '' when nothing needs asking. */
  followUpPrompt: string;
}

// ── Named constants ──

/** The enterprise template's parts, in order: the table column each fills and the label it carries in Jira. */
const RISK_TEMPLATE_PARTS = [
  { field: 'riskThat', header: 'There is a risk that', templateLabel: 'There is a risk that' },
  { field: 'probability', header: 'Probability', templateLabel: 'Probability', answerHint: 'H, M or L' },
  { field: 'impact', header: 'Impact if realized', templateLabel: 'Impact if Realized' },
  { field: 'dueTo', header: 'Due to', templateLabel: 'Due to' },
  { field: 'mitigation', header: 'Mitigation plan', templateLabel: 'Mitigation Plan', answerHint: 'the strategy and its targeted completion date' },
  { field: 'leadershipAsk', header: 'Leadership ask', templateLabel: 'Leadership Ask' },
] as const;

/** The fill-in table: one row per risk, its key filled in, a column per template part plus ROAM and priority. */
export const RISK_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'riskRefinement',
  replyMarker: 'RISK_TABLE:',
  columns: [
    { field: 'key', header: 'Issue key' },
    ...RISK_TEMPLATE_PARTS,
    { field: 'riskResponse', header: 'ROAM response', answerHint: 'one of Resolve, Own, Accept, Mitigate' },
    { field: 'priority', header: 'Priority', answerHint: 'one of Highest, High, Medium, Low, Lowest' },
  ],
};

const NO_PAYLOAD_MESSAGE = 'No JSON array found in the response. Paste the full AI Assist output.';
const INVALID_JSON_MESSAGE = 'Response contains invalid JSON. Check the pasted text.';
const NOT_ARRAY_MESSAGE = 'Expected a JSON array at the top level.';
const NO_VALID_UPDATES_MESSAGE = 'No valid risk updates found. Check that the issue keys match this PI.';
const UNREADABLE_REPLY_MESSAGE = 'The reply was not in the asked-for table, so it could not be read. Copy the '
  + 'follow-up below into the same AI chat, then paste its reply here.';

// ── Prompt ──

/** The lines the risk prompt ends with: the fill-in rules and the table listing every risk by key. */
export function buildRiskReplyFormLines(riskKeys: readonly string[]): string {
  return buildRecordReplyInstructions(RISK_REPLY_SPEC, riskKeys.map((riskKey) => [riskKey]));
}

// ── Reading ──

/** A cell value as trimmed text, or '' when the cell said nothing. */
function readTextCell(cellValue: unknown): string {
  return typeof cellValue === 'string' || typeof cellValue === 'number' ? String(cellValue).trim() : '';
}

/** One table row as a risk update, or null when any template part is blank — a partial template is never written. */
function readRiskTableRow(tableRow: Record<string, unknown>): AiAssistRiskItem | null {
  const partTexts = RISK_TEMPLATE_PARTS.map((templatePart) => readTextCell(tableRow[templatePart.field]));
  if (partTexts.some((partText) => partText === '')) return null;
  const riskResponse = readTextCell(tableRow.riskResponse);
  const priority = readTextCell(tableRow.priority);
  return {
    key: readTextCell(tableRow.key).toUpperCase(),
    description: RISK_TEMPLATE_PARTS.map((templatePart, partIndex) => `${templatePart.templateLabel}: ${partTexts[partIndex]}`).join('\n'),
    riskResponse: riskResponse || undefined,
    priority: priority || undefined,
  };
}

/** One JSON-array entry as a risk update, exactly as the old reader took it, or null when unusable. */
function readRiskJsonEntry(parsedItem: unknown): AiAssistRiskItem | null {
  if (typeof parsedItem !== 'object' || parsedItem === null) return null;
  const candidate = parsedItem as Record<string, unknown>;
  const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
  if (description === '') return null;
  return {
    key: typeof candidate.key === 'string' ? candidate.key.trim().toUpperCase() : '',
    description,
    riskResponse: typeof candidate.riskResponse === 'string' ? candidate.riskResponse.trim() : undefined,
    priority: typeof candidate.priority === 'string' ? candidate.priority.trim() : undefined,
  };
}

/** Keeps only updates for this PI's risks; a later row for the same key replaces an earlier one (a pasted follow-up). */
function keepKnownRiskUpdates(candidates: readonly (AiAssistRiskItem | null)[], validRiskKeys: ReadonlySet<string>): AiAssistRiskItem[] {
  const updatesByKey = new Map<string, AiAssistRiskItem>();
  for (const candidate of candidates) {
    if (candidate && candidate.key !== '' && validRiskKeys.has(candidate.key)) updatesByKey.set(candidate.key, candidate);
  }
  return [...updatesByKey.values()];
}

/**
 * Reads a pasted reply into risk updates. The table is read first; the old JSON array still works. Only keys in
 * `validRiskKeys` survive. When `askedRiskKeys` is given, a table that left risks out (or left a template part blank)
 * yields a follow-up for just those, and an unreadable reply yields the whole form again.
 */
export function parseRiskAiReply(
  responseText: string,
  validRiskKeys: ReadonlySet<string>,
  askedRiskKeys: readonly string[] = [],
): RiskAiReplyReading {
  const reading = readArrayOrTableReply(responseText, RISK_REPLY_SPEC);
  if (reading.source === 'none') {
    const followUpPrompt = buildArrayFormatFixPrompt(RISK_REPLY_SPEC, askedRiskKeys);
    const failureMessage = { noPayload: NO_PAYLOAD_MESSAGE, invalidJson: INVALID_JSON_MESSAGE, notArray: NOT_ARRAY_MESSAGE }[reading.failure];
    return { items: [], errorMessage: followUpPrompt === '' ? failureMessage : UNREADABLE_REPLY_MESSAGE, followUpPrompt };
  }
  const items = reading.source === 'table'
    ? keepKnownRiskUpdates(reading.items.map(readRiskTableRow), validRiskKeys)
    : keepKnownRiskUpdates(reading.items.map(readRiskJsonEntry), validRiskKeys);
  // A JSON reply was allowed to omit risks, so only a table reply is chased for the rows it left out.
  const missingKeys = reading.source === 'table'
    ? listUnansweredKeys(askedRiskKeys, new Set(items.map((item) => item.key)))
    : [];
  return {
    items,
    errorMessage: items.length === 0 ? NO_VALID_UPDATES_MESSAGE : null,
    followUpPrompt: buildMissingRowsFollowUpPrompt(RISK_REPLY_SPEC, missingKeys),
  };
}
