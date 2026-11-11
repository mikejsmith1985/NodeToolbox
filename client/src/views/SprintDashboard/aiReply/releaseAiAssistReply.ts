// releaseAiAssistReply.ts — The release-notes AI round's answer form and reader (GH #499, Google AI Mode).
//
// The release-notes prompt used to demand one JSON object. Google's AI Mode — the team's only assistant — answers as
// a document instead: an intro line, a summary under a heading, markdown tables, and a closing offer. So the prompt
// now ends with a form the assistant only has to fill in: a RELEASE_SUMMARY line, a table listing every release item
// by key, and a table listing every Feature by key. This module reads that form back. Rows it left out, or left with
// a blank cell, are never written by Toolbox: they are named in a follow-up for the same AI chat.

import {
  buildRecordFillInTable,
  readRecordTableItems,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import { readReplySections, type ReplySection } from '../../../utils/aiReplySections.ts';
import { FILL_IN_BLANK, splitReplyCellsKeepingBlanks } from '../../../utils/aiReplyTable.ts';
import type {
  ReleaseAiAssistFeatureNarrative,
  ReleaseAiAssistPromptInput,
  ReleaseAiAssistTableRow,
} from '../hooks/releaseAiAssistNotes.ts';

// ── Types ──

/** What one release's reply should hold: the release's name, every item's key, and every Feature's key. */
export interface ReleaseAiAssistReplyExpectation {
  releaseName: string;
  issueKeys: string[];
  featureKeys: string[];
}

/** What a reply's form yielded, and what it left out. */
export interface ReleaseReplyFormReading {
  /** True when the reply held the items table — false sends the caller to the old JSON reading. */
  hasItemsTable: boolean;
  releaseSummary: string;
  /** Complete rows only, in the release's own order. */
  items: ReleaseAiAssistTableRow[];
  featureNarratives: ReleaseAiAssistFeatureNarrative[];
  /** Item keys with no row, or a row with a blank cell. */
  missingIssueKeys: string[];
  /** Feature keys with no row at all (a blank narrative is the assistant's answer, not a gap). */
  missingFeatureKeys: string[];
}

// ── Named constants ──

const ITEMS_TABLE_MARKER = 'RELEASE_NOTES_TABLE:';
const FEATURES_TABLE_MARKER = 'FEATURE_NARRATIVES:';

/** The items table: one row per release item, its key filled in. Every answer column is required. */
export const RELEASE_ITEMS_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'releaseNotes',
  replyMarker: ITEMS_TABLE_MARKER,
  columns: [
    { field: 'issueKey', header: 'Issue key' },
    { field: 'title', header: 'Title', answerHint: 'a plain-language title for the item' },
    { field: 'releaseNote', header: 'Release note', answerHint: 'what changed, in one concise sentence' },
    { field: 'customerImpact', header: 'Customer impact', answerHint: 'why users or stakeholders care' },
    { field: 'technicalDetails', header: 'Technical details', answerHint: 'the key implementation or rollout detail' },
    { field: 'risks', header: 'Risks', answerHint: 'a known risk, dependency or follow-up, or "None."' },
    { field: 'validation', header: 'Validation', answerHint: 'how it was or will be validated, or "Validation details pending."' },
  ],
};

/** The Feature table: one row per Feature the release's items deliver. */
export const RELEASE_FEATURES_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'releaseFeatureNarratives',
  replyMarker: FEATURES_TABLE_MARKER,
  columns: [
    { field: 'featureKey', header: 'Feature key' },
    { field: 'narrative', header: 'Narrative', answerHint: '1-2 sentences on what the Feature amounts to in this release' },
  ],
};

/** The summary line: found by its marker, or by the heading an answer engine writes instead. */
const RELEASE_SUMMARY_SECTION: ReplySection<'releaseSummary'> = {
  key: 'releaseSummary',
  marker: 'RELEASE_SUMMARY',
  headingPattern: /^(?:release\s+)?(?:summary|overview)$/i,
};

const ITEM_ANSWER_FIELDS = RELEASE_ITEMS_REPLY_SPEC.columns.slice(1).map((column) => column.field);

// ── The form ──

/** What one release's reply should hold, taken from the same input the prompt was built from. */
export function buildReleaseAiAssistReplyExpectation(input: ReleaseAiAssistPromptInput): ReleaseAiAssistReplyExpectation {
  const featureKeys = input.issues
    .map((releaseIssue) => releaseIssue.featureKey)
    .filter((featureKey): featureKey is string => featureKey !== null);
  return {
    releaseName: input.releaseName,
    issueKeys: input.issues.map((releaseIssue) => releaseIssue.issueKey),
    featureKeys: [...new Set(featureKeys)],
  };
}

