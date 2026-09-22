// intakeDefaults.ts — Keeps the Epic Intake a pure copy-and-paste loop: anything the assistant still has not answered
// after its last try gets a safe default, and any line an answer dropped is set aside, so the PO is never asked a
// question (GH #387 feedback — "I didn't have to do anything other than copy paste").
//
// Every default is visible afterwards: the row carries a flag saying what was assumed, so the summary shows it.

import {
  readItemDisplayTitle,
  type Decision,
  type EpicIntake,
  type IntakeItem,
} from './epicIntakeModel.ts';
import { buildManualDraft } from './ai/intakeDraftRound.ts';
import { listOpenDecisions, refreshApplicability, replaceIntakeItem, settleDecision, type OpenDecision } from './intakeChecklist.ts';
import { proveLineCoverage } from './notesOutline.ts';

/** The reason recorded on every assumed answer, so the summary says plainly that nothing better was given. */
const DEFAULT_REASON = 'No usable answer after repeated requests — safe default used';

/** A line no item claimed after an answer regrouped the notes is kept visible, never silently dropped. */
const UNCLAIMED_LINE_NOTE = 'No item claimed this line';

/** Enough passes for the longest chain of decisions (kind → owner → duplicate → label → draft), plus margin. */
const DEFAULT_PASS_LIMIT = 8;

function flagDefault(item: IntakeItem, whatWasAssumed: string): IntakeItem {
  const note = `Assumed ${whatWasAssumed}`;
  return { ...item, reviewFlag: item.reviewFlag ? `${item.reviewFlag} · ${note}` : note };
}

function settleWithDefault<TValue>(decision: Decision<TValue>, value: TValue): Decision<TValue> {
  return settleDecision(decision, value, 'rule', DEFAULT_REASON);
}

/**
 * The safe default for one slot, and how it is described. The defaults lean towards visibility over loss: work
 * rather than noise, Shared rather than handing Enrollment's part away, and a new Epic rather than guessing a match.
 */
function applySlotDefault(item: IntakeItem, slot: string, intake: EpicIntake): IntakeItem {
  const { decisions } = item;
  switch (slot) {
    case 'kind':
      return flagDefault({ ...item, decisions: { ...decisions, kind: settleWithDefault(decisions.kind, 'work') } }, 'it is work');
    case 'owner':
      return flagDefault({ ...item, decisions: { ...decisions, owner: settleWithDefault(decisions.owner, 'shared') } }, 'Shared ownership');
    case 'duplicate':
      return flagDefault({ ...item, decisions: { ...decisions, duplicate: settleWithDefault(decisions.duplicate, { verdict: 'createNew' }) } }, 'no existing Epic');
    case 'label':
      return flagDefault({ ...item, decisions: { ...decisions, label: settleWithDefault(decisions.label, 'Roadmap') } }, 'the Roadmap label');
    case 'draftAccepted':
      return item.draft === null ? flagDefault({ ...item, draft: buildManualDraft(item, intake.lines) }, `a plain draft for "${readItemDisplayTitle(item)}"`) : item;
    default:
      return item;
  }
}

/**
 * A question a default can answer. A written draft waiting for Create is not a question — it is the finish line —
 * and a coverage gap is handled by setting the line aside, not per item.
 */
function isDefaultable(openDecision: OpenDecision, intake: EpicIntake): boolean {
  if (openDecision.itemId === null) {
    return false;
  }
  const item = intake.items.find((candidate) => candidate.id === openDecision.itemId);
  return !(openDecision.slot === 'draftAccepted' && item?.draft !== null);
}

/** Sets aside every line no item claims, so a regrouping answer can never leave the intake stuck on "place this line". */
function setAsideUnclaimedLines(intake: EpicIntake): EpicIntake {
  const { missing } = proveLineCoverage(intake);
  if (missing.length === 0) {
    return intake;
  }
  const setAsideLines = [
    ...intake.setAsideLines,
    ...missing.map((lineNumber) => ({ lineNumber, reason: 'contextOnly' as const, settledBy: 'rule' as const, note: UNCLAIMED_LINE_NOTE })),
  ];
  return { ...intake, setAsideLines };
}

/**
 * Fills every question that would otherwise fall to the PO with a safe, flagged default, and sets aside any line an
 * answer left unclaimed. With the assistant available, a question reaches the PO only after the assistant has had
 * its tries — and now not even then. Runs to a fixed point, since a default can open the next question (a kind of
 * "work" opens the owner).
 */
export function applySafeDefaults(intake: EpicIntake, isAiUnlocked: boolean): EpicIntake {
  if (!isAiUnlocked) {
    return intake;
  }
  let updated = setAsideUnclaimedLines(intake);
  for (let pass = 0; pass < DEFAULT_PASS_LIMIT; pass += 1) {
    const poQuestions = listOpenDecisions(updated, true).filter((openDecision) => openDecision.turn === 'po' && isDefaultable(openDecision, updated));
    if (poQuestions.length === 0) {
      return updated;
    }
    for (const question of poQuestions) {
      const item = updated.items.find((candidate) => candidate.id === question.itemId);
      if (item !== undefined) {
        updated = replaceIntakeItem(updated, refreshApplicability(applySlotDefault(item, question.slot, updated)));
      }
    }
  }
  return updated;
}
