// intakeDraftRound.ts — The shape of a new Epic's draft: a summary and a nine-section description written from an
// item's own lines only (spec 037, contracts/ai-rounds.md §3).
//
// A draft is only ever a proposal: the PO reviews it in the table, and clicking Create is the confirmation. The
// exchange that asks for drafts is `intakeResolveRound.ts`; this module owns reading one drafted answer, the
// Enrollment-scope suffix for Shared work, and `buildManualDraft` — the same nine-section shape for the PO to fill
// in by hand when there is no assistant.

import { normalizeFeatureDescription, stripAiAttribution } from '../../ai/featureDocSections.ts';
import {
  readItemDisplayTitle,
  readSettledValue,
  type EpicDraft,
  type IntakeItem,
  type SourceLine,
} from '../epicIntakeModel.ts';
import { readBoundedString, type RawReplyItem } from './intakeReplyEnvelope.ts';

/** Jira's limit on an issue summary. */
export const MAX_EPIC_SUMMARY_CHARS = 255;

/** Generous ceiling on a description, so a runaway answer cannot bloat the saved intake. */
const MAX_DESCRIPTION_CHARS = 30_000;

/** Appended to a Shared item's Epic summary, so the Epic is plainly only Enrollment's part of the work. */
export const SHARED_SCOPE_SUFFIX = ' (Enrollment scope)';

function readItemLines(item: IntakeItem, lines: readonly SourceLine[]): SourceLine[] {
  return lines.filter((line) => item.lineNumbers.includes(line.lineNumber));
}

/** True when both teams own part of the item, so its Epic covers Enrollment's part only. */
export function isSharedItem(item: IntakeItem): boolean {
  return readSettledValue(item.decisions.owner) === 'shared';
}

/**
 * Adds the Enrollment-scope suffix to a Shared item's summary — once, and within Jira's summary limit (the title
 * is shortened, never the suffix). Toolbox applies it itself rather than trusting a pasted answer to include it.
 */
export function applySharedScopeSuffix(summary: string, isShared: boolean): string {
  const trimmedSummary = summary.trim();
  if (!isShared || trimmedSummary.endsWith(SHARED_SCOPE_SUFFIX.trim())) {
    return trimmedSummary;
  }
  const roomForTitle = MAX_EPIC_SUMMARY_CHARS - SHARED_SCOPE_SUFFIX.length;
  return `${trimmedSummary.slice(0, roomForTitle).trimEnd()}${SHARED_SCOPE_SUFFIX}`;
}

/** Normalises any description to the nine-section document and removes authorship claims (FR-021). */
function normalizeDraftDescription(description: string): string {
  return stripAiAttribution(normalizeFeatureDescription(description));
}

/**
 * Reads the summary and description one answer wrote for an item. Returns the draft — description already
 * normalised to the nine sections — or a plain sentence saying why it cannot be used. The Shared-scope suffix is
 * added later, where the item's owner is known.
 */
export function readDraftFromReply(rawItem: RawReplyItem): EpicDraft | string {
  const summary = readBoundedString(rawItem.summary, MAX_EPIC_SUMMARY_CHARS);
  const description = readBoundedString(rawItem.description, MAX_DESCRIPTION_CHARS);
  if (summary === null || description === null) {
    return `The summary must be 1–${MAX_EPIC_SUMMARY_CHARS} characters and the description must not be empty.`;
  }
  return { summary, description: normalizeDraftDescription(description), source: 'ai', editedByPo: false };
}

/**
 * The draft the PO starts from without the assistant: the item's title as the summary and its lines as the
 * Description section, with the other eight sections flagged for validation.
 */
export function buildManualDraft(item: IntakeItem, lines: readonly SourceLine[]): EpicDraft {
  const bulletList = readItemLines(item, lines).map((line) => `- ${line.text}`).join('\n');
  return {
    summary: applySharedScopeSuffix(readItemDisplayTitle(item).slice(0, MAX_EPIC_SUMMARY_CHARS), isSharedItem(item)),
    description: normalizeDraftDescription(`Description:\n${bulletList}`),
    source: 'po',
    editedByPo: false,
  };
}
