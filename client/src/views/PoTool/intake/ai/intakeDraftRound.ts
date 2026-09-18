// intakeDraftRound.ts — The drafting exchange of an Epic Intake: a summary and a nine-section description for each
// Enrollment item that needs a new Epic, written from that item's own lines only (spec 037, contracts/ai-rounds.md §3).
//
// A draft is only ever a proposal: the PO edits, then accepts or declines it, and nothing reaches Jira before that.
// Without the assistant, `buildManualDraft` gives the PO the same nine-section shape to fill in by hand.

import {
  normalizeFeatureDescription,
  SECTION_LABELS,
  stripAiAttribution,
  VALIDATION_MARKER,
} from '../../ai/featureDocSections.ts';
import {
  readItemDisplayTitle,
  readSettledValue,
  type EpicDraft,
  type EpicIntake,
  type IngestOutcome,
  type IngestRejection,
  type IntakeItem,
  type SourceLine,
} from '../epicIntakeModel.ts';
import { listOpenDecisions, recordAiRejection, replaceIntakeItem } from '../intakeChecklist.ts';
import type { IntakeRoundRequest } from './intakeMatchRound.ts';
import { readBoundedString, readReplyEnvelope, resolveItemId } from './intakeReplyEnvelope.ts';

export const DRAFT_REPLY_KIND = 'epicIntakeDraft';

/** Jira's limit on an issue summary. */
export const MAX_EPIC_SUMMARY_CHARS = 255;

/** Generous ceiling on a description, so a runaway answer cannot bloat the saved intake. */
const MAX_DESCRIPTION_CHARS = 30_000;

/** A validated draft for one item. */
export interface DraftAnswer {
  itemId: string;
  draft: EpicDraft;
}

function readDraftItems(intake: EpicIntake): IntakeItem[] {
  const askedIds = new Set(
    listOpenDecisions(intake, true)
      .filter((openDecision) => openDecision.slot === 'draftAccepted' && openDecision.turn === 'ai')
      .map((openDecision) => openDecision.itemId),
  );
  return intake.items.filter((item) => askedIds.has(item.id));
}

function readItemLines(item: IntakeItem, lines: readonly SourceLine[]): SourceLine[] {
  return lines.filter((line) => item.lineNumbers.includes(line.lineNumber));
}

function describeItemForDraft(item: IntakeItem, intake: EpicIntake): string {
  const label = readSettledValue(item.decisions.label);
  const itemLines = readItemLines(item, intake.lines).map((line) => `    ${line.rawText}`);
  return [`${item.id}: ${readItemDisplayTitle(item)}${label ? ` (label: ${label})` : ''}`, '  Notes:', ...itemLines].join('\n');
}

/**
 * Builds the drafting request for every new Enrollment Epic still without a draft. The nine sections and the
 * validation markers come from the same constants the normaliser uses, so the two can never disagree.
 */
export function buildDraftRequest(intake: EpicIntake): IntakeRoundRequest {
  const items = readDraftItems(intake);
  const text = [
    `You are helping a Product Owner write new Jira Epics for the ${intake.targetProjectKey} project.`,
    'For each item, write a summary (one line, under 255 characters) and a description.',
    '',
    ...items.map((item) => describeItemForDraft(item, intake)),
    '',
    'The description MUST contain these nine sections, in this order, each as "Label:" on its own line:',
    ...SECTION_LABELS.map((label) => `- ${label}`),
    `Where the notes do not support a section, still include it and start it with ${VALIDATION_MARKER.business},`,
    `${VALIDATION_MARKER.technical} or ${VALIDATION_MARKER.both}.`,
    'Use ONLY that item\'s own notes. Do not mention sizes or costs. Do not say who or what wrote the text.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${DRAFT_REPLY_KIND}","items":[{"id":"item-1","summary":"...","description":"Description:\\n..."}]}`,
  ].join('\n');
  return { text, itemIds: items.map((item) => item.id) };
}

