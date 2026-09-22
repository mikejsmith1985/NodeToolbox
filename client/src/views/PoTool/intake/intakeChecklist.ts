// intakeChecklist.ts — The "twenty questions" engine of an Epic Intake: from the intake alone it works out which
// decisions are still open, whose turn each one is, and the single next thing to do (spec 037,
// contracts/decision-engine.md).
//
// Nothing here stores "the current step". The step is re-derived from the answers every time, so an intake resumed
// tomorrow, or answered out of order, always lands on the right question. Pure: no I/O, no clock.

import {
  createOpenDecision,
  INTAKE_STEP_ORDER,
  readSettledValue,
  type Decision,
  type DecisionSlot,
  type EpicIntake,
  type IntakeItem,
  type IntakeStepId,
  type IntakeTurn,
  type SettledBy,
} from './epicIntakeModel.ts';
import { proveLineCoverage } from './notesOutline.ts';

/** After this many unusable answers for one decision, the decision is handed to the PO instead (FR-007). */
export const MAX_AI_ATTEMPTS_PER_DECISION = 2;

/** An open decision slot, plus the three pseudo-slots that are Toolbox or coverage work rather than a choice. */
export type OpenDecisionSlot = DecisionSlot | 'lineCoverage' | 'candidateSearch' | 'creation';

/** One thing still to be decided or done, with the step it belongs to and whose move it is. */
export interface OpenDecision {
  itemId: string | null;
  slot: OpenDecisionSlot;
  step: IntakeStepId;
  turn: Exclude<IntakeTurn, 'done'>;
  /** Set only for a coverage gap: the line that belongs to no item, or to two. */
  lineNumber?: number;
}

/** Where the intake stands: the current step, whose move it is, how much is open, and what to do next. */
export interface IntakeNextStep {
  step: IntakeStepId;
  turn: IntakeTurn;
  openCount: number;
  nextAction: string;
}

// ── Settling decisions ──

/**
 * Settles a decision. An open slot takes any settler; a settled slot can be changed only by the PO; a slot that
 * does not apply is never settled. This is what keeps a PO's answer safe from every later reply (INV-1).
 */
export function settleDecision<TValue>(
  decision: Decision<TValue>,
  value: TValue,
  settledBy: SettledBy,
  reason: string,
): Decision<TValue> {
  if (decision.state === 'notApplicable') {
    return decision;
  }
  if (decision.state === 'settled' && settledBy !== 'po') {
    return decision;
  }
  return { state: 'settled', value, settledBy, reason, aiAttempts: decision.aiAttempts };
}

/** Counts one unusable answer against an open decision; two of these hand the decision to the PO. */
export function recordAiRejection<TValue>(decision: Decision<TValue>, reason: string): Decision<TValue> {
  if (decision.state !== 'open') {
    return decision;
  }
  return { ...decision, aiAttempts: decision.aiAttempts + 1, lastRejection: reason };
}

/**
 * Hands an open decision to the PO, optionally with a suggestion to show beside the choice — used for close calls,
 * low-confidence matches, and the PO's own "answer these myself".
 */
export function routeDecisionToPo<TValue>(
  decision: Decision<TValue>,
  proposal: TValue | null = null,
  proposalReason: string | null = null,
): Decision<TValue> {
  if (decision.state !== 'open') {
    return decision;
  }
  return {
    ...decision,
    isAwaitingPo: true,
    aiProposal: proposal ?? decision.aiProposal,
    aiReason: proposalReason ?? decision.aiReason,
  };
}

/**
 * Records a suggestion beside an open decision without settling it — used for the label, which only the PO may
 * settle, so the suggestion is shown pre-selected rather than applied.
 */
export function recordAiProposal<TValue>(decision: Decision<TValue>, proposal: TValue, proposalReason: string | null): Decision<TValue> {
  if (decision.state !== 'open') {
    return decision;
  }
  return { ...decision, aiProposal: proposal, aiReason: proposalReason };
}

/** Returns the intake with one item replaced by id; every other item keeps its identity. */
export function replaceIntakeItem(intake: EpicIntake, replacement: IntakeItem): EpicIntake {
  return {
    ...intake,
    items: intake.items.map((item) => (item.id === replacement.id ? replacement : item)),
  };
}

// ── Applicability ──

/** Why a downstream slot does not apply to this item, or null when it does. */
interface ApplicabilityReasons {
  owner: string | null;
  searchTerms: string | null;
  duplicate: string | null;
  label: string | null;
  draftAccepted: string | null;
}

