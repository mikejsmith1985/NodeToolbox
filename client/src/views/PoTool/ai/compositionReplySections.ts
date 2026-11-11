// compositionReplySections.ts — Reads a Feature Composition reply written as a document, the way Google's AI Mode answers.
//
// The composition round used to ask for one JSON object. Google Search AI Mode — the team's only assistant since
// 2026-11 — ignores reply syntax and writes a document instead: an intro sentence, headings ("Summary", "Benefit
// Hypothesis", "Risks"), and a closing offer to help further (GH #499). So the prompt now asks for exactly that: one
// labelled section per part of the Feature, plus a small fill-in table for the Jira fields. This module turns such a
// reply back into the same {kind, feature} JSON text the round's parser already validates, so every existing rule —
// unknown field ids dropped, the nine-section normalisation, no AI attribution, the enrich merge — keeps applying.
//
// Nothing missing is ever guessed: a reply that leaves a section out gets a follow-up for the same chat asking for
// only those sections, and the PO adds its answer under the first reply.

import { buildRecordReplyInstructions, readRecordTableItems, type ReplyRecordSpec } from '../../../utils/aiReplyRecords.ts';
import { splitReplyCellsKeepingBlanks } from '../../../utils/aiReplyTable.ts';
import {
  buildSectionsFollowUpPrompt,
  listMissingSections,
  readReplySections,
  type ReplySection,
} from '../../../utils/aiReplySections.ts';
import { SECTION_LABELS, type SectionLabel } from './featureDocSections.ts';

// ── Types ──

/** Every section a composition reply is read for: the Feature's name, its nine document sections, and the reasoning. */
export type CompositionSectionKey = 'summary' | SectionLabel | 'rationale';

/** A composition reply laid out as the round's parser expects it, or what kept it from being read. */
export interface CompositionReplyReading {
  /** The {kind, feature} JSON text for the parser, or null when the reply held no Feature to read. */
  payloadText: string | null;
  /** The sections the reply left out that a complete answer must carry. */
  missingSections: ReplySection<CompositionSectionKey>[];
}

// ── Named constants ──

/** The marker each document section starts with, in the order the prompt lists them. */
const DOCUMENT_SECTION_MARKERS: Record<SectionLabel, { marker: string; headingPattern: RegExp }> = {
  'Description': { marker: 'DESCRIPTION', headingPattern: /^(?:feature )?description$/i },
  'Benefit Hypothesis': { marker: 'BENEFIT_HYPOTHESIS', headingPattern: /^benefit hypothesis$/i },
  'Acceptance Criteria': { marker: 'ACCEPTANCE_CRITERIA', headingPattern: /^acceptance criteria$/i },
  'Assumptions': { marker: 'ASSUMPTIONS', headingPattern: /^assumptions$/i },
  'Dependencies': { marker: 'DEPENDENCIES', headingPattern: /^dependencies$/i },
  'In Scope': { marker: 'IN_SCOPE', headingPattern: /^in[\s-]scope$/i },
  'Out of Scope': { marker: 'OUT_OF_SCOPE', headingPattern: /^out[\s-]of[\s-]scope$/i },
  'Risks': { marker: 'RISKS', headingPattern: /^risks?$/i },
  // The parenthetical "(NFR)" is removed before a heading is tested, so the long form alone is matched too.
  'Non-Functional Requirements (NFR)': { marker: 'NFR', headingPattern: /^(?:non[\s-]functional requirements|nfrs?)$/i },
};

/** The section that names the Feature — the one thing a proposal cannot do without. */
const SUMMARY_SECTION: ReplySection<CompositionSectionKey> = {
  key: 'summary',
  marker: 'SUMMARY',
  headingPattern: /^(?:feature )?(?:summary|title|name)$/i,
};

/** The section explaining how the draft was framed, shown to the PO alongside the proposal. */
const RATIONALE_SECTION: ReplySection<CompositionSectionKey> = {
  key: 'rationale',
  marker: 'RATIONALE',
  headingPattern: /^(?:rationale|reasoning)$/i,
};

/** The heading the Jira fields table sits under, so its rows never run into the rationale's text. */
const FIELDS_TABLE_MARKER = 'JIRA_FIELDS_TABLE:';

/** The nine document sections, in the canonical order. */
const DOCUMENT_SECTIONS: ReplySection<CompositionSectionKey>[] = SECTION_LABELS.map((label) => ({
  key: label,
  ...DOCUMENT_SECTION_MARKERS[label],
}));

/** Every section, in the order the prompt asks for them. */
export const COMPOSITION_REPLY_SECTIONS: readonly ReplySection<CompositionSectionKey>[] = [
  SUMMARY_SECTION,
  ...DOCUMENT_SECTIONS,
  RATIONALE_SECTION,
];

/** The Jira fields table: one row per field the prompt offers, the value filled in by the assistant. */
function buildFieldsTableSpec(kind: string): ReplyRecordSpec {
  return {
    kind,
    replyMarker: FIELDS_TABLE_MARKER,
    columns: [
      { field: 'fieldId', header: 'Field id' },
      { field: 'fieldName', header: 'Field', isNamingOnly: true },
      { field: 'value', header: 'Value', answerHint: 'the value for this field, or ___ when the material does not say' },
    ],
  };
}

// ── Building the prompt's answer layout ──

/**
 * The lines a composition prompt ends with: one labelled section per part of the Feature, then the Jira fields table.
 * Labels are asked for as "LABEL:" lines; a reply written with readable headings instead is read just the same.
 */