/** Normalises any description to the nine-section document and removes authorship claims (FR-021). */
function normalizeDraftDescription(description: string): string {
  return stripAiAttribution(normalizeFeatureDescription(description));
}

/** Validates a pasted drafting answer. Never throws. */
export function parseDraftReply(replyText: string, askedItemIds: readonly string[]): IngestOutcome<DraftAnswer> {
  const envelope = readReplyEnvelope(replyText, DRAFT_REPLY_KIND);
  if (envelope.wholeReplyError !== null) {
    return { accepted: [], rejected: [{ itemId: null, reason: envelope.wholeReplyError }] };
  }
  const accepted: DraftAnswer[] = [];
  const rejected: IngestRejection[] = [];
  for (const rawItem of envelope.items) {
    const itemId = resolveItemId(rawItem.id, askedItemIds);
    if (itemId === null) {
      rejected.push({ itemId: typeof rawItem.id === 'string' ? rawItem.id : null, reason: `"${String(rawItem.id)}" was not asked about.` });
      continue;
    }
    const summary = readBoundedString(rawItem.summary, MAX_EPIC_SUMMARY_CHARS);
    const description = readBoundedString(rawItem.description, MAX_DESCRIPTION_CHARS);
    if (summary === null || description === null) {
      rejected.push({ itemId, reason: `The summary must be 1–${MAX_EPIC_SUMMARY_CHARS} characters and the description must not be empty.` });
      continue;
    }
    accepted.push({ itemId, draft: { summary, description: normalizeDraftDescription(description), source: 'ai', editedByPo: false } });
  }
  return { accepted, rejected };
}

/**
 * The draft the PO starts from without the assistant: the item's title as the summary and its lines as the
 * Description section, with the other eight sections flagged for validation.
 */
export function buildManualDraft(item: IntakeItem, lines: readonly SourceLine[]): EpicDraft {
  const bulletList = readItemLines(item, lines).map((line) => `- ${line.text}`).join('\n');
  return {
    summary: readItemDisplayTitle(item).slice(0, MAX_EPIC_SUMMARY_CHARS),
    description: normalizeDraftDescription(`Description:\n${bulletList}`),
    source: 'po',
    editedByPo: false,
  };
}

function applyDraftToItem(item: IntakeItem, answer: DraftAnswer | undefined, rejectionReason: string | null): IntakeItem {
  if (answer !== undefined) {
    // A draft the PO has already edited is theirs; a later answer never replaces it.
    return item.draft?.editedByPo ? item : { ...item, draft: answer.draft };
  }
  if (rejectionReason === null) {
    return item;
  }
  return { ...item, decisions: { ...item.decisions, draftAccepted: recordAiRejection(item.decisions.draftAccepted, rejectionReason) } };
}

/** Applies a parsed drafting answer; asked items that came back unusable or missing each count one attempt. */
export function applyDraftOutcome(
  intake: EpicIntake,
  outcome: IngestOutcome<DraftAnswer>,
  askedItemIds: readonly string[],
  nowIso: string,
): EpicIntake {
  const isWholeReplyFailure = outcome.accepted.length === 0 && outcome.rejected.some((rejection) => rejection.itemId === null);
  let updated = intake;
  for (const itemId of askedItemIds) {
    const item = updated.items.find((candidate) => candidate.id === itemId);
    if (item === undefined) continue;
    const answer = outcome.accepted.find((candidate) => candidate.itemId === itemId);
    const rejectionReason = isWholeReplyFailure
      ? null
      : outcome.rejected.find((rejection) => rejection.itemId === itemId)?.reason ?? 'No draft for this item.';
    updated = replaceIntakeItem(updated, applyDraftToItem(item, answer, rejectionReason));
  }
  const roundRecord = { kind: DRAFT_REPLY_KIND, partIndex: 0, partCount: 1, acceptedCount: outcome.accepted.length, rejected: outcome.rejected, ingestedAtIso: nowIso } as const;
  return { ...updated, updatedAtIso: nowIso, roundHistory: [...updated.roundHistory, roundRecord] };
}
