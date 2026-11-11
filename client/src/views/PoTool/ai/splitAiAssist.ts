// splitAiAssist.ts — The optional AI accelerator for the Feature Splitter.
//
// Toolbox generates a prompt for the PO to run in their own assistant, and ingests a strictly-validated
// reply. It never calls an AI service and opens no outbound channel. Ingesting writes nothing to Jira:
// proposals land in the same editable controls the PO types into, unaccepted, and Jira is reached only
// by the separate Commit button they already use.
//
// Validation is strict about IDENTITY and lenient about CONTENT. A reply of the wrong kind is rejected
// whole — that guard is what stops a stray payload from another surface being read as a split. But a bad
// field kills only its own increment: a split proposes a BATCH, and losing four good increments to one
// malformed fifth would be hostile.
//
// See specs/017-po-feature-tools/contracts/ai-assist-json.md.
//
// The reply is asked for as a fill-in table of numbered rows, because Google's AI Mode — the team's only assistant —
// ignores JSON instructions but completes a table it is handed (GH #499). The table is read back into the same JSON
// shape validated below; a JSON reply is still read. A reply that cannot be read, or that names an increment without a
// summary, gets a follow-up for the same AI chat — a missing summary is never made up.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  readRecordTableItems,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import { createEmptyIncrement, type ProposedIncrement, type SourceFeatureSnapshot } from '../drafts/draftModel';
import type { SplitHeuristic } from '../coaching/splitHeuristics';

/** The fixed discriminator the assistant must echo, so a stray JSON blob is never misread as a split. */
const SPLIT_INGEST_KIND = 'featureSplitIngest';

/**
 * How many numbered rows the fill-in table offers. A good split is three to five increments; six leaves room without
 * inviting the assistant to slice the Feature into crumbs. Unused rows are left blank and ignored.
 */
export const MAX_SPLIT_TABLE_ROWS = 6;

/** The fill-in table the prompt ends with: one numbered row per increment, each cell kept to one line. */
export const SPLIT_REPLY_SPEC: ReplyRecordSpec = {
  kind: SPLIT_INGEST_KIND,
  replyMarker: 'SPLIT_TABLE:',
  columns: [
    { field: 'incrementNumber', header: 'Increment' },
    { field: 'summary', header: 'Summary', answerHint: 'the new Feature\'s one-line name — leave ___ on rows you do not need' },
    { field: 'description', header: 'Description', answerHint: 'what it delivers and for whom, in one or two sentences' },
    { field: 'acceptanceCriteria', header: 'Acceptance criteria', answerHint: 'testable criteria separated by "; "' },
    { field: 'rationale', header: 'Rationale', answerHint: 'which heuristic it follows and why it stands alone' },
  ],
};

/** The numbered rows the table offers: "1" … "6". */
function listSplitRowNumbers(): string[][] {
  return Array.from({ length: MAX_SPLIT_TABLE_ROWS }, (_unused, rowIndex) => [String(rowIndex + 1)]);
}

/** What an ingest produced: the items worth showing, and a plain account of what was skipped. */
export interface AiIngestResult<TItem> {
  items: TItem[];
  errors: string[];
  /** A follow-up for the same AI chat when the reply was unreadable or left something out; absent when none. */
  followUpPrompt?: string;
}

/**
 * Builds the prompt a PO copies into their assistant.
 *
 * The coaching goes in too, so the assistant proposes splits along the same lines the tab teaches —
 * otherwise the AI half and the deterministic half would pull in different directions.
 */
export function buildSplitPrompt(
  source: SourceFeatureSnapshot,
  heuristics: readonly SplitHeuristic[],
): string {
  const heuristicLines = heuristics
    .map((heuristic) => `  - ${heuristic.name}: ${heuristic.description}`)
    .join('\n');

  return [
    `You are helping a Product Owner split one large Jira ${source.issueTypeName || 'Feature'} into smaller ones that each deliver value on their own.`,
    '',
    `The ${source.issueTypeName || 'Feature'} to split is ${source.key}:`,
    '',
    `Summary: ${source.summary}`,
    `Description: ${source.description || '(none)'}`,
    `Acceptance criteria: ${source.acceptanceCriteria || '(none)'}`,
    '',
    'Use one or more of these established splitting heuristics:',
    heuristicLines,
    '',
    'Each proposed increment MUST:',
    '  - deliver something a user or the business would notice, on its own',
    '  - be releasable without waiting for its siblings',
    '  - be small enough to finish comfortably inside one Program Increment',
    '  - be worth doing even if the remaining increments were never built',
    '',
    'Do not invent scope that is not implied by the text above. Do not propose issue types, projects, or',
    'field names — those are chosen by the Product Owner, not by you.',
    '',
    buildRecordReplyInstructions(SPLIT_REPLY_SPEC, listSplitRowNumbers()),
  ].join('\n');
}