/** The rule lines before the form, worded for an assistant that answers in its own shape. */
function describeReleaseFormRules(): string[] {
  const columnHints = [...RELEASE_ITEMS_REPLY_SPEC.columns, ...RELEASE_FEATURES_REPLY_SPEC.columns]
    .filter((column) => column.answerHint)
    .map((column) => `- ${column.header}: ${column.answerHint}`);
  return [
    `Answer ONLY by copying the form below — the RELEASE_SUMMARY line, then each table starting with its label line — `
      + `and replacing every ${FILL_IN_BLANK} with your answer.`,
    'Keep one row per item, in this order, with its first column exactly as written. Do not add, remove or rename '
      + 'rows or columns, and do not answer in JSON, bullet points or paragraphs.',
    'Keep each cell on one line, and never put a "|" inside a cell. Write nothing before or after the form, and ask '
      + 'no questions: when something is unclear, give your best judgement.',
    'What each column takes:',
    ...columnHints,
  ];
}

/** The form itself, for some or all of the release: the summary line and the two pre-filled tables. */
function buildReleaseFormBody(isSummaryAsked: boolean, issueKeys: readonly string[], featureKeys: readonly string[]): string[] {
  const summaryLines = isSummaryAsked ? [`RELEASE_SUMMARY: ${FILL_IN_BLANK} (2-4 sentences on what this release delivers)`, ''] : [];
  const itemLines = issueKeys.length > 0
    ? [ITEMS_TABLE_MARKER, ...buildRecordFillInTable(RELEASE_ITEMS_REPLY_SPEC, issueKeys.map((issueKey) => [issueKey])), '']
    : [];
  const featureLines = featureKeys.length > 0
    ? [FEATURES_TABLE_MARKER, ...buildRecordFillInTable(RELEASE_FEATURES_REPLY_SPEC, featureKeys.map((featureKey) => [featureKey]))]
    : [];
  return [...summaryLines, ...itemLines, ...featureLines];
}

/** The lines the release-notes prompt ends with: the rules, then the whole form to fill in. */
export function buildReleaseReplyFormLines(expectation: ReleaseAiAssistReplyExpectation): string {
  return [...describeReleaseFormRules(), '', ...buildReleaseFormBody(true, expectation.issueKeys, expectation.featureKeys)]
    .join('\n').trimEnd();
}

// ── Reading ──