function readApplicabilityReasons(item: IntakeItem): ApplicabilityReasons {
  const kind = readSettledValue(item.decisions.kind);
  const owner = readSettledValue(item.decisions.owner);
  const duplicate = readSettledValue(item.decisions.duplicate);
  const notWorkReason = kind !== null && kind !== 'work' ? `Not work (${kind})` : null;
  const notEnrollmentReason = owner !== null && owner !== 'enrollment' ? `Owned: ${owner}` : null;
  const notNewReason = duplicate !== null && duplicate.verdict !== 'createNew' ? `Duplicate check: ${duplicate.verdict}` : null;
  const searchReason = notWorkReason ?? notEnrollmentReason;
  return {
    owner: notWorkReason,
    searchTerms: searchReason,
    duplicate: searchReason,
    label: searchReason ?? notNewReason,
    draftAccepted: searchReason ?? notNewReason,
  };
}

function applyApplicability<TValue>(decision: Decision<TValue>, notApplicableReason: string | null): Decision<TValue> {
  if (decision.state === 'settled') {
    // A settled answer is kept even if it stops applying, so reversing the upstream answer brings it back intact.
    return decision;
  }
  if (notApplicableReason !== null) {
    return decision.state === 'notApplicable' && decision.reason === notApplicableReason
      ? decision
      : { state: 'notApplicable', reason: notApplicableReason };
  }
  return decision.state === 'notApplicable' ? createOpenDecision<TValue>() : decision;
}

/**
 * Re-marks which of an item's decisions apply, from its settled answers alone. Run after every change: non-work
 * items need no owner, non-Enrollment items need no search, and items an existing Epic covers need no draft.
 */
export function refreshApplicability(item: IntakeItem): IntakeItem {
  const reasons = readApplicabilityReasons(item);
  return {
    ...item,
    decisions: {
      ...item.decisions,
      owner: applyApplicability(item.decisions.owner, reasons.owner),
      searchTerms: applyApplicability(item.decisions.searchTerms, reasons.searchTerms),
      duplicate: applyApplicability(item.decisions.duplicate, reasons.duplicate),
      label: applyApplicability(item.decisions.label, reasons.label),
      draftAccepted: applyApplicability(item.decisions.draftAccepted, reasons.draftAccepted),
    },
  };
}

/** True when the item is Enrollment-owned new work the PO accepted and it has not been created yet. */
export function isItemReadyToCreate(item: IntakeItem): boolean {
  const isEnrollmentWork = readSettledValue(item.decisions.kind) === 'work'
    && readSettledValue(item.decisions.owner) === 'enrollment';
  const isNewEpic = readSettledValue(item.decisions.duplicate)?.verdict === 'createNew';
  const isAccepted = readSettledValue(item.decisions.draftAccepted) === 'accepted';
  return isEnrollmentWork && isNewEpic && isAccepted && item.searchStatus === 'ok' && item.creation.state !== 'created';
}

// ── Open decisions ──

/** The assistant's turn unless it is locked, the slot was handed to the PO, or it has failed too often. */
function readAiOrPoTurn(decision: Decision<unknown>, isAiUnlocked: boolean): 'ai' | 'po' {
  if (decision.state !== 'open' || !isAiUnlocked || decision.isAwaitingPo) {
    return 'po';
  }
  return decision.aiAttempts >= MAX_AI_ATTEMPTS_PER_DECISION ? 'po' : 'ai';
}