export function buildCompositionAnswerLayout(kind: string, writableFieldNamesById: Readonly<Record<string, string>>): string {
  const fieldRows = Object.entries(writableFieldNamesById).map(([fieldId, fieldName]) => [fieldId, fieldName]);
  return [
    'Answer as a document with these labelled sections, in this order. Start each section on its own line with its',
    'label exactly as written, followed by a colon, then its text on the lines below. Write nothing before SUMMARY,',
    'do not answer in JSON, and ask no questions: where the material is thin, give your best judgement and flag it.',
    '',
    ...COMPOSITION_REPLY_SECTIONS.map((section) => `${section.marker}: [${describeSectionContent(section.key)}]`),
    ...(fieldRows.length > 0
      ? ['', 'Then fill in the Jira fields table below.', buildRecordReplyInstructions(buildFieldsTableSpec(kind), fieldRows)]
      : []),
  ].join('\n');
}

/** What the prompt says goes in one section, in a few words. */
function describeSectionContent(sectionKey: CompositionSectionKey): string {
  if (sectionKey === 'summary') return 'the Feature\'s one-line name';
  if (sectionKey === 'rationale') return 'one or two sentences on how you framed it';
  return `the ${sectionKey} section`;
}

// ── Reading a reply ──

/** The Jira field values the reply's table filled in, keyed by field id. Absent when the reply has no such table. */
function readFieldValues(replyText: string, kind: string): Record<string, unknown> {
  const tableItems = readRecordTableItems(replyText, buildFieldsTableSpec(kind)) ?? [];
  const fieldValues: Record<string, unknown> = {};
  tableItems.forEach((tableItem) => {
    if (tableItem.value !== undefined) fieldValues[String(tableItem.fieldId)] = tableItem.value;
  });
  return fieldValues;
}

/** True for a line that is the fields table's header row ("Field id | Field | Value"), however it is separated. */
function isFieldsTableHeaderLine(replyLine: string): boolean {
  const headerWords = splitReplyCellsKeepingBlanks(replyLine).map((cellText) => cellText.toLowerCase().replace(/[^a-z]+/g, ' ').trim());
  return headerWords.includes('field id') && headerWords.includes('value');
}

/** True for a line that belongs to a table: cells split by "|" or a tab, or a markdown divider row. */
function isTableLine(replyLine: string): boolean {
  return replyLine.includes('|') || replyLine.includes('\t');
}

/**
 * The reply without the fields table, its marker line, and its rows — those are values, never part of a section's
 * prose. Text after the table (a follow-up's answer pasted under the first reply) is kept.
 */
function removeFieldsTable(replyText: string): string {
  const keptLines: string[] = [];
  let isInsideTable = false;
  for (const replyLine of replyText.split(/\r?\n/)) {
    if (replyLine.trim() === FIELDS_TABLE_MARKER) continue;
    if (isFieldsTableHeaderLine(replyLine)) {
      isInsideTable = true;
      continue;
    }
    if (isInsideTable && isTableLine(replyLine)) continue;
    isInsideTable = false;
    keptLines.push(replyLine);
  }
  return keptLines.join('\n');
}

/** The nine sections joined back into one "Label:" document — the shape the description normaliser reads. */
function joinDocumentSections(sectionTexts: Partial<Record<CompositionSectionKey, string>>): string {
  return SECTION_LABELS
    .filter((label) => sectionTexts[label])
    .map((label) => `${label}:\n${sectionTexts[label]}`)
    .join('\n\n');
}

/**
 * Reads a document-shaped composition reply. For a new Feature every section is required; when enriching an existing
 * one the assistant was told to return only what is missing, so only the summary is.
 */
export function readCompositionReplySections(replyText: string, kind: string, isEnrichingExisting: boolean): CompositionReplyReading {
  const sectionTexts = readReplySections(removeFieldsTable(replyText), COMPOSITION_REPLY_SECTIONS);
  const hasAnySection = Object.keys(sectionTexts).length > 0;
  const requiredSections = isEnrichingExisting ? [SUMMARY_SECTION] : COMPOSITION_REPLY_SECTIONS.filter((section) => section !== RATIONALE_SECTION);
  const missingSections = hasAnySection ? listMissingSections(sectionTexts, requiredSections) : [];
  if (!hasAnySection) {
    return { payloadText: null, missingSections };
  }
  const feature = {
    summary: sectionTexts.summary ?? '',
    description: joinDocumentSections(sectionTexts),
    // One Acceptance Criteria section serves both the description and Jira's own acceptance criteria field.
    acceptanceCriteria: sectionTexts['Acceptance Criteria'] ?? '',
    fields: readFieldValues(replyText, kind),
    rationale: sectionTexts.rationale ?? '',
  };
  return { payloadText: JSON.stringify({ kind, feature }), missingSections };
}

/**
 * The follow-up to paste into the same AI chat: the whole layout again for a reply that could not be read, or only the
 * sections left out. Empty when nothing is missing.
 */
export function buildCompositionSectionsFollowUp(reading: CompositionReplyReading): string {
  if (reading.payloadText === null) {
    return buildSectionsFollowUpPrompt(COMPOSITION_REPLY_SECTIONS, true);
  }
  return reading.missingSections.length > 0 ? buildSectionsFollowUpPrompt(reading.missingSections, false) : '';
}