/** True when these cells are a header row for this table: its key column plus at least one other of its columns. */
function isHeaderRowOf(cells: readonly string[], spec: ReplyRecordSpec): boolean {
  const normalizedCells = new Set(cells.map((cellText) => cellText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  const normalizedHeaders = spec.columns.map((column) => column.header.toLowerCase());
  return normalizedCells.has(normalizedHeaders[0]) && normalizedHeaders.slice(1).some((header) => normalizedCells.has(header));
}

/**
 * The reply's lines split by the table they belong to. Each table's rows follow its own header row, so a follow-up's
 * tables pasted under the first reply's tables are still routed to the right table.
 */
function splitReplyByTable(replyText: string): { itemLines: string[]; featureLines: string[] } {
  const itemLines: string[] = [];
  const featureLines: string[] = [];
  let currentLines: string[] | null = null;
  for (const replyLine of replyText.split(/\r?\n/)) {
    const cells = splitReplyCellsKeepingBlanks(replyLine);
    if (isHeaderRowOf(cells, RELEASE_ITEMS_REPLY_SPEC)) currentLines = itemLines;
    else if (isHeaderRowOf(cells, RELEASE_FEATURES_REPLY_SPEC)) currentLines = featureLines;
    currentLines?.push(replyLine);
  }
  return { itemLines, featureLines };
}

/** The summary's text up to the first table row or label line, or '' when the reply gave none. */
function readReleaseSummary(replyText: string): string {
  const sectionText = readReplySections(replyText, [RELEASE_SUMMARY_SECTION]).releaseSummary ?? '';
  const keptLines: string[] = [];
  for (const sectionLine of sectionText.split('\n')) {
    const isFormLine = splitReplyCellsKeepingBlanks(sectionLine).length > 0
      || sectionLine.trim().startsWith(ITEMS_TABLE_MARKER) || sectionLine.trim().startsWith(FEATURES_TABLE_MARKER);
    if (isFormLine) break;
    keptLines.push(sectionLine);
  }
  const summaryText = keptLines.join('\n').trim();
  // The blank left unfilled, with or without the prompt's own guidance after it, is no summary at all.
  return summaryText.startsWith(FILL_IN_BLANK) ? '' : summaryText;
}

/** One items-table row as a release row, or null when any answer cell is blank — a half row is never shown. */
function readCompleteItemRow(tableItem: Record<string, unknown>): ReleaseAiAssistTableRow | null {
  const cellTexts = ITEM_ANSWER_FIELDS.map((field) => (typeof tableItem[field] === 'string' ? String(tableItem[field]).trim() : ''));
  if (cellTexts.some((cellText) => cellText === '')) return null;
  const [title, releaseNote, customerImpact, technicalDetails, risks, validation] = cellTexts;
  return { issueKey: String(tableItem.issueKey).trim().toUpperCase(), title, releaseNote, customerImpact, technicalDetails, risks, validation };
}

/** The complete rows for this release's keys, in the release's order; a later row for a key replaces an earlier one. */
function readItemRows(itemLines: readonly string[], expectation: ReleaseAiAssistReplyExpectation): ReleaseAiAssistTableRow[] {
  const rowsByKey = new Map<string, ReleaseAiAssistTableRow>();
  for (const tableItem of readRecordTableItems(itemLines.join('\n'), RELEASE_ITEMS_REPLY_SPEC) ?? []) {
    const releaseRow = readCompleteItemRow(tableItem);
    if (releaseRow) rowsByKey.set(releaseRow.issueKey, releaseRow);
  }
  return expectation.issueKeys
    .map((issueKey) => rowsByKey.get(issueKey.toUpperCase()))
    .filter((releaseRow): releaseRow is ReleaseAiAssistTableRow => releaseRow !== undefined)
    .map((releaseRow) => ({ ...releaseRow, issueKey: expectation.issueKeys.find((issueKey) => issueKey.toUpperCase() === releaseRow.issueKey) ?? releaseRow.issueKey }));
}

/** The Feature rows read: narratives for this release's Features, and the keys that had a row at all. */
function readFeatureRows(featureLines: readonly string[], expectation: ReleaseAiAssistReplyExpectation): { narratives: ReleaseAiAssistFeatureNarrative[]; answeredKeys: Set<string> } {
  const expectedKeysByUpper = new Map(expectation.featureKeys.map((featureKey) => [featureKey.toUpperCase(), featureKey]));
  const narrativesByKey = new Map<string, string>();
  const answeredKeys = new Set<string>();
  for (const tableItem of readRecordTableItems(featureLines.join('\n'), RELEASE_FEATURES_REPLY_SPEC) ?? []) {
    const featureKey = expectedKeysByUpper.get(String(tableItem.featureKey).trim().toUpperCase());
    if (!featureKey) continue;
    answeredKeys.add(featureKey);
    const narrative = typeof tableItem.narrative === 'string' ? tableItem.narrative.trim() : '';
    if (narrative !== '') narrativesByKey.set(featureKey, narrative);
  }
  const narratives = expectation.featureKeys
    .filter((featureKey) => narrativesByKey.has(featureKey))
    .map((featureKey) => ({ featureKey, narrative: narrativesByKey.get(featureKey) as string }));
  return { narratives, answeredKeys };
}

/** Reads the filled-in form from a reply. `hasItemsTable` false means the reply was not this form at all. */
export function readReleaseReplyForm(replyText: string, expectation: ReleaseAiAssistReplyExpectation): ReleaseReplyFormReading {
  const { itemLines, featureLines } = splitReplyByTable(replyText);
  const items = readItemRows(itemLines, expectation);
  const { narratives, answeredKeys } = readFeatureRows(featureLines, expectation);
  const answeredIssueKeys = new Set(items.map((releaseRow) => releaseRow.issueKey));
  return {
    hasItemsTable: itemLines.length > 0,
    releaseSummary: readReleaseSummary(replyText),
    items,
    featureNarratives: narratives,
    missingIssueKeys: expectation.issueKeys.filter((issueKey) => !answeredIssueKeys.has(issueKey)),
    missingFeatureKeys: expectation.featureKeys.filter((featureKey) => !answeredKeys.has(featureKey)),
  };
}

// ── Follow-ups ──

/**
 * The follow-up for a form that left parts out: only the summary line and the rows still needed, in the same form.
 * '' when nothing is missing. It never asks again for what the reply already answered.
 */
export function buildReleaseReplyFollowUpPrompt(formReading: ReleaseReplyFormReading): string {
  const isSummaryMissing = formReading.releaseSummary === '';
  const missingParts = [
    ...(isSummaryMissing ? ['the release summary'] : []),
    ...formReading.missingIssueKeys,
    ...formReading.missingFeatureKeys,
  ];
  if (missingParts.length === 0) return '';
  return [
    `Your last reply left out or left blank ${missingParts.join(', ')}. Answer only these now, in the same form.`,
    ...describeReleaseFormRules(),
    '',
    ...buildReleaseFormBody(isSummaryMissing, formReading.missingIssueKeys, formReading.missingFeatureKeys),
  ].join('\n').trimEnd();
}

/** The follow-up for a reply that could not be read at all: the whole form again, asking for the form only. */
export function buildReleaseReplyFormatFixPrompt(expectation: ReleaseAiAssistReplyExpectation): string {
  return [
    'Your last reply was not in the form I need, so it could not be read. Keep the answers you already gave, but put them in this form.',
    buildReleaseReplyFormLines(expectation),
  ].join('\n');
}
