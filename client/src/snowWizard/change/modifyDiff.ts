// modifyDiff.ts — For a modify: which steps the user edited, and which values ServiceNow changed since the change was loaded (pure).
//
// Toolbox's updateExistingChg writes the whole change from the draft, so a step the user skipped is re-sent with the
// values it was loaded with. That is only safe if nobody changed them in ServiceNow meanwhile, so before saving the
// wizard re-reads the change and shows every remote change beside the loaded value (spec US2 scenario 3).

import { extractSnowReference, extractStringValue } from '../../views/SnowHub/hooks/snowFieldValues.ts';
import { DRAFT_ENVIRONMENTS, type CrgDraftState } from './changeDraft.ts';
import type { ChangeWizardStepId } from './changeWizardSteps.ts';

/** Each editable step's values, by plain label, as comparable text. */
export type StepValueMap = Partial<Record<ChangeWizardStepId, Record<string, string>>>;

/** One value ServiceNow changed after the change was loaded. */
export interface RemoteConflict {
  fieldLabel: string;
  stepId: ChangeWizardStepId;
  loadedValue: string;
  serviceNowValue: string;
  /** True when the user also edited this value's step in the wizard. */
  isEditedHere: boolean;
}

/** The record fields watched for remote changes, each with its plain label and the step that holds it. */
const TRACKED_RECORD_FIELDS: ReadonlyArray<{ recordField: string; label: string; stepId: ChangeWizardStepId }> = [
  { recordField: 'short_description', label: 'Title', stepId: 'details' },
  { recordField: 'description', label: 'Description', stepId: 'details' },
  { recordField: 'justification', label: 'Justification', stepId: 'details' },
  { recordField: 'risk_impact_analysis', label: 'Risk and impact', stepId: 'details' },
  { recordField: 'category', label: 'Category', stepId: 'details' },
  { recordField: 'type', label: 'Change type', stepId: 'details' },
  { recordField: 'requested_by', label: 'Requested by', stepId: 'details' },
  { recordField: 'assignment_group', label: 'Assignment group', stepId: 'details' },
  { recordField: 'assigned_to', label: 'Owner', stepId: 'details' },
  { recordField: 'cmdb_ci', label: 'Configuration item', stepId: 'details' },
  { recordField: 'implementation_plan', label: 'Implementation plan', stepId: 'planning' },
  { recordField: 'backout_plan', label: 'Backout plan', stepId: 'planning' },
  { recordField: 'test_plan', label: 'Test plan', stepId: 'planning' },
  { recordField: 'start_date', label: 'Planned start', stepId: 'environments' },
  { recordField: 'end_date', label: 'Planned end', stepId: 'environments' },
];

/** The record fields a modify reads at load and again before saving. */
export const MODIFY_SNAPSHOT_FIELDS: readonly string[] = TRACKED_RECORD_FIELDS.map(({ recordField }) => recordField);

/** A record's tracked fields as plain text (display values when ServiceNow sent both). */
export function readRecordSnapshot(record: Readonly<Record<string, unknown>>): Record<string, string> {
  return Object.fromEntries(MODIFY_SNAPSHOT_FIELDS.map((recordField) => {
    const fieldValue = record[recordField];
    const displayText = typeof fieldValue === 'object' && fieldValue !== null
      ? extractSnowReference(fieldValue).displayName || extractStringValue(fieldValue)
      : extractStringValue(fieldValue);
    return [recordField, displayText];
  }));
}

/** The "Tell us about the change" values. */
function readDetailsValues(draft: CrgDraftState): Record<string, string> {
  const basicInfo = draft.chgBasicInfo;
  return {
    Title: draft.generatedShortDescription, Description: draft.generatedDescription, Justification: draft.generatedJustification,
    'Risk and impact': draft.generatedRiskImpact, Category: basicInfo.category, 'Change type': basicInfo.changeType,
    'Requested by': basicInfo.requestedBy.sysId, 'Assignment group': basicInfo.assignmentGroup.sysId, Owner: basicInfo.assignedTo.sysId,
    'Configuration item': basicInfo.configItem.sysId, Expedited: String(basicInfo.isExpedited),
  };
}

/** The "How will it go?" values: the three plans and the assessment answers. */
function readPlanningValues(draft: CrgDraftState): Record<string, string> {
  return { ...draft.chgPlanningContent, ...draft.chgPlanningAssessment };
}

/** The "Where and when?" values: each environment's switch and window. */
function readEnvironmentValues(draft: CrgDraftState): Record<string, string> {
  return Object.fromEntries(DRAFT_ENVIRONMENTS.flatMap(({ stateKey, label }) => {
    const environment = draft[stateKey];
    return [[`${label} on`, String(environment.isEnabled)], [`${label} start`, environment.plannedStartDate], [`${label} end`, environment.plannedEndDate]];
  }));
}

/** Every editable step's values, for comparing the draft as loaded with the draft now. */
export function readStepValues(draft: CrgDraftState): StepValueMap {
  return {
    scope: { Issues: [...draft.selectedIssueKeys].sort().join(',') },
    details: readDetailsValues(draft),
    planning: readPlanningValues(draft),
    environments: readEnvironmentValues(draft),
    tasks: { 'New tasks': draft.changeTasks.map((task) => task.shortDescription || task.name).join(',') },
  };
}

/** True when two value maps differ in any label. */
function areValuesDifferent(loadedValues: Record<string, string> = {}, currentValues: Record<string, string> = {}): boolean {
  const labels = new Set([...Object.keys(loadedValues), ...Object.keys(currentValues)]);
  return [...labels].some((label) => (loadedValues[label] ?? '') !== (currentValues[label] ?? ''));
}

/** The steps whose values differ from how the change was loaded — the steps marked "edited". */
export function listEditedSteps(loadedValues: StepValueMap, currentValues: StepValueMap): ChangeWizardStepId[] {
  const stepIds = Object.keys({ ...loadedValues, ...currentValues }) as ChangeWizardStepId[];
  return stepIds.filter((stepId) => areValuesDifferent(loadedValues[stepId], currentValues[stepId]));
}

/** Every tracked value ServiceNow changed between the load and now, with both values. */
export function detectRemoteConflicts(
  loadedSnapshot: Readonly<Record<string, string>>,
  freshSnapshot: Readonly<Record<string, string>>,
  editedStepIds: readonly ChangeWizardStepId[],
): RemoteConflict[] {
  return TRACKED_RECORD_FIELDS
    .filter(({ recordField }) => (loadedSnapshot[recordField] ?? '') !== (freshSnapshot[recordField] ?? ''))
    .map(({ recordField, label, stepId }) => ({
      fieldLabel: label,
      stepId,
      loadedValue: loadedSnapshot[recordField] ?? '',
      serviceNowValue: freshSnapshot[recordField] ?? '',
      isEditedHere: editedStepIds.includes(stepId),
    }));
}
