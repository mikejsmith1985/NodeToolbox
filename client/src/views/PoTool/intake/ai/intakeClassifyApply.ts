// intakeClassifyApply.ts — Applies a validated sorting answer to an Epic Intake: regroups lines where the answer says
// the bullets were wrong, then fills only the decisions still open (spec 037, contracts/ai-rounds.md §1).
//
// Two items claiming the same line is resolved by keeping the line where it was — the answer cannot quietly move
// work between items. Rules re-run on every regrouped item, so stated sizes still outrank any estimate.

import {
  readSettledValue,
  type Decision,
  type EpicIntake,
  type IngestRejection,
  type IntakeItem,
  type ItemOwner,
  type RoundRecord,
  type SetAsideLine,
} from '../epicIntakeModel.ts';
import {
  recordAiProposal,
  recordAiRejection,
  refreshApplicability,
  routeDecisionToPo,
  settleDecision,
} from '../intakeChecklist.ts';
import { deriveItemFacts } from '../intakeFacts.ts';
import { decideOwnerFromShare } from '../ownershipRule.ts';
import { CLASSIFY_REPLY_KIND, type ClassifyAnswer, type ClassifyOutcome } from './intakeClassifyRound.ts';

const NO_ANSWER_REASON = 'No answer for this item.';

/** Where one part of the sorting request sits among the parts, for the round's audit line. */
export interface ClassifyPartPosition {
  partIndex: number;
  partCount: number;
}

// ── Regrouping ──

/**
 * Works out each item's final lines. An item keeps its lines unless the answer re-lists them; when two items would
 * end up holding one line, both re-listings are refused and each item keeps what it had.
 */
function resolveRegrouping(items: readonly IntakeItem[], answers: readonly ClassifyAnswer[]): { linesByItemId: Map<string, number[]>; rejected: IngestRejection[] } {
  const proposals = new Map(answers.filter((answer) => answer.lineNumbers !== null).map((answer) => [answer.itemId, answer.lineNumbers as number[]]));
  const rejected: IngestRejection[] = [];
  let hasConflict = true;
  while (hasConflict) {
    hasConflict = false;
    const holdersByLine = new Map<number, string[]>();
    for (const item of items) {
      for (const lineNumber of proposals.get(item.id) ?? item.lineNumbers) {
        holdersByLine.set(lineNumber, [...(holdersByLine.get(lineNumber) ?? []), item.id]);
      }
    }
    for (const [lineNumber, holders] of holdersByLine) {
      const proposers = holders.filter((itemId) => proposals.has(itemId));
      if (holders.length < 2 || proposers.length === 0) continue;
      hasConflict = true;
      for (const itemId of proposers) {
        proposals.delete(itemId);
        rejected.push({ itemId, reason: `Line ${lineNumber} was claimed by more than one item, so this item keeps its lines.` });
      }
    }
  }
  const linesByItemId = new Map(items.map((item) => [item.id, proposals.get(item.id) ?? item.lineNumbers]));
  return { linesByItemId, rejected };
}

function applySetAsides(
  linesByItemId: Map<string, number[]>,
  outcome: ClassifyOutcome,
): { setAsideLines: SetAsideLine[]; rejected: IngestRejection[] } {
  const setAsideLines: SetAsideLine[] = [];
  const rejected: IngestRejection[] = [];
  for (const setAside of outcome.setAside) {
    const holder = [...linesByItemId.entries()].find(([, lineNumbers]) => lineNumbers.includes(setAside.lineNumber));
    if (holder === undefined || holder[1].length === 1) {
      rejected.push({ itemId: holder?.[0] ?? null, reason: `Line ${setAside.lineNumber} is an item's only line; mark the item's kind instead.` });
      continue;
    }
    linesByItemId.set(holder[0], holder[1].filter((lineNumber) => lineNumber !== setAside.lineNumber));
    setAsideLines.push({ lineNumber: setAside.lineNumber, reason: setAside.reason, settledBy: 'ai', note: null });
  }
  return { setAsideLines, rejected };
}

// ── Filling decisions ──

function applyKind(item: IntakeItem, answer: ClassifyAnswer): IntakeItem {
  const { kind } = item.decisions;
  if (kind.state !== 'open') return item;
  const nextKind = answer.kind === null
    ? recordAiRejection(kind, answer.fieldErrors.kind ?? NO_ANSWER_REASON)
    : settleDecision(kind, answer.kind, 'ai', answer.reason ?? 'Sorted from the notes');
  return { ...item, decisions: { ...item.decisions, kind: nextKind } };
}

function recordShare(item: IntakeItem, answer: ClassifyAnswer): IntakeItem {
  const share = answer.enrollmentShare;
  return Number.isInteger(share) && (share as number) >= 0 && (share as number) <= 100 ? { ...item, aiEnrollmentShare: share as number } : item;
}

