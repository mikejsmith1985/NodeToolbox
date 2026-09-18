// intakeMatchRound.ts — The matching exchange of an Epic Intake: for each Enrollment item, which of the open DENP
// Epics Toolbox found already covers it, if any (spec 037, contracts/ai-rounds.md §2).
//
// The answer may only name a key Toolbox actually found for THAT item. Anything else is rejected, so an Epic that
// does not exist, or belongs to another item, can never be recorded as a match (FR-018).

import {
  readSettledValue,
  type DuplicateVerdict,
  type EpicIntake,
  type IngestOutcome,
  type IngestRejection,
  type IntakeItem,
} from '../epicIntakeModel.ts';
import {
  listOpenDecisions,
  recordAiRejection,
  refreshApplicability,
  replaceIntakeItem,
  routeDecisionToPo,
  settleDecision,
} from '../intakeChecklist.ts';
import { readBoundedString, readReplyEnvelope, readVocabularyValue, resolveItemId } from './intakeReplyEnvelope.ts';

export const MATCH_REPLY_KIND = 'epicIntakeMatch';

/** The longest reason kept from an answer. */
const MAX_REASON_CHARS = 400;

const MATCH_CONFIDENCES = ['high', 'low'] as const;
const MATCH_VERDICTS = ['existing', 'createNew'] as const;

/** A validated match answer for one item. */
export interface MatchAnswer {
  itemId: string;
  verdict: DuplicateVerdict;
  isConfident: boolean;
  reason: string;
}

/** The request text and the items it asks about. */
export interface IntakeRoundRequest {
  text: string;
  itemIds: string[];
}

function readMatchItems(intake: EpicIntake): IntakeItem[] {
  const askedIds = new Set(
    listOpenDecisions(intake, true)
      .filter((openDecision) => openDecision.slot === 'duplicate' && openDecision.turn === 'ai')
      .map((openDecision) => openDecision.itemId),
  );
  return intake.items.filter((item) => askedIds.has(item.id) && item.candidates.length > 0);
}

function describeItemForMatch(item: IntakeItem, intake: EpicIntake): string {
  const itemLines = intake.lines.filter((line) => item.lineNumbers.includes(line.lineNumber)).map((line) => `    ${line.rawText}`);
  const candidateLines = item.candidates.map((candidate) =>
    `    ${candidate.key} [${candidate.statusName}] ${candidate.summary}${candidate.descriptionExcerpt ? ` — ${candidate.descriptionExcerpt}` : ''}`);
  return [`${item.id}: ${item.proposedTitle ?? item.title}`, '  Notes:', ...itemLines, '  Open Epics found for this item:', ...candidateLines].join('\n');
}

/**
 * Builds the matching request for every item whose match is still open and that has candidates. Items with no
 * candidates never reach here — Toolbox already settled them as new.
 */
export function buildMatchRequest(intake: EpicIntake): IntakeRoundRequest {
  const items = readMatchItems(intake);
  const text = [
    'You are helping a Product Owner avoid creating duplicate Jira Epics.',
    `For each item below, decide whether one of the open ${intake.targetProjectKey} Epics listed under it already covers the same scope.`,
    '',
    ...items.map((item) => describeItemForMatch(item, intake)),
    '',
    'Rules:',
    '- Choose a key ONLY from that item\'s own list. Never use a key from another item\'s list, and never invent one.',
    '- verdict "existing" (with "key") when an Epic already covers the scope; "createNew" when none does.',
    '- confidence "high" when you are sure, "low" when the Product Owner should decide.',
    '',
    'Respond ONLY with valid JSON:',
    `{"kind":"${MATCH_REPLY_KIND}","items":[{"id":"item-1","verdict":"existing","key":"DENP-1","confidence":"high","reason":"..."}]}`,
  ].join('\n');
  return { text, itemIds: items.map((item) => item.id) };
}

