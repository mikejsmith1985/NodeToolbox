// changeReadinessGuide.ts — Explains, in plain words, every check the change readiness engine runs: when it applies,
// what passes it, and why Release Management cares.
//
// Built from the engine's own names, Formula Card fields and quality-gate questions, and keyed by every readiness item
// id — TypeScript refuses to build if a check is added without an explanation, so the guide cannot fall behind.

import { CHG_TEXT_FIELD_LABELS, FORMULA_CARD_QUALITY_GATE } from '../chgFormula/formulaCard.ts';
import { describeRcpRules, RCP_LAST_DAY_ISO, type RcpRuleDescription } from '../rcp/rcpRules.ts';
import {
  FORMULA_TEXT_SECTIONS,
  READINESS_ITEM_IDS,
  readSectionLabel,
  RECORD_ITEM_LABELS,
  SCHEDULE_GATE_QUESTION_INDEX,
  SCHEDULE_SECTION_NUMBER,
  type FormulaTextSection,
  type ReadinessItemId,
} from './changeReadiness.ts';

/** One check explained. */
export interface ReadinessRuleGuideEntry {
  id: ReadinessItemId;
  label: string;
  appliesTo: string;
  passesWhen: string;
  whyItMatters: string;
  /** The rules inside a check that bundles several (the restricted change period). */
  subRules?: RcpRuleDescription[];
}

type GuideText = Omit<ReadinessRuleGuideEntry, 'id'>;

const EVERY_CHANGE = 'Every change.';
const PRODUCTION_ONLY = 'Production changes (PRD and PFIX) only — on any other change it shows "Does not apply".';
const CONFIRM_PLACEHOLDER_TEXT = 'with no "[CONFIRM: …]" placeholder left for a person to fill in';

function readGateQuestion(gateQuestionIndex: number | null): string | null {
  return gateQuestionIndex === null ? null : FORMULA_CARD_QUALITY_GATE[gateQuestionIndex].question;
}

// Sections with no quality-gate question still matter; these say why in the reviewer's terms.
const UNGATED_SECTION_REASONS: Partial<Record<ReadinessItemId, string>> = {
  formulaRisk: 'Release Management reads the risk and impact to decide how much review the change needs.',
  formulaImplementation: 'Whoever carries out the change follows these steps, so they must be complete.',
};

function describeFormulaTextSection(section: FormulaTextSection): GuideText {
  const fieldNames = section.fieldKeys.map((fieldKey) => CHG_TEXT_FIELD_LABELS[fieldKey]).join(' and ');
  const configItemText = section.id === 'formulaIdentity' ? ', and the change names its configuration item' : '';
  const gateQuestion = readGateQuestion(section.gateQuestionIndex);
  return {
    label: readSectionLabel(section.sectionNumber),
    appliesTo: EVERY_CHANGE,
    passesWhen: `${fieldNames} ${section.fieldKeys.length > 1 ? 'are' : 'is'} written, ${CONFIRM_PLACEHOLDER_TEXT}${configItemText}.`,
    whyItMatters: gateQuestion ? `Release Management asks: ${gateQuestion}` : UNGATED_SECTION_REASONS[section.id] ?? '',
  };
}

function describeFormulaSection(itemId: ReadinessItemId): GuideText {
  const section = FORMULA_TEXT_SECTIONS.find((entry) => entry.id === itemId);
  if (!section) throw new Error(`No Formula Card section for "${itemId}".`);
  return describeFormulaTextSection(section);
}

