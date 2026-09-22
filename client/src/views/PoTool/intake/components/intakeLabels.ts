// intakeLabels.ts — The words the Epic Intake mode shows for its steps, kinds, owners and "who decided" badges, kept in
// one place so every component says the same thing. None of them names the assistant (the no-AI copy scan).

import type { IntakeStepId, ItemKind, ItemOwner, SetAsideReason, SettledBy } from '../epicIntakeModel.ts';

/** The step names in the progress strip. */
export const INTAKE_STEP_LABELS: Record<IntakeStepId, string> = {
  sortNotes: 'Sort the notes',
  decideOwners: 'Decide owners',
  checkDenp: 'Check DENP',
  match: 'Match',
  confirmLabels: 'Labels',
  draft: 'Draft',
  create: 'Create',
  summary: 'Summary',
};

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  work: 'Work',
  risk: 'Risk',
  personAction: 'Action for a person',
  deferred: 'Deferred',
  noise: 'Noise',
};

export const ITEM_OWNER_LABELS: Record<ItemOwner, string> = {
  enrollment: 'Enrollment',
  shared: 'Shared — Enrollment takes its part',
  fulfillment: 'Fulfillment',
  notActionable: 'Not actionable',
};

export const SET_ASIDE_REASON_LABELS: Record<SetAsideReason, string> = {
  headingOrProse: 'Heading or prose',
  duplicateOfAnotherLine: 'Repeats another line',
  notWork: 'Not work',
  contextOnly: 'Context only',
};

/** The badge beside a settled value: a rule decided, it was suggested and accepted, or the PO chose. */
export const SETTLED_BY_LABELS: Record<SettledBy, string> = {
  rule: 'Rule',
  ai: 'Suggested',
  po: 'You',
};
