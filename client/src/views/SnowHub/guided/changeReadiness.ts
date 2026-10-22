// changeReadiness.ts — Decides, from facts already read, whether a change is ready for Release Management's approval.
//
// One list of every condition between a change and approval (spec 039 P1, spec 040 Checks + Review): the record
// checks 039 named (owner, risk check, RCP, outage, CTASK rules, PRB links, test evidence) followed by the Formula
// Card sections 1-7 that can be judged from the change's own text and dates. This module is PURE and field-blind:
// it is handed facts and returns items, never reads ServiceNow, and never names a record field — so the Wizard's
// Checks step and the RM Review show the same verdicts by construction. A fact that could not be read always
// becomes "could not check", never "done", because a checklist that claims a pass it never saw is worse than none.

import {
  CHG_TEXT_FIELD_LABELS,
  FORMULA_CARD_FIELDS,
  FORMULA_CARD_QUALITY_GATE,
  type ChgTextFieldKey,
} from '../chgFormula/formulaCard.ts';
import type { RcpCheckResult } from '../rcp/rcpRules.ts';

// ── Types ──

/** Every readiness item, by its stable key. */
export type ReadinessItemId =
  | 'owner' | 'riskCheck' | 'rcp' | 'outage' | 'ctaskCi' | 'ctaskBackout' | 'ctaskDates' | 'prbs' | 'testEvidence'
  | 'formulaIdentity' | 'formulaBusinessNeed' | 'formulaRisk' | 'formulaSchedule' | 'formulaImplementation'
  | 'formulaTesting' | 'formulaBackout';

/** Exactly one of these per item. */
export type ReadinessItemState = 'done' | 'needsAction' | 'notApplicable' | 'couldNotCheck';

/** The screens an item can send the owner to. */
export type ReadinessStepId =
  | 'changeDetails' | 'changeText' | 'schedule' | 'riskCheck' | 'riskCheckFixRound' | 'rcpChecklist'
  | 'ctaskTimeline' | 'problems' | 'testEvidence';

/** The one-click fixes an item can offer; each is run by the same writer the Advanced screen uses. */
export type ReadinessFixId = 'createPlannedOutage' | 'setCtaskConfigItems' | 'linkProblems';

/** What an item's one button does — plain data, so the engine stays pure and the screen decides how to run it. */
export type ReadinessAction =
  | { kind: 'openStep'; stepId: ReadinessStepId; label: string; focusField?: ChgTextFieldKey }
  | { kind: 'fixNow'; fixId: ReadinessFixId; label: string; targetCount: number };

/** One line of the checklist. */
export interface ReadinessItem {
  id: ReadinessItemId;
  label: string;
  state: ReadinessItemState;
  reason: string;
  action: ReadinessAction | null;
}

/** The facts a reader gathers, by name — used to attach a read's failure reason to the items that needed it. */
export type ReadinessFactName =
  | 'change' | 'textFields' | 'environment' | 'plannedWindow' | 'rcpChecks' | 'outages' | 'ctasks' | 'prbs' | 'attachments';

/** The change record itself, as the checklist needs it. */
export interface ReadinessChangeRecord {
  changeNumber: string;
  stateLabel: string;
  ownerName: string;
  configItemName: string;
}

/** One change task, already judged against the change's CTASK rules. */
export interface ReadinessCtask {
  number: string;
  isImplementation: boolean;
  isConfigItemMatching: boolean;
  hasBackoutPlan: boolean;
  hasPlannedDates: boolean;
}

/** Where a PRB the change's issues mention stands. */
export type PrbLinkStatus = 'thisChange' | 'unlinked' | 'otherChange' | 'notInServiceNow';

/** One PRB the change's issues mention. */
export interface ReadinessPrb {
  prbNumber: string;
  linkStatus: PrbLinkStatus;
}