const RULE_GUIDE: Record<ReadinessItemId, () => GuideText> = {
  owner: () => ({
    label: RECORD_ITEM_LABELS.owner, appliesTo: EVERY_CHANGE, passesWhen: 'The change names an owner.',
    whyItMatters: 'Release Management will not approve a change nobody owns.',
  }),
  riskCheck: () => ({
    label: RECORD_ITEM_LABELS.riskCheck, appliesTo: 'Changes made or modified in the Wizard.',
    passesWhen: 'The AI Risk Check, run on the real ticket in this session, found the change ready.',
    whyItMatters: 'It reads the change and every task together, the way a reviewer would.',
  }),
  rcp: () => ({
    label: RECORD_ITEM_LABELS.rcp,
    appliesTo: `Production changes while the restricted change period is switched on (through ${RCP_LAST_DAY_ISO}).`,
    passesWhen: 'Every rule below passes. A rule the Wizard cannot judge from the record shows "Could not check" for a person to confirm.',
    whyItMatters: 'Change Management adds these requirements to Production changes during the restricted period.',
    subRules: describeRcpRules(),
  }),
  outage: () => ({
    label: RECORD_ITEM_LABELS.outage, appliesTo: PRODUCTION_ONLY, passesWhen: 'At least one planned outage record is linked to the change.',
    whyItMatters: 'Production work needs its outage recorded, so those affected are told.',
  }),
  ctaskCi: () => ({
    label: RECORD_ITEM_LABELS.ctaskCi, appliesTo: 'Changes with tasks.',
    passesWhen: 'Every change task carries the same configuration item as the change.',
    whyItMatters: 'A task on another configuration item hides what the change really touches.',
  }),
  ctaskBackout: () => ({
    label: RECORD_ITEM_LABELS.ctaskBackout, appliesTo: 'Changes with implementation tasks.',
    passesWhen: 'Every implementation task has its own backout plan.',
    whyItMatters: 'If one task fails, the team needs that task\'s own way back.',
  }),
  ctaskDates: () => ({
    label: RECORD_ITEM_LABELS.ctaskDates, appliesTo: 'Changes with tasks.', passesWhen: 'Every change task has a planned start and a planned end; in the Wizard, the tasks also run back to back, in stage order, inside the change\'s window.',
    whyItMatters: 'The tasks\' timeline shows the work fits the change\'s window.',
  }),
  prbs: () => ({
    label: RECORD_ITEM_LABELS.prbs, appliesTo: 'Changes made or modified in the Wizard whose Jira issues mention a problem record.',
    passesWhen: 'Every problem record the issues mention is linked to this change.',
    whyItMatters: 'The problem shows which change fixes it.',
  }),
  testEvidence: () => ({
    label: RECORD_ITEM_LABELS.testEvidence, appliesTo: PRODUCTION_ONLY, passesWhen: 'At least one file is attached to the change; where the change\'s Jira issues are known, every issue has an evidence file and the test plan names each one.',
    whyItMatters: 'Release Management needs proof the change was tested before it reaches Production.',
  }),
  formulaIdentity: () => describeFormulaSection('formulaIdentity'),
  formulaBusinessNeed: () => describeFormulaSection('formulaBusinessNeed'),
  formulaRisk: () => describeFormulaSection('formulaRisk'),
  formulaSchedule: () => ({
    label: readSectionLabel(SCHEDULE_SECTION_NUMBER), appliesTo: EVERY_CHANGE,
    passesWhen: 'The change has a planned start and a planned end, and the end is after the start.',
    whyItMatters: `Release Management asks: ${readGateQuestion(SCHEDULE_GATE_QUESTION_INDEX) ?? ''}`,
  }),
  formulaImplementation: () => describeFormulaSection('formulaImplementation'),
  formulaTesting: () => describeFormulaSection('formulaTesting'),
  formulaBackout: () => describeFormulaSection('formulaBackout'),
};

/**
 * Every check the readiness engine runs, explained, in the order the checklist shows them. Pass the ids a screen does
 * not show (Review leaves out the author-only checks) to leave them out here too.
 */
export function listReadinessRuleGuide(excludedItemIds: ReadonlySet<string> = new Set()): ReadinessRuleGuideEntry[] {
  return READINESS_ITEM_IDS
    .filter((itemId) => !excludedItemIds.has(itemId))
    .map((itemId) => ({ id: itemId, ...RULE_GUIDE[itemId]() }));
}