/** Converts the estimated share to an owner by the stated thresholds — only when the sizes left the owner open. */
function applyShare(item: IntakeItem, answer: ClassifyAnswer): IntakeItem {
  const withShare = recordShare(item, answer);
  const { owner } = withShare.decisions;
  const isNotWork = (readSettledValue(withShare.decisions.kind) ?? 'work') !== 'work';
  if (owner.state !== 'open' || owner.isAwaitingPo || isNotWork) return withShare;
  return { ...withShare, decisions: { ...withShare.decisions, owner: decideOwnerByShare(owner, answer) } };
}

/** Applies the share thresholds to an open owner: settle, hand a close call to the PO, or count a bad answer. */
function decideOwnerByShare(owner: Decision<ItemOwner>, answer: ClassifyAnswer): Decision<ItemOwner> {
  const shareRule = decideOwnerFromShare(answer.enrollmentShare);
  if (shareRule.owner === undefined) {
    return recordAiRejection(owner, answer.hasEnrollmentShare ? shareRule.reason : NO_ANSWER_REASON);
  }
  return shareRule.owner === null
    ? routeDecisionToPo(owner, null, shareRule.reason)
    : settleDecision(owner, shareRule.owner, 'ai', shareRule.reason);
}

function applyTermsAndLabel(item: IntakeItem, answer: ClassifyAnswer): IntakeItem {
  const { searchTerms, label } = item.decisions;
  let nextTerms = searchTerms;
  if (searchTerms.state === 'open') {
    nextTerms = answer.searchTerms === null
      ? recordAiRejection(searchTerms, answer.fieldErrors.searchTerms ?? NO_ANSWER_REASON)
      : settleDecision(searchTerms, answer.searchTerms, 'ai', 'Terms suggested from the notes');
  }
  const nextLabel = answer.labelProposal === null ? label : recordAiProposal(label, answer.labelProposal, answer.reason);
  return { ...item, decisions: { ...item.decisions, searchTerms: nextTerms, label: nextLabel } };
}

function recordMissingAnswer(item: IntakeItem): IntakeItem {
  const { kind, owner, searchTerms } = item.decisions;
  return {
    ...item,
    decisions: {
      ...item.decisions,
      kind: recordAiRejection(kind, NO_ANSWER_REASON),
      owner: owner.state === 'open' && !owner.isAwaitingPo ? recordAiRejection(owner, NO_ANSWER_REASON) : owner,
      searchTerms: recordAiRejection(searchTerms, NO_ANSWER_REASON),
    },
  };
}

function applyAnswerToItem(item: IntakeItem, answer: ClassifyAnswer | undefined, intake: EpicIntake): IntakeItem {
  if (answer === undefined) {
    return refreshApplicability(recordMissingAnswer(item));
  }
  const titled = answer.title === null ? item : { ...item, proposedTitle: answer.title };
  const sorted = applyKind(titled, answer);
  // Facts are re-read before the share is used, so stated sizes on moved lines still decide first.
  const withFacts = deriveItemFacts(refreshApplicability(sorted), intake.lines);
  return refreshApplicability(applyTermsAndLabel(applyShare(withFacts, answer), answer));
}

/**
 * Applies one part's sorting answer. A reply that could not be read at all changes nothing and costs no attempts —
 * the PO simply pastes again. Otherwise every asked item is regrouped, re-read and filled, and each asked item the
 * answer skipped counts one attempt against its open decisions.
 */
export function applyClassifyOutcome(
  intake: EpicIntake,
  outcome: ClassifyOutcome,
  askedItemIds: readonly string[],
  position: ClassifyPartPosition,
  nowIso: string,
): EpicIntake {
  const isWholeReplyFailure = outcome.accepted.length === 0 && outcome.rejected.some((rejection) => rejection.itemId === null) && outcome.setAside.length === 0;
  let updated = intake;
  const extraRejections: IngestRejection[] = [];
  if (!isWholeReplyFailure) {
    const askedItems = intake.items.filter((item) => askedItemIds.includes(item.id));
    const regrouping = resolveRegrouping(askedItems, outcome.accepted);
    const setAsides = applySetAsides(regrouping.linesByItemId, outcome);
    extraRejections.push(...regrouping.rejected, ...setAsides.rejected);
    const regroupedIntake: EpicIntake = {
      ...intake,
      setAsideLines: [...intake.setAsideLines, ...setAsides.setAsideLines],
      items: intake.items.map((item) => ({ ...item, lineNumbers: regrouping.linesByItemId.get(item.id) ?? item.lineNumbers })),
    };
    updated = {
      ...regroupedIntake,
      items: regroupedIntake.items.map((item) => (askedItemIds.includes(item.id)
        ? applyAnswerToItem(item, outcome.accepted.find((answer) => answer.itemId === item.id), regroupedIntake)
        : item)),
    };
  }
  const roundRecord: RoundRecord = {
    kind: CLASSIFY_REPLY_KIND,
    ...position,
    acceptedCount: outcome.accepted.length,
    rejected: [...outcome.rejected, ...extraRejections],
    ingestedAtIso: nowIso,
  };
  return { ...updated, updatedAtIso: nowIso, roundHistory: [...updated.roundHistory, roundRecord] };
}