/** Everything the engine judges. A null fact means its read failed. */
export interface ChangeReadinessFacts {
  change: ReadinessChangeRecord | null;
  textFields: Readonly<Record<ChgTextFieldKey, string>> | null;
  isProduction: boolean | null;
  plannedWindow: { plannedStartUtc: string | null; plannedEndUtc: string | null } | null;
  /** This session's risk check review; null means none was run (not a failed read). */
  riskReview: { isReady: boolean } | null;
  /** True while the restricted change period rules are switched on and in force. */
  isRcpActive: boolean;
  rcpChecks: readonly RcpCheckResult[] | null;
  outageCount: number | null;
  ctasks: readonly ReadinessCtask[] | null;
  prbs: readonly ReadinessPrb[] | null;
  attachmentFileNames: readonly string[] | null;
  failureReasons: Partial<Record<ReadinessFactName, string>>;
}

// ── Constants ──

/** Every item, in the order the checklist shows them. */
export const READINESS_ITEM_IDS: readonly ReadinessItemId[] = [
  'owner', 'riskCheck', 'rcp', 'outage', 'ctaskCi', 'ctaskBackout', 'ctaskDates', 'prbs', 'testEvidence',
  'formulaIdentity', 'formulaBusinessNeed', 'formulaRisk', 'formulaSchedule', 'formulaImplementation',
  'formulaTesting', 'formulaBackout',
];

// States in which ServiceNow will not accept edits. Matched loosely on the display label, as Modify's
// NON_EDITABLE_STATE_MARKERS does (instances name closure states differently); "implement" adds 039's edge case.
const NON_EDITABLE_STATE_MARKERS = ['closed', 'cancel', 'implement'];
// A [CONFIRM: …] placeholder AI Assist leaves for a fact only a person can supply.
const CONFIRM_PLACEHOLDER_PATTERN = /\[CONFIRM:[^\]]*\]/i;
const DEFAULT_FAILURE_REASON = 'It could not be read just now.';

/** The record checks' names, shared by the checks and their explanation (changeReadinessGuide.ts). */
export const RECORD_ITEM_LABELS = {
  owner: 'Change owner',
  riskCheck: 'Risk check',
  rcp: 'Restricted change period rules',
  outage: 'Outage record',
  ctaskCi: 'Task configuration items',
  ctaskBackout: 'Task backout plans',
  ctaskDates: 'Task dates',
  prbs: 'Problem records',
  testEvidence: 'Test evidence',
} as const;

// ── Small builders ──

/** An item that passed. */
function buildDoneItem(id: ReadinessItemId, label: string, reason: string): ReadinessItem {
  return { id, label, state: 'done', reason, action: null };
}

/** An item that does not apply to this change. */
function buildNotApplicableItem(id: ReadinessItemId, label: string, reason: string): ReadinessItem {
  return { id, label, state: 'notApplicable', reason, action: null };
}

/** An item that needs the owner, with its one fix. */
function buildNeedsActionItem(id: ReadinessItemId, label: string, reason: string, action: ReadinessAction): ReadinessItem {
  return { id, label, state: 'needsAction', reason, action };
}

/** An item whose fact could not be read — never reported as done. */
function buildCouldNotCheckItem(
  id: ReadinessItemId,
  label: string,
  facts: ChangeReadinessFacts,
  factName: ReadinessFactName,
): ReadinessItem {
  const failureReason = facts.failureReasons[factName] ?? DEFAULT_FAILURE_REASON;
  return { id, label, state: 'couldNotCheck', reason: `Not checked: ${failureReason}`, action: null };
}

/** The Production-only gate: null when the item applies, else the item to return instead. */
function readProductionGate(id: ReadinessItemId, label: string, facts: ChangeReadinessFacts): ReadinessItem | null {
  if (facts.isProduction === null) return buildCouldNotCheckItem(id, label, facts, 'environment');
  return facts.isProduction ? null : buildNotApplicableItem(id, label, 'Only Production changes need this.');
}

/** "1 task" / "3 tasks". */
function countNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ── Record items (spec 039) ──

/** The change has an owner. */
function evaluateOwner(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.owner;
  if (facts.change === null) return buildCouldNotCheckItem('owner', label, facts, 'change');
  const ownerName = facts.change.ownerName.trim();
  return ownerName !== ''
    ? buildDoneItem('owner', label, `Owned by ${ownerName}.`)
    : buildNeedsActionItem('owner', label, 'Nobody owns this change, and Release Management will not approve an unowned change.',
      { kind: 'openStep', stepId: 'changeDetails', label: 'Choose an owner' });
}