/** Coerces anything to a trimmed string, so a non-string field degrades rather than throwing. */
function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** True for a table row that says something beyond its own number — an unused row is not an increment. */
function hasRowContent(tableRow: Record<string, unknown>): boolean {
  return Object.keys(tableRow).some((fieldName) => fieldName !== 'incrementNumber');
}

/**
 * Turns a table reply's rows into the "increments" the validator below reads. Unused rows are dropped quietly; the
 * kind is the round's own, so the identity check still applies. A JSON reply passes through untouched.
 */
function convertTableRowsToIncrements(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.items) || payload.increments !== undefined || payload.kind !== SPLIT_INGEST_KIND) {
    return payload;
  }
  const filledRows = (payload.items as Record<string, unknown>[]).filter(hasRowContent);
  return { ...payload, increments: filledRows };
}

/** The table rows that carry content but no summary — the one thing an increment cannot do without. */
function listRowsMissingSummary(responseText: string): string[] {
  const tableRows = readRecordTableItems(responseText, SPLIT_REPLY_SPEC) ?? [];
  return tableRows
    .filter((tableRow) => hasRowContent(tableRow) && tableRow.summary === undefined)
    .map((tableRow) => String(tableRow.incrementNumber));
}

/**
 * The follow-up to paste into the same AI chat, or '' when there is nothing to ask. An unreadable reply gets the table
 * again; rows that described an increment without naming it get a table of only those rows.
 */
export function buildSplitFollowUp(responseText: string): string {
  const { payload } = readPayloadObject(responseText);
  // A table with every row left blank proposes nothing, so it is asked for again just like an unreadable reply.
  const isEmptyTable = Array.isArray(payload?.items) && Array.isArray(payload?.increments) && payload.increments.length === 0;
  if (payload === undefined || isEmptyTable) {
    return buildRecordFormatFixPrompt(SPLIT_REPLY_SPEC, listSplitRowNumbers());
  }
  const rowsMissingSummary = listRowsMissingSummary(responseText);
  if (rowsMissingSummary.length === 0) {
    return '';
  }
  return [
    `Your last reply gave no summary for increment ${rowsMissingSummary.join(', ')}. Fill in those rows again, with a summary.`,
    buildRecordReplyInstructions(SPLIT_REPLY_SPEC, rowsMissingSummary.map((rowNumber) => [rowNumber])),
  ].join('\n');
}

/** Reads the payload object, turning both unreadable cases into one plain error. */
function readPayloadObject(responseText: string): { payload?: Record<string, unknown>; error?: string } {
  let jsonText: string;
  try {
    jsonText = extractRecordReplyPayload(responseText, SPLIT_REPLY_SPEC);
  } catch {
    return { error: 'No JSON object found in the assistant response.' };
  }
  try {
    const parsed: unknown = JSON.parse(jsonText);
    if (typeof parsed !== 'object' || parsed === null) {
      return { error: 'The assistant response was not valid JSON.' };
    }
    return { payload: convertTableRowsToIncrements(parsed as Record<string, unknown>) };
  } catch {
    return { error: 'The assistant response was not valid JSON.' };
  }
}

/**
 * Ingests a split proposal.
 *
 * Never throws. Every increment lands `isAccepted: false` — the PO decides, one at a time.
 */
export function parseSplitIngest(
  responseText: string,
  existingIncrements: readonly ProposedIncrement[],
): AiIngestResult<ProposedIncrement> {
  const { payload, error } = readPayloadObject(responseText);
  if (!payload) {
    return { items: [], errors: [error!] };
  }

  // Strict on identity: the whole payload dies if it is not what we asked for.
  if (payload.kind !== SPLIT_INGEST_KIND) {
    return {
      items: [],
      errors: [`Response kind "${String(payload.kind)}" is not ${SPLIT_INGEST_KIND}.`],
    };
  }
  if (!Array.isArray(payload.increments)) {
    return { items: [], errors: ['The "increments" field is missing or is not an array.'] };
  }

  const items: ProposedIncrement[] = [];
  const errors: string[] = [];
  let mintedIndex = existingIncrements.length;

  payload.increments.forEach((rawIncrement: unknown, incrementIndex: number) => {
    if (typeof rawIncrement !== 'object' || rawIncrement === null) {
      errors.push(`Increment at position ${incrementIndex + 1} could not be read.`);
      return;
    }
    const candidate = rawIncrement as Record<string, unknown>;
    const summary = readTrimmedString(candidate.summary);
    // A summary is the one thing an increment cannot do without — it is the issue's name.
    if (summary === '') {
      errors.push(`Increment at position ${incrementIndex + 1} is missing a summary.`);
      return;
    }

    mintedIndex += 1;
    items.push({
      ...createEmptyIncrement(`increment-ai-${mintedIndex}`),
      summary,
      description: readTrimmedString(candidate.description),
      acceptanceCriteria: readTrimmedString(candidate.acceptanceCriteria),
      rationale: readTrimmedString(candidate.rationale),
      origin: 'ai',
      // The PO accepts each one deliberately. Nothing an assistant says is applied on its say-so.
      isAccepted: false,
    });
  });

  return { items, errors };
}
