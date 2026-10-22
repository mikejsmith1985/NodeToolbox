// changeWizardSteps.ts — The change wizard's steps, the rule for when each is done, and where a resumed job lands (pure).
//
// The step a job is on is DERIVED from its entries, never trusted from storage (contracts/wizard-shell.md "Resume"):
// a resumed job can never sit on a step whose prerequisites are missing. Each step's own data checks arrive here as
// plain lists of gaps, so this module needs no ServiceNow or React and is unit-tested on its own.

import type { GuidedFlowPhase, GuidedFlowStep } from '../../components/GuidedFlow/GuidedFlowShell.tsx';

/** Whether the job raises new changes or edits one that exists. */
export type ChangeWizardMode = 'create' | 'modify';

/** Every step the change wizard can show (contracts/change-wizard.md). */
export type ChangeWizardStepId =
  | 'whichChange' | 'scope' | 'aiDraft' | 'details' | 'planning' | 'environments'
  | 'tasks' | 'createChanges' | 'checks' | 'paperwork' | 'finish';

/** Whether the approval email and change plan PDF are needed, and if not, why not. */
export interface PaperworkNeed {
  isNeeded: boolean;
  reason: string;
}

/** Everything the done-when rules read — each step's gaps already worked out by the caller. */
export interface ChangeWizardProgress {
  mode: ChangeWizardMode;
  isChangeLoaded: boolean;
  selectedIssueCount: number;
  detailsGaps: string[];
  planningGaps: string[];
  environmentProblems: string[];
  /** What the task cards still need: a short description, or (new change) an environment. */
  taskProblems: string[];
  /** Steps the user has moved past with Next or Skip. */
  reviewedStepIds: ChangeWizardStepId[];
  isChecksSatisfied: boolean;
  paperworkNeed: PaperworkNeed;
  isPaperworkDone: boolean;
  /** A new change: every environment switched on already has its change in ServiceNow. */
  areChangesCreated?: boolean;
}

/** Whether Next may be pressed, why not, and whether the step counts as done. */
export interface StepCompletion {
  canGoNext: boolean;
  isDone: boolean;
  blockedReason?: string;
}

// Toolbox's own order, guided (owner's decision): every pick, then AI Assist writes the change, then the change is
// CREATED in ServiceNow with its CTASKs and the test-evidence zip, then Toolbox's Risk Check and the final checks run
// on the real ticket, and the last step saves the fixes. Evidence is simply every file on the chosen Jira issues.
const CREATE_STEP_IDS: readonly ChangeWizardStepId[] = [
  'scope', 'details', 'planning', 'environments', 'tasks', 'aiDraft', 'createChanges', 'checks', 'paperwork', 'finish',
];
const MODIFY_STEP_IDS: readonly ChangeWizardStepId[] = [
  'whichChange', 'scope', 'details', 'planning', 'environments', 'tasks', 'aiDraft', 'checks', 'paperwork', 'finish',
];

// The steps as three stages, so eleven chips read as "where am I" at a glance.
const CREATE_PHASES: readonly GuidedFlowPhase[] = [
  { label: '① Pick', stepIds: ['scope', 'details', 'planning', 'environments', 'tasks'] },
  { label: '② AI writes it', stepIds: ['aiDraft'] },
  { label: '③ Create in ServiceNow', stepIds: ['createChanges'] },
  { label: '④ Risk check & save', stepIds: ['checks', 'paperwork', 'finish'] },
];
const MODIFY_PHASES: readonly GuidedFlowPhase[] = [
  { label: '① Load & pick', stepIds: ['whichChange', 'scope', 'details', 'planning', 'environments', 'tasks'] },
  { label: '② Write & risk check', stepIds: ['aiDraft', 'checks', 'paperwork'] },
  { label: '③ Save', stepIds: ['finish'] },
];

/** The stages of one mode, for the steps strip. */
export function listChangeWizardPhases(mode: ChangeWizardMode): GuidedFlowPhase[] {
  return (mode === 'modify' ? MODIFY_PHASES : CREATE_PHASES).map((phase) => ({ ...phase, stepIds: [...phase.stepIds] }));
}

/** The plain verb phrase each step is headed with. */
export const CHANGE_WIZARD_STEP_TITLES: Readonly<Record<ChangeWizardStepId, string>> = {
  whichChange: 'Which change?',
  scope: 'What\'s in this change?',
  aiDraft: 'AI Assist: let AI write it',
  details: 'Tell us about the change',
  planning: 'How will it go?',
  environments: 'Where and when?',
  tasks: 'Build the tasks',
  createChanges: 'Create in ServiceNow',
  checks: 'Risk check & final checks',
  paperwork: 'Production paperwork',
  finish: 'Save to ServiceNow',
};
const MODIFY_FINISH_TITLE = 'Save the change';

/** The steps of one mode, in order. */
export function listChangeWizardStepIds(mode: ChangeWizardMode): ChangeWizardStepId[] {
  return [...(mode === 'modify' ? MODIFY_STEP_IDS : CREATE_STEP_IDS)];
}