/** The risk check was run this session and judged the change ready. */
function evaluateRiskCheck(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.riskCheck;
  const action: ReadinessAction = { kind: 'openStep', stepId: 'riskCheck', label: 'Run the risk check' };
  if (facts.riskReview === null) {
    return buildNeedsActionItem('riskCheck', label, 'The risk check has not been run on this change yet.', action);
  }
  return facts.riskReview.isReady
    ? buildDoneItem('riskCheck', label, 'The risk check found the change ready for approval.')
    : buildNeedsActionItem('riskCheck', label, 'The risk check found gaps that still need fixing.', action);
}

/** Every restricted-change-period rule passes. */
function evaluateRcp(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.rcp;
  const productionGate = readProductionGate('rcp', label, facts);
  if (productionGate) return productionGate;
  if (!facts.isRcpActive) return buildNotApplicableItem('rcp', label, 'The restricted change period rules are not in force.');
  if (facts.rcpChecks === null) return buildCouldNotCheckItem('rcp', label, facts, 'rcpChecks');
  const failedChecks = facts.rcpChecks.filter((check) => check.status === 'fail');
  if (failedChecks.length > 0) {
    return buildNeedsActionItem('rcp', label, `Not met: ${failedChecks.map((check) => check.title).join(', ')}.`,
      { kind: 'openStep', stepId: 'rcpChecklist', label: 'Open the RCP checklist' });
  }
  const unsureChecks = facts.rcpChecks.filter((check) => check.status === 'check');
  return unsureChecks.length > 0
    ? { id: 'rcp', label, state: 'couldNotCheck', reason: `Not checked: ${unsureChecks.map((check) => check.detail).join(' ')}`, action: null }
    : buildDoneItem('rcp', label, 'Every restricted change period rule is met.');
}

/** A Production change has a planned outage linked. */
function evaluateOutage(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.outage;
  const productionGate = readProductionGate('outage', label, facts);
  if (productionGate) return productionGate;
  if (facts.outageCount === null) return buildCouldNotCheckItem('outage', label, facts, 'outages');
  return facts.outageCount > 0
    ? buildDoneItem('outage', label, `${countNoun(facts.outageCount, 'outage is', 'outages are')} linked.`)
    : buildNeedsActionItem('outage', label, 'A Production change needs a planned outage record, and none is linked.',
      { kind: 'fixNow', fixId: 'createPlannedOutage', label: 'Create the planned outage', targetCount: 1 });
}

/** Every change task carries the change's configuration item. */
function evaluateCtaskCi(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.ctaskCi;
  if (facts.ctasks === null) return buildCouldNotCheckItem('ctaskCi', label, facts, 'ctasks');
  if (facts.ctasks.length === 0) return buildNotApplicableItem('ctaskCi', label, 'The change has no tasks.');
  const differingTasks = facts.ctasks.filter((ctask) => !ctask.isConfigItemMatching);
  if (differingTasks.length === 0) return buildDoneItem('ctaskCi', label, 'Every task matches the change\'s configuration item.');
  const reason = `${differingTasks.map((ctask) => ctask.number).join(', ')} ${differingTasks.length === 1 ? 'does' : 'do'} not match the change's configuration item.`;
  if (facts.change !== null && facts.change.configItemName.trim() === '') {
    return buildNeedsActionItem('ctaskCi', label, `${reason} Set the change's configuration item first.`,
      { kind: 'openStep', stepId: 'changeDetails', label: 'Set the configuration item' });
  }
  return buildNeedsActionItem('ctaskCi', label, reason, {
    kind: 'fixNow', fixId: 'setCtaskConfigItems', targetCount: differingTasks.length,
    label: `Set it on ${countNoun(differingTasks.length, 'task', 'tasks')}`,
  });
}

