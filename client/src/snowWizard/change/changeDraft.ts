// changeDraft.ts — Reads Toolbox's change draft (useCrgState) into the plain facts the wizard's steps need, and writes texts back.
//
// The draft itself lives in useCrgState (the 033 seam, research R-003); this module only reads it — which required
// values are missing, which environments are on — and routes a text edit to the hook's own setter, so every step and
// the AI rounds write through the same path Toolbox uses.

import type { ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import { inferEnvironmentKeyFromValue } from '../../views/SnowHub/hooks/environmentKeyInference.ts';
import { listEnvironmentDateOrderErrors, type EnvironmentValueByKey, type useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { SnowChoiceOption } from '../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import { normalizeCtaskLabel, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';

/** The whole hook, as the steps receive it. */
export type CrgHook = ReturnType<typeof useCrgState>;
/** The draft the hook holds. */
export type CrgDraftState = CrgHook['state'];

type DraftEnvironmentKey = 'rel' | 'prd' | 'pfix';
type DraftEnvironmentStateKey = 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment';

/** The three environment cards, in the order the wizard shows them. */
export const DRAFT_ENVIRONMENTS: ReadonlyArray<{ key: DraftEnvironmentKey; stateKey: DraftEnvironmentStateKey; label: PlanEnvironmentKey }> = [
  { key: 'rel', stateKey: 'relEnvironment', label: 'REL' },
  { key: 'prd', stateKey: 'prdEnvironment', label: 'PRD' },
  { key: 'pfix', stateKey: 'pfixEnvironment', label: 'PFIX' },
];

// Production changes need an outage, evidence and (in the restricted period) approval.
const PRODUCTION_ENVIRONMENT_KEYS: readonly DraftEnvironmentKey[] = ['prd', 'pfix'];

/** The required values on "Tell us about the change", each in plain words and as a test of the draft. */
const REQUIRED_DETAILS: ReadonlyArray<{ label: string; isMissing: (draft: CrgDraftState) => boolean }> = [
  { label: 'a title', isMissing: (draft) => draft.generatedShortDescription.trim() === '' },
  { label: 'a category', isMissing: (draft) => draft.chgBasicInfo.category.trim() === '' },
  { label: 'a change type', isMissing: (draft) => draft.chgBasicInfo.changeType.trim() === '' },
  { label: 'an assignment group', isMissing: (draft) => draft.chgBasicInfo.assignmentGroup.sysId === '' },
  { label: 'an owner', isMissing: (draft) => draft.chgBasicInfo.assignedTo.sysId === '' },
  { label: 'a configuration item', isMissing: (draft) => draft.chgBasicInfo.configItem.sysId === '' },
];

const REQUIRED_PLANS: ReadonlyArray<{ label: string; fieldKey: 'implementationPlan' | 'backoutPlan' | 'testPlan' }> = [
  { label: 'the implementation plan', fieldKey: 'implementationPlan' },
  { label: 'the backout plan', fieldKey: 'backoutPlan' },
  { label: 'the test plan', fieldKey: 'testPlan' },
];

/** The required details still missing, in plain words. */
export function readDetailsGaps(draft: CrgDraftState): string[] {
  return REQUIRED_DETAILS.filter((requiredDetail) => requiredDetail.isMissing(draft)).map((requiredDetail) => requiredDetail.label);
}

/** The plans still empty, in plain words. */
export function readPlanningGaps(draft: CrgDraftState): string[] {
  return REQUIRED_PLANS.filter(({ fieldKey }) => draft.chgPlanningContent[fieldKey].trim() === '').map(({ label }) => label);
}

/** The environments switched on, as the plan names them. */
export function readEnabledPlanEnvironments(draft: CrgDraftState): PlanEnvironmentKey[] {
  return DRAFT_ENVIRONMENTS.filter(({ stateKey }) => draft[stateKey].isEnabled).map(({ label }) => label);
}

/** What stops the environments step: none ticked, a missing date, or an end before its start. */
export function readEnvironmentProblems(draft: CrgDraftState): string[] {
  const enabledEnvironments = DRAFT_ENVIRONMENTS.filter(({ stateKey }) => draft[stateKey].isEnabled);
  if (enabledEnvironments.length === 0) return ['Tick at least one environment.'];
  const missingDates = enabledEnvironments
    .filter(({ stateKey }) => !draft[stateKey].plannedStartDate || !draft[stateKey].plannedEndDate)
    .map(({ label }) => `${label} needs a start and an end.`);
  return [...missingDates, ...listEnvironmentDateOrderErrors(draft)];
}

/** The Production environment switched on (PRD before PFIX), or null for a non-Production change. */
export function readProductionEnvironmentKey(draft: CrgDraftState): 'prd' | 'pfix' | null {
  const productionEnvironment = DRAFT_ENVIRONMENTS.find(({ key, stateKey }) => PRODUCTION_ENVIRONMENT_KEYS.includes(key) && draft[stateKey].isEnabled);
  return productionEnvironment ? productionEnvironment.key as 'prd' | 'pfix' : null;
}

/** True when any Production environment is switched on. */
export function hasProductionEnvironment(draft: CrgDraftState): boolean {
  return readProductionEnvironmentKey(draft) !== null;
}

/** The Jira issues chosen for the change. */
export function readSelectedIssues(draft: CrgDraftState): CrgDraftState['fetchedIssues'] {
  return draft.fetchedIssues.filter((issue) => draft.selectedIssueKeys.has(issue.key));
}

/** The seven texts a change carries, read from wherever the draft keeps each. */
export function readChangeTextFields(draft: CrgDraftState): Record<ChgTextFieldKey, string> {
  return {
    shortDescription: draft.generatedShortDescription,
    description: draft.generatedDescription,
    justification: draft.generatedJustification,
    riskImpact: draft.generatedRiskImpact,
    implementationPlan: draft.chgPlanningContent.implementationPlan,
    testPlan: draft.chgPlanningContent.testPlan,
    backoutPlan: draft.chgPlanningContent.backoutPlan,
  };
}

/** The two hook setters a text edit goes through. */
type TextFieldWriters = Pick<CrgHook['actions'], 'updateGeneratedField' | 'setChgPlanningContent'>;

/** Writes one text into the draft through the same setter Toolbox's builder uses for it. */
export function applyChangeTextField(actions: TextFieldWriters, fieldKey: ChgTextFieldKey, fieldText: string): void {
  if (fieldKey === 'implementationPlan' || fieldKey === 'testPlan' || fieldKey === 'backoutPlan') {
    actions.setChgPlanningContent({ [fieldKey]: fieldText });
    return;
  }
  actions.updateGeneratedField(fieldKey, fieldText);
}

/**
 * The ServiceNow environment value for each card, picked from ServiceNow's own environment list with Toolbox's one
 * shared inference (first match wins). createChg uses these only for a card whose value was not chosen by hand.
 */
export function buildEnvironmentValueByKey(environmentChoices: readonly SnowChoiceOption[]): EnvironmentValueByKey {
  const environmentValueByKey: EnvironmentValueByKey = {};
  for (const environmentChoice of environmentChoices) {
    const environmentKey = inferEnvironmentKeyFromValue(environmentChoice.value) ?? inferEnvironmentKeyFromValue(environmentChoice.label);
    if (environmentKey && !environmentValueByKey[environmentKey]) environmentValueByKey[environmentKey] = environmentChoice.value;
  }
  return environmentValueByKey;
}

// ServiceNow makes these two tasks on every new change itself (useCrgState updateAutoCreatedChangeTasks renames
// them); staging them again would create duplicates (GH #376), so the wizard shows them as always present.
const SERVICENOW_ADDED_TASK_LABELS = new Set(['implementation', 'technicalcheckout']);

/** True for a task type ServiceNow adds to every change by itself. */
export function isServiceNowAddedTaskType(taskTypeLabel: string): boolean {
  return SERVICENOW_ADDED_TASK_LABELS.has(normalizeCtaskLabel(taskTypeLabel));
}

/**
 * A staged task for one ServiceNow task type: named by the type's label (the name the plan and the reviewer see),
 * typed by its value, and assigned to the change's own group and owner.
 */
export function buildStagedChangeTask(typeOption: SnowChoiceOption, draft: CrgDraftState): CrgDraftState['changeTasks'][number] {
  return {
    id: '',
    name: typeOption.label,
    createdAt: new Date().toISOString(),
    shortDescription: typeOption.label,
    description: '',
    assignmentGroup: draft.chgBasicInfo.assignmentGroup,
    assignedTo: draft.chgBasicInfo.assignedTo,
    plannedStartDate: '',
    plannedEndDate: '',
    closeNotes: '',
    changeTaskType: typeOption.value,
  };
}