function listItemOpenDecisions(item: IntakeItem, isAiUnlocked: boolean): OpenDecision[] {
  const { decisions } = item;
  const openDecisions: OpenDecision[] = [];
  const add = (slot: OpenDecisionSlot, step: IntakeStepId, turn: OpenDecision['turn']): void => {
    openDecisions.push({ itemId: item.id, slot, step, turn });
  };
  const isWork = readSettledValue(decisions.kind) === 'work';
  const isEnrollment = isWork && readSettledValue(decisions.owner) === 'enrollment';
  const isCreateNew = isEnrollment && readSettledValue(decisions.duplicate)?.verdict === 'createNew';

  if (decisions.kind.state === 'open') add('kind', 'sortNotes', readAiOrPoTurn(decisions.kind, isAiUnlocked));
  if (decisions.searchTerms.state === 'open') {
    // Terms are asked alongside the kind; without the assistant, Toolbox derives them from the title at search time.
    const termsTurn = readAiOrPoTurn(decisions.searchTerms, isAiUnlocked);
    if (termsTurn === 'ai') add('searchTerms', 'sortNotes', 'ai');
    else if (isEnrollment) add('searchTerms', 'checkDenp', 'toolbox');
  }
  if (isWork && decisions.owner.state === 'open') add('owner', 'decideOwners', readAiOrPoTurn(decisions.owner, isAiUnlocked));
  if (isEnrollment && decisions.duplicate.state === 'open') {
    if (item.searchStatus === 'ok') add('duplicate', 'match', readAiOrPoTurn(decisions.duplicate, isAiUnlocked));
    else add('candidateSearch', 'checkDenp', 'toolbox');
  }
  if (isCreateNew && decisions.label.state === 'open') add('label', 'confirmLabels', 'po');
  if (isCreateNew && decisions.draftAccepted.state === 'open') {
    add('draftAccepted', 'draft', item.draft === null ? readAiOrPoTurn(decisions.draftAccepted, isAiUnlocked) : 'po');
  }
  if (isItemReadyToCreate(item)) add('creation', 'create', 'toolbox');
  return openDecisions;
}

function listCoverageGaps(intake: EpicIntake): OpenDecision[] {
  const coverage = proveLineCoverage(intake);
  return [...coverage.missing, ...coverage.duplicated].map((lineNumber) => ({
    itemId: null,
    slot: 'lineCoverage' as const,
    step: 'sortNotes' as const,
    turn: 'po' as const,
    lineNumber,
  }));
}

/** Every decision still open across the intake, each with its step and whose turn it is. */
export function listOpenDecisions(intake: EpicIntake, isAiUnlocked: boolean): OpenDecision[] {
  return [
    ...listCoverageGaps(intake),
    ...intake.items.flatMap((item) => listItemOpenDecisions(item, isAiUnlocked)),
  ];
}

// ── Available actions ──

/** Everything the PO can act on right now, across all steps — so no item waits on an unrelated one. */
export interface AvailableActions {
  /** The earliest step with a request the assistant can answer, or null when there is none (or it is locked). */
  assistantStep: IntakeStepId | null;
  /** Closed-choice questions for the PO from every step, in step order. Drafts are not questions. */
  poQuestions: OpenDecision[];
  /** Items whose draft is waiting for the PO to write, edit, accept or decline. */
  draftReviewItemIds: string[];
  /** True when at least one Enrollment item can be checked against DENP now. */
  hasSearchWork: boolean;
  /** True when at least one accepted draft is ready to become an Epic. */
  hasCreateWork: boolean;
}

const TOOLBOX_SEARCH_SLOTS = new Set<OpenDecisionSlot>(['candidateSearch', 'searchTerms']);

function isDraftDecision(openDecision: OpenDecision): boolean {
  return openDecision.slot === 'draftAccepted';
}

/**
 * Lists every action available now, not only the earliest step's. Steps are ordered per item, never across
 * items: an Enrollment item whose owner is settled can be checked against DENP while another item's owner is
 * still a close call, and a draft can be accepted while another item is still being matched. The progress strip
 * still reports the earliest open step; this is what the PO can actually do meanwhile.
 */
export function listAvailableActions(intake: EpicIntake, isAiUnlocked: boolean): AvailableActions {
  const openDecisions = listOpenDecisions(intake, isAiUnlocked);
  const stepIndex = (step: IntakeStepId): number => INTAKE_STEP_ORDER.indexOf(step);
  const byStep = (left: OpenDecision, right: OpenDecision): number => stepIndex(left.step) - stepIndex(right.step);
  const assistantDecisions = openDecisions.filter((openDecision) => openDecision.turn === 'ai').sort(byStep);
  const poDecisions = openDecisions.filter((openDecision) => openDecision.turn === 'po').sort(byStep);
  return {
    assistantStep: assistantDecisions[0]?.step ?? null,
    poQuestions: poDecisions.filter((openDecision) => !isDraftDecision(openDecision)),
    draftReviewItemIds: poDecisions.filter(isDraftDecision).map((openDecision) => openDecision.itemId as string),
    hasSearchWork: openDecisions.some((openDecision) => openDecision.turn === 'toolbox' && TOOLBOX_SEARCH_SLOTS.has(openDecision.slot)),
    hasCreateWork: openDecisions.some((openDecision) => openDecision.slot === 'creation'),
  };
}

// ── Next step ──