/** Every implementation task has a backout plan. */
function evaluateCtaskBackout(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.ctaskBackout;
  if (facts.ctasks === null) return buildCouldNotCheckItem('ctaskBackout', label, facts, 'ctasks');
  const implementationTasks = facts.ctasks.filter((ctask) => ctask.isImplementation);
  if (implementationTasks.length === 0) return buildNotApplicableItem('ctaskBackout', label, 'The change has no implementation task.');
  const tasksWithoutPlan = implementationTasks.filter((ctask) => !ctask.hasBackoutPlan);
  return tasksWithoutPlan.length === 0
    ? buildDoneItem('ctaskBackout', label, 'Every implementation task has a backout plan.')
    : buildNeedsActionItem('ctaskBackout', label,
      `${tasksWithoutPlan.map((ctask) => ctask.number).join(', ')} ${tasksWithoutPlan.length === 1 ? 'has' : 'have'} no backout plan.`,
      { kind: 'openStep', stepId: 'riskCheckFixRound', label: 'Write the backout plans' });
}

/** Every change task has a planned start and end. */
function evaluateCtaskDates(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.ctaskDates;
  if (facts.ctasks === null) return buildCouldNotCheckItem('ctaskDates', label, facts, 'ctasks');
  if (facts.ctasks.length === 0) return buildNotApplicableItem('ctaskDates', label, 'The change has no tasks.');
  const undatedTasks = facts.ctasks.filter((ctask) => !ctask.hasPlannedDates);
  return undatedTasks.length === 0
    ? buildDoneItem('ctaskDates', label, 'Every task has a planned start and end.')
    : buildNeedsActionItem('ctaskDates', label,
      `${undatedTasks.map((ctask) => ctask.number).join(', ')} ${undatedTasks.length === 1 ? 'has' : 'have'} no planned start or end.`,
      { kind: 'openStep', stepId: 'ctaskTimeline', label: 'Plan the task timeline' });
}

/** Every PRB the change's issues mention is linked to this change. */
function evaluatePrbs(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.prbs;
  if (facts.prbs === null) return buildCouldNotCheckItem('prbs', label, facts, 'prbs');
  if (facts.prbs.length === 0) return buildNotApplicableItem('prbs', label, 'The change\'s issues mention no problem record.');
  const unlinkedPrbs = facts.prbs.filter((prb) => prb.linkStatus !== 'thisChange');
  if (unlinkedPrbs.length === 0) return buildDoneItem('prbs', label, 'Every problem record mentioned is linked to this change.');
  const reason = `${unlinkedPrbs.map((prb) => prb.prbNumber).join(', ')} ${unlinkedPrbs.length === 1 ? 'is' : 'are'} not linked to this change.`;
  const linkablePrbCount = unlinkedPrbs.filter((prb) => prb.linkStatus === 'unlinked').length;
  return linkablePrbCount > 0
    ? buildNeedsActionItem('prbs', label, reason, {
      kind: 'fixNow', fixId: 'linkProblems', targetCount: linkablePrbCount,
      label: `Link ${countNoun(linkablePrbCount, 'problem record', 'problem records')}`,
    })
    : buildNeedsActionItem('prbs', label, `${reason} They are linked elsewhere or missing, so they need a person to decide.`,
      { kind: 'openStep', stepId: 'problems', label: 'Review the problem records' });
}

/** A Production change has test evidence attached. */
function evaluateTestEvidence(facts: ChangeReadinessFacts): ReadinessItem {
  const label = RECORD_ITEM_LABELS.testEvidence;
  const productionGate = readProductionGate('testEvidence', label, facts);
  if (productionGate) return productionGate;
  if (facts.attachmentFileNames === null) return buildCouldNotCheckItem('testEvidence', label, facts, 'attachments');
  return facts.attachmentFileNames.length > 0
    ? buildDoneItem('testEvidence', label, `${countNoun(facts.attachmentFileNames.length, 'file is', 'files are')} attached.`)
    : buildNeedsActionItem('testEvidence', label, 'Nothing is attached to show the change was tested.',
      { kind: 'openStep', stepId: 'testEvidence', label: 'Attach test evidence' });
}

// ── Formula Card sections (spec 040 FR-011) ──

/** One Formula Card section judged from the change's own text. */
export interface FormulaTextSection {
  id: ReadinessItemId;
  sectionNumber: number;
  fieldKeys: readonly ChgTextFieldKey[];
  /** Index into the card's Front-Page Quality Gate, or null when no gate question rests on this section. */
  gateQuestionIndex: number | null;
}

