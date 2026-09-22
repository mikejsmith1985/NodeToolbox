// intakePoAnswers.ts — Applies the PO's own answers to an Epic Intake: closed choices for kind, owner, match and label,
// placing a stray line, and accepting or declining a draft (spec 037, contracts/composition-mode.md §3).
//
// A PO answer always wins: it settles the slot as the PO's, and nothing later — a rule or a pasted answer — can
// change it (FR-008). Every function is pure and returns a new intake.

import {
  readSettledValue,
  type DuplicateVerdict,
  type EpicDraft,
  type EpicIntake,
  type IntakeItem,
  type IntakeLabel,
  type ItemKind,
  type ItemOwner,
  type SetAsideReason,
} from './epicIntakeModel.ts';
import { buildManualDraft } from './ai/intakeDraftRound.ts';
import { isItemCreatableAfterReview, refreshApplicability, replaceIntakeItem, settleDecision } from './intakeChecklist.ts';
import { deriveItemFacts } from './intakeFacts.ts';

/** The reason recorded on every decision the PO makes. */
export const PO_ANSWER_REASON = 'Chosen by the PO';

/** Where the PO put a line: into an item, or set aside with a reason. */
export type LinePlacement = { itemId: string } | { setAsideReason: SetAsideReason };

function updateItem(intake: EpicIntake, itemId: string, update: (item: IntakeItem) => IntakeItem, nowIso: string): EpicIntake {
  const item = intake.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return intake;
  }
  return { ...replaceIntakeItem(intake, refreshApplicability(update(item))), updatedAtIso: nowIso };
}

/** Records what the item is. */
export function answerKind(intake: EpicIntake, itemId: string, kind: ItemKind, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({
    ...item,
    decisions: { ...item.decisions, kind: settleDecision(item.decisions.kind, kind, 'po', PO_ANSWER_REASON) },
  }), nowIso);
}

/** Records who owns the item. */
export function answerOwner(intake: EpicIntake, itemId: string, owner: ItemOwner, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({
    ...item,
    decisions: { ...item.decisions, owner: settleDecision(item.decisions.owner, owner, 'po', PO_ANSWER_REASON) },
  }), nowIso);
}

/** Records the duplicate verdict: an existing Epic covers it, a new one is needed, or it is not actionable. */
export function answerDuplicate(intake: EpicIntake, itemId: string, verdict: DuplicateVerdict, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({
    ...item,
    decisions: { ...item.decisions, duplicate: settleDecision(item.decisions.duplicate, verdict, 'po', PO_ANSWER_REASON) },
  }), nowIso);
}

/** Records Roadmap or Stability for a new Epic — the only way the label is ever settled (FR-020). */
export function answerLabel(intake: EpicIntake, itemId: string, label: IntakeLabel, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({
    ...item,
    decisions: { ...item.decisions, label: settleDecision(item.decisions.label, label, 'po', PO_ANSWER_REASON) },
  }), nowIso);
}

/** Stores the PO's working copy of a draft, marked as edited so no later answer replaces it. */
export function editDraft(intake: EpicIntake, itemId: string, draft: EpicDraft, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({ ...item, draft: { ...draft, editedByPo: true } }), nowIso);
}

/** Accepts the draft as shown, which makes the item ready to create. Nothing is written to Jira here. */
export function acceptDraft(intake: EpicIntake, itemId: string, draft: EpicDraft, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({
    ...item,
    draft,
    decisions: { ...item.decisions, draftAccepted: settleDecision(item.decisions.draftAccepted, 'accepted', 'po', PO_ANSWER_REASON) },
  }), nowIso);
}

/** Declines the draft: the item is reported as declined and never created. */
export function declineDraft(intake: EpicIntake, itemId: string, nowIso: string): EpicIntake {
  return updateItem(intake, itemId, (item) => ({
    ...item,
    decisions: { ...item.decisions, draftAccepted: settleDecision(item.decisions.draftAccepted, 'declined', 'po', PO_ANSWER_REASON) },
  }), nowIso);
}

/**
 * Puts one line in exactly one place — an item or the set-aside list — removing it from everywhere else, then
 * re-reads the facts of every item the line left or joined. An item is never left with no lines.
 */
export function placeLine(intake: EpicIntake, lineNumber: number, placement: LinePlacement, nowIso: string): EpicIntake {
  const targetItemId = 'itemId' in placement ? placement.itemId : null;
  const wouldEmptyAnItem = intake.items.some((item) =>
    item.id !== targetItemId && item.lineNumbers.length === 1 && item.lineNumbers[0] === lineNumber);
  if (wouldEmptyAnItem) {
    return intake;
  }
  const touchedItemIds = new Set(intake.items.filter((item) => item.lineNumbers.includes(lineNumber) || item.id === targetItemId).map((item) => item.id));
  const items = intake.items.map((item) => {
    const withoutLine = item.lineNumbers.filter((existing) => existing !== lineNumber);
    const lineNumbers = item.id === targetItemId ? [...withoutLine, lineNumber].sort((left, right) => left - right) : withoutLine;
    return touchedItemIds.has(item.id) ? deriveItemFacts({ ...item, lineNumbers }, intake.lines) : item;
  });
  const setAsideLines = intake.setAsideLines.filter((setAside) => setAside.lineNumber !== lineNumber);
  if ('setAsideReason' in placement) {
    setAsideLines.push({ lineNumber, reason: placement.setAsideReason, settledBy: 'po', note: null });
  }
  return { ...intake, items, setAsideLines, updatedAtIso: nowIso };
}

/**
 * What clicking Create confirms: every item the review table shows as "Create" gets its draft accepted as the PO's —
 * the written draft if there is one, otherwise the plain template built from its own lines. Items already accepted,
 * declined or created are left alone. Nothing is written to Jira here; this only records the PO's confirmation.
 */
export function acceptReviewedDrafts(intake: EpicIntake, isAiUnlocked: boolean, nowIso: string): EpicIntake {
  const items = intake.items.map((item) => {
    if (!isItemCreatableAfterReview(item, isAiUnlocked) || item.decisions.draftAccepted.state === 'settled') {
      return item;
    }
    const draft = item.draft ?? buildManualDraft(item, intake.lines);
    return refreshApplicability({
      ...item,
      draft,
      decisions: { ...item.decisions, draftAccepted: settleDecision(item.decisions.draftAccepted, 'accepted', 'po', 'Accepted at review') },
    });
  });
  return { ...intake, items, updatedAtIso: nowIso };
}

/** True when the item still needs the PO's label — used to show only the questions that matter. */
export function isAwaitingLabel(item: IntakeItem): boolean {
  return readSettledValue(item.decisions.duplicate)?.verdict === 'createNew' && item.decisions.label.state === 'open';
}