function readVerdict(rawItem: Record<string, unknown>, item: IntakeItem): DuplicateVerdict | string {
  const verdict = readVocabularyValue(rawItem.verdict, MATCH_VERDICTS);
  if (verdict === null) {
    return `"${String(rawItem.verdict)}" is not a verdict — use "existing" or "createNew".`;
  }
  if (verdict === 'createNew') {
    return { verdict: 'createNew' };
  }
  const rawKey = typeof rawItem.key === 'string' ? rawItem.key.trim().toUpperCase() : '';
  const candidate = item.candidates.find((found) => found.key.toUpperCase() === rawKey);
  return candidate === undefined
    ? `${rawKey || 'The key'} was not among the Epics found for ${item.id}.`
    : { verdict: 'existing', key: candidate.key };
}

/** Validates a pasted matching answer against the items it was asked about. Never throws. */
export function parseMatchReply(replyText: string, intake: EpicIntake, askedItemIds: readonly string[]): IngestOutcome<MatchAnswer> {
  const envelope = readReplyEnvelope(replyText, MATCH_REPLY_KIND);
  if (envelope.wholeReplyError !== null) {
    return { accepted: [], rejected: [{ itemId: null, reason: envelope.wholeReplyError }] };
  }
  const accepted: MatchAnswer[] = [];
  const rejected: IngestRejection[] = [];
  for (const rawItem of envelope.items) {
    const itemId = resolveItemId(rawItem.id, askedItemIds);
    const item = intake.items.find((candidate) => candidate.id === itemId);
    if (itemId === null || item === undefined) {
      rejected.push({ itemId: typeof rawItem.id === 'string' ? rawItem.id : null, reason: `"${String(rawItem.id)}" was not asked about.` });
      continue;
    }
    const verdict = readVerdict(rawItem, item);
    if (typeof verdict === 'string') {
      rejected.push({ itemId, reason: verdict });
      continue;
    }
    const confidence = readVocabularyValue(rawItem.confidence, MATCH_CONFIDENCES) ?? 'low';
    const reason = readBoundedString(rawItem.reason, MAX_REASON_CHARS) ?? 'No reason given.';
    accepted.push({ itemId, verdict, isConfident: confidence === 'high', reason });
  }
  return { accepted, rejected };
}

function describeVerdict(verdict: DuplicateVerdict): string {
  return verdict.verdict === 'existing' ? `Matches ${verdict.key}` : 'No open Epic covers it';
}

function applyAnswerToItem(item: IntakeItem, answer: MatchAnswer): IntakeItem {
  const reason = `${describeVerdict(answer.verdict)}: ${answer.reason}`;
  const duplicate = answer.isConfident
    ? settleDecision(item.decisions.duplicate, answer.verdict, 'ai', reason)
    : routeDecisionToPo(item.decisions.duplicate, answer.verdict, reason);
  return refreshApplicability({ ...item, decisions: { ...item.decisions, duplicate } });
}

/**
 * Applies a parsed matching answer: confident verdicts settle, unsure ones go to the PO with the pick pre-selected,
 * and every asked item that came back unusable or missing counts one attempt against its match.
 */
export function applyMatchOutcome(
  intake: EpicIntake,
  outcome: IngestOutcome<MatchAnswer>,
  askedItemIds: readonly string[],
  nowIso: string,
): EpicIntake {
  const isWholeReplyFailure = outcome.rejected.some((rejection) => rejection.itemId === null) && outcome.accepted.length === 0;
  let updated = intake;
  for (const itemId of askedItemIds) {
    const item = updated.items.find((candidate) => candidate.id === itemId);
    const answer = outcome.accepted.find((candidate) => candidate.itemId === itemId);
    if (item === undefined || readSettledValue(item.decisions.duplicate) !== null) continue;
    if (answer !== undefined) {
      updated = replaceIntakeItem(updated, applyAnswerToItem(item, answer));
    } else if (!isWholeReplyFailure) {
      const reason = outcome.rejected.find((rejection) => rejection.itemId === itemId)?.reason ?? 'No answer for this item.';
      updated = replaceIntakeItem(updated, { ...item, decisions: { ...item.decisions, duplicate: recordAiRejection(item.decisions.duplicate, reason) } });
    }
  }
  const roundRecord = { kind: MATCH_REPLY_KIND, partIndex: 0, partCount: 1, acceptedCount: outcome.accepted.length, rejected: outcome.rejected, ingestedAtIso: nowIso } as const;
  return { ...updated, updatedAtIso: nowIso, roundHistory: [...updated.roundHistory, roundRecord] };
}