// Which text answers each section, and the quality-gate question Release Management asks of it (formulaCard.ts).
export const FORMULA_TEXT_SECTIONS: readonly FormulaTextSection[] = [
  { id: 'formulaIdentity', sectionNumber: 1, fieldKeys: ['shortDescription', 'description'], gateQuestionIndex: 0 },
  { id: 'formulaBusinessNeed', sectionNumber: 2, fieldKeys: ['justification'], gateQuestionIndex: 1 },
  { id: 'formulaRisk', sectionNumber: 3, fieldKeys: ['riskImpact'], gateQuestionIndex: null },
  { id: 'formulaImplementation', sectionNumber: 5, fieldKeys: ['implementationPlan'], gateQuestionIndex: null },
  { id: 'formulaTesting', sectionNumber: 6, fieldKeys: ['testPlan'], gateQuestionIndex: 4 },
  { id: 'formulaBackout', sectionNumber: 7, fieldKeys: ['backoutPlan'], gateQuestionIndex: 3 },
];
export const SCHEDULE_SECTION_NUMBER = 4;
export const SCHEDULE_GATE_QUESTION_INDEX = 3;

/** "Formula Card 1: Change Identity", named from the card itself so the two never drift. */
export function readSectionLabel(sectionNumber: number): string {
  const sectionName = FORMULA_CARD_FIELDS.find((entry) => entry.section.startsWith(`${sectionNumber}.`))?.section ?? `${sectionNumber}.`;
  return `Formula Card ${sectionName.replace(/^(\d+)\.\s*/, '$1: ')}`;
}

/** The reviewer's question appended to a failing reason, so the owner sees why it matters. */
function appendGateQuestion(reason: string, gateQuestionIndex: number | null): string {
  if (gateQuestionIndex === null) return reason;
  return `${reason} Release Management asks: ${FORMULA_CARD_QUALITY_GATE[gateQuestionIndex].question}`;
}

/** What is wrong with one text field, or null when it is written and has no open placeholder. */
function readTextGap(fieldKey: ChgTextFieldKey, textFields: Readonly<Record<ChgTextFieldKey, string>>): string | null {
  const fieldText = (textFields[fieldKey] ?? '').trim();
  if (fieldText === '') return `${CHG_TEXT_FIELD_LABELS[fieldKey]} is empty.`;
  return CONFIRM_PLACEHOLDER_PATTERN.test(fieldText)
    ? `${CHG_TEXT_FIELD_LABELS[fieldKey]} still has facts marked to confirm.`
    : null;
}

/** One text-answered Formula Card section. */
function evaluateFormulaTextSection(section: FormulaTextSection, facts: ChangeReadinessFacts): ReadinessItem {
  const label = readSectionLabel(section.sectionNumber);
  if (facts.textFields === null) return buildCouldNotCheckItem(section.id, label, facts, 'textFields');
  const textFields = facts.textFields;
  const gapFieldKey = section.fieldKeys.find((fieldKey) => readTextGap(fieldKey, textFields) !== null);
  if (gapFieldKey !== undefined) {
    return buildNeedsActionItem(section.id, label,
      appendGateQuestion(readTextGap(gapFieldKey, textFields) ?? '', section.gateQuestionIndex),
      { kind: 'openStep', stepId: 'changeText', label: `Write the ${CHG_TEXT_FIELD_LABELS[gapFieldKey]}`, focusField: gapFieldKey });
  }
  return evaluateIdentityConfigItem(section, facts) ?? buildDoneItem(section.id, label, 'Written, with nothing left to confirm.');
}

/** Section 1 also needs the change's configuration item; null when that is set or not this section. */
function evaluateIdentityConfigItem(section: FormulaTextSection, facts: ChangeReadinessFacts): ReadinessItem | null {
  if (section.id !== 'formulaIdentity') return null;
  const label = readSectionLabel(section.sectionNumber);
  if (facts.change === null) return buildCouldNotCheckItem(section.id, label, facts, 'change');
  if (facts.change.configItemName.trim() !== '') return null;
  return buildNeedsActionItem(section.id, label,
    appendGateQuestion('The change names no configuration item.', section.gateQuestionIndex),
    { kind: 'openStep', stepId: 'changeDetails', label: 'Set the configuration item' });
}