/** Plain-language next actions. None of them names the assistant, a prompt, or a reply (the no-AI copy scan). */
const NEXT_ACTION_TEXT: Record<IntakeStepId, Record<Exclude<IntakeTurn, 'done'>, string>> = {
  sortNotes: {
    ai: 'Copy the sorting request below, then paste back the answer.',
    toolbox: 'Toolbox is sorting the notes.',
    po: 'Sort the notes: say what each item is and place any unplaced line.',
  },
  decideOwners: {
    ai: 'Copy the sorting request below, then paste back the answer.',
    toolbox: 'Toolbox is deciding owners.',
    po: 'Decide who owns each close call.',
  },
  checkDenp: {
    ai: 'Copy the sorting request below, then paste back the answer.',
    toolbox: 'Check DENP for open Epics that already cover these items.',
    po: 'Check DENP for open Epics that already cover these items.',
  },
  match: {
    ai: 'Copy the matching request below, then paste back the answer.',
    toolbox: 'Toolbox is matching items to Epics.',
    po: 'Pick the Epic that already covers each item, or create a new one.',
  },
  confirmLabels: {
    ai: 'Confirm Roadmap or Stability for each new Epic.',
    toolbox: 'Confirm Roadmap or Stability for each new Epic.',
    po: 'Confirm Roadmap or Stability for each new Epic.',
  },
  draft: {
    ai: 'Copy the drafting request below, then paste back the answer.',
    toolbox: 'Review each Epic draft.',
    po: 'Review each Epic draft, then accept or decline it.',
  },
  create: {
    ai: 'Create the accepted Epics in DENP.',
    toolbox: 'Create the accepted Epics in DENP.',
    po: 'Create the accepted Epics in DENP.',
  },
  summary: {
    ai: 'Everything is decided. Copy the table.',
    toolbox: 'Everything is decided. Copy the table.',
    po: 'Everything is decided. Copy the table.',
  },
};

const TURN_PRECEDENCE: readonly OpenDecision['turn'][] = ['ai', 'toolbox', 'po'];

/** The decision slots the assistant can be asked to answer, and so the ones the PO can take over. */
const HANDABLE_SLOTS: readonly DecisionSlot[] = ['kind', 'owner', 'searchTerms', 'duplicate', 'draftAccepted'];

function isHandableSlot(slot: OpenDecisionSlot): slot is DecisionSlot {
  return (HANDABLE_SLOTS as readonly string[]).includes(slot);
}

/**
 * "Answer these myself": hands every question the assistant would be asked in this step to the PO instead. Search
 * terms handed over are then taken from each item's title by Toolbox, so the PO is never asked to type them.
 */
export function handStepToPo(intake: EpicIntake, step: IntakeStepId): EpicIntake {
  const aiDecisions = listOpenDecisions(intake, true).filter((openDecision) => openDecision.step === step && openDecision.turn === 'ai');
  return aiDecisions.reduce((currentIntake, openDecision) => {
    const item = currentIntake.items.find((candidate) => candidate.id === openDecision.itemId);
    if (item === undefined || !isHandableSlot(openDecision.slot)) {
      return currentIntake;
    }
    const slot = openDecision.slot;
    const handedDecisions = { ...item.decisions, [slot]: routeDecisionToPo(item.decisions[slot] as Decision<unknown>) };
    return replaceIntakeItem(currentIntake, { ...item, decisions: handedDecisions as IntakeItem['decisions'] });
  }, intake);
}

/**
 * The current step — the earliest step with anything open — and whose move it is there. Within a step one
 * exchange answers every open question, so the assistant's turn wins, then Toolbox's, then the PO's.
 */
export function readIntakeNextStep(intake: EpicIntake, isAiUnlocked: boolean): IntakeNextStep {
  const openDecisions = listOpenDecisions(intake, isAiUnlocked);
  const currentStep = INTAKE_STEP_ORDER.find((step) => openDecisions.some((openDecision) => openDecision.step === step));
  if (currentStep === undefined) {
    return { step: 'summary', turn: 'done', openCount: 0, nextAction: NEXT_ACTION_TEXT.summary.po };
  }
  const stepTurns = openDecisions.filter((openDecision) => openDecision.step === currentStep).map((openDecision) => openDecision.turn);
  const turn = TURN_PRECEDENCE.find((candidateTurn) => stepTurns.includes(candidateTurn)) ?? 'po';
  return { step: currentStep, turn, openCount: openDecisions.length, nextAction: NEXT_ACTION_TEXT[currentStep][turn] };
}