/** The heading of one step in one mode. */
export function readStepTitle(stepId: ChangeWizardStepId, mode: ChangeWizardMode): string {
  return stepId === 'finish' && mode === 'modify' ? MODIFY_FINISH_TITLE : CHANGE_WIZARD_STEP_TITLES[stepId];
}

/** A gate that blocks Next on its first listed problem. */
function gateOnProblems(problems: readonly string[], prefix = ''): Pick<StepCompletion, 'canGoNext' | 'blockedReason'> {
  if (problems.length === 0) return { canGoNext: true };
  return { canGoNext: false, blockedReason: prefix ? `${prefix}${problems.join(', ')}.` : problems[0] };
}

/** Whether Next is allowed on a step, from the step's own data. */
function evaluateStepGate(stepId: ChangeWizardStepId, progress: ChangeWizardProgress): Pick<StepCompletion, 'canGoNext' | 'blockedReason'> {
  switch (stepId) {
    case 'whichChange':
      return progress.isChangeLoaded ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Look up the change first.' };
    case 'scope':
      return progress.mode === 'modify' || progress.selectedIssueCount > 0
        ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Choose at least one Jira issue for this change.' };
    case 'details': return gateOnProblems(progress.detailsGaps, 'Still needed: ');
    // The plans may be left blank on "How will it go?" — the AI writes them two steps later, and that step holds Next.
    case 'aiDraft': return gateOnProblems(progress.planningGaps, 'Still needed: ');
    case 'environments': return gateOnProblems(progress.environmentProblems);
    case 'tasks': return gateOnProblems(progress.taskProblems);
    case 'createChanges':
      return progress.areChangesCreated ? { canGoNext: true } : { canGoNext: false, blockedReason: 'Create the changes in ServiceNow first.' };
    case 'checks':
      return progress.isChecksSatisfied ? { canGoNext: true }
        : { canGoNext: false, blockedReason: 'Fix the items above, or tick that you understand and want to go on anyway.' };
    case 'paperwork':
      return !progress.paperworkNeed.isNeeded || progress.isPaperworkDone ? { canGoNext: true }
        : { canGoNext: false, blockedReason: 'Copy the approval email or open the change plan, or choose to do it later.' };
    default:
      return { canGoNext: true };
  }
}

/** Whether a step lets the user go on, and whether it counts as done (allowed AND already passed once). */
export function evaluateStepCompletion(stepId: ChangeWizardStepId, progress: ChangeWizardProgress): StepCompletion {
  const gate = evaluateStepGate(stepId, progress);
  const isDone = stepId !== 'finish' && gate.canGoNext && progress.reviewedStepIds.includes(stepId);
  return gate.blockedReason === undefined ? { canGoNext: gate.canGoNext, isDone } : { ...gate, isDone };
}

/** The first step that is not done — where a job should be when nothing else is known. */
export function deriveChangeWizardStep(progress: ChangeWizardProgress): ChangeWizardStepId {
  const stepIds = listChangeWizardStepIds(progress.mode);
  return stepIds.find((stepId) => !evaluateStepCompletion(stepId, progress).isDone) ?? 'finish';
}

/** Where a resumed job lands: the step it was on, unless an earlier step is no longer done. */
export function resolveResumeStep(recordedStepId: string, progress: ChangeWizardProgress): ChangeWizardStepId {
  const stepIds = listChangeWizardStepIds(progress.mode);
  const derivedStepId = deriveChangeWizardStep(progress);
  const recordedIndex = stepIds.indexOf(recordedStepId as ChangeWizardStepId);
  if (recordedIndex === -1) return derivedStepId;
  return recordedIndex <= stepIds.indexOf(derivedStepId) ? stepIds[recordedIndex] : derivedStepId;
}

/**
 * Whether Production paperwork is needed: a Production environment while the restricted change period rules apply
 * (research R-010 — the same rule switch Toolbox's RCP checklist reads). Otherwise the step says why it is skipped.
 */
export function readPaperworkNeed(input: { hasProduction: boolean; isRcpActive: boolean }): PaperworkNeed {
  if (!input.hasProduction) {
    return { isNeeded: false, reason: 'No Production environment is in this change, so no approval email or change plan PDF is needed.' };
  }
  if (!input.isRcpActive) {
    return { isNeeded: false, reason: 'The restricted change period rules are not in force, so no extra approval is needed.' };
  }
  return { isNeeded: true, reason: 'This Production change falls in the restricted change period, so a Director must approve it.' };
}

/** The steps as the shared shell draws them: done, current, or still to do. */
export function buildShellSteps(mode: ChangeWizardMode, currentStepId: ChangeWizardStepId, progress: ChangeWizardProgress): GuidedFlowStep[] {
  return listChangeWizardStepIds(mode).map((stepId) => {
    const isDone = evaluateStepCompletion(stepId, progress).isDone;
    const stepState = stepId === currentStepId ? 'current' : isDone ? 'done' : 'todo';
    return { id: stepId, title: readStepTitle(stepId, mode), state: stepState };
  });
}