/** Section 4: the change has a planned start and an end after it. */
function evaluateFormulaSchedule(facts: ChangeReadinessFacts): ReadinessItem {
  const label = readSectionLabel(SCHEDULE_SECTION_NUMBER);
  if (facts.plannedWindow === null) return buildCouldNotCheckItem('formulaSchedule', label, facts, 'plannedWindow');
  const { plannedStartUtc, plannedEndUtc } = facts.plannedWindow;
  const action: ReadinessAction = { kind: 'openStep', stepId: 'schedule', label: 'Set the planned window' };
  if (!plannedStartUtc || !plannedEndUtc) {
    return buildNeedsActionItem('formulaSchedule', label,
      appendGateQuestion('The change has no planned start or end.', SCHEDULE_GATE_QUESTION_INDEX), action);
  }
  return Date.parse(plannedEndUtc) > Date.parse(plannedStartUtc)
    ? buildDoneItem('formulaSchedule', label, 'The planned window is set.')
    : buildNeedsActionItem('formulaSchedule', label,
      appendGateQuestion('The planned end is not after the planned start.', SCHEDULE_GATE_QUESTION_INDEX), action);
}

/** The Formula Card section item with this id. */
function evaluateFormulaItem(itemId: ReadinessItemId, facts: ChangeReadinessFacts): ReadinessItem {
  if (itemId === 'formulaSchedule') return evaluateFormulaSchedule(facts);
  const section = FORMULA_TEXT_SECTIONS.find((entry) => entry.id === itemId);
  if (!section) throw new Error(`No readiness rule for "${itemId}".`);
  return evaluateFormulaTextSection(section, facts);
}

// ── Assembly ──

const RECORD_ITEM_EVALUATORS: Partial<Record<ReadinessItemId, (facts: ChangeReadinessFacts) => ReadinessItem>> = {
  owner: evaluateOwner,
  riskCheck: evaluateRiskCheck,
  rcp: evaluateRcp,
  outage: evaluateOutage,
  ctaskCi: evaluateCtaskCi,
  ctaskBackout: evaluateCtaskBackout,
  ctaskDates: evaluateCtaskDates,
  prbs: evaluatePrbs,
  testEvidence: evaluateTestEvidence,
};

/**
 * Whether ServiceNow will still accept edits to a change in this state. Closed, cancelled and in-implementation
 * changes are read-only, so the checklist offers no fixes for them. An unknown or blank state counts as editable.
 */
export function isChangeEditable(stateLabel: string): boolean {
  const normalizedStateLabel = stateLabel.trim().toLowerCase();
  return !NON_EDITABLE_STATE_MARKERS.some((stateMarker) => normalizedStateLabel.includes(stateMarker));
}

/** On a change that can no longer be edited: no item offers a fix, and each failing one says why. */
function withdrawActionsForLockedChange(items: ReadinessItem[], stateLabel: string): ReadinessItem[] {
  return items.map((item) => (item.state === 'needsAction'
    ? { ...item, action: null, reason: `${item.reason} The change is ${stateLabel}, so it can no longer be edited.` }
    : item));
}

/**
 * Builds the readiness checklist for one change: every item, in order, each with exactly one state and — when
 * it needs action — one fix. Pure: the same facts always give the same checklist, on any screen.
 */
export function buildChangeReadiness(facts: ChangeReadinessFacts): ReadinessItem[] {
  const items = READINESS_ITEM_IDS.map((itemId) => {
    const recordEvaluator = RECORD_ITEM_EVALUATORS[itemId];
    return recordEvaluator ? recordEvaluator(facts) : evaluateFormulaItem(itemId, facts);
  });
  if (facts.change !== null && !isChangeEditable(facts.change.stateLabel)) {
    return withdrawActionsForLockedChange(items, facts.change.stateLabel.trim());
  }
  return items;
}

/**
 * Whether the change is ready for approval: nothing needs action and nothing went unchecked. Items that do not
 * apply never hold a change back.
 */
export function isReady(items: readonly ReadinessItem[]): boolean {
  return items.every((item) => item.state === 'done' || item.state === 'notApplicable');
}
