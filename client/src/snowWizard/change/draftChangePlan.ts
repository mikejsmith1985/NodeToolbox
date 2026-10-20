// draftChangePlan.ts — The restricted-change-period verdicts, approval-email facts and printable change plan for a change draft.
//
// Framework-first: the rules are Toolbox's `evaluateNewChangeRcp` (built for a change not yet created) and the print
// page is Toolbox's `buildChangePlanDocumentHtml`. Toolbox reads the plan from an existing record; the Wizard can
// print it before the change exists, so the same ChangePlan shape is filled from the draft here.

import type { ChangePlan, ChangePlanTask } from '../../views/SnowHub/rcp/changePlanDocument.ts';
import { evaluateNewChangeRcp, readLocalDateTimeAsUtc, type NewChangeRcpEvaluation } from '../../views/SnowHub/rcp/rcpNewChange.ts';
import { describeCentralWindow } from '../../views/SnowHub/rcp/rcpRules.ts';
import { readProductionEnvironmentKey, type CrgDraftState } from './changeDraft.ts';

/** What the plan calls a change that has no number yet. */
export const UNNUMBERED_CHANGE_LABEL = 'New change';

/** The draft's Production environment, or null when the change is not for Production. */
function readProductionEnvironment(draft: CrgDraftState) {
  const productionKey = readProductionEnvironmentKey(draft);
  if (productionKey === null) return null;
  return { label: productionKey.toUpperCase(), environment: draft[productionKey === 'prd' ? 'prdEnvironment' : 'pfixEnvironment'] };
}

/** The draft's Production configuration item: the environment's own when set, else the change's. */
function readProductionConfigItem(draft: CrgDraftState, environment: CrgDraftState['prdEnvironment']) {
  return environment.configItem.sysId ? environment.configItem : draft.chgBasicInfo.configItem;
}

/** The restricted-change-period checklist and approval-email facts for the draft; null when it is not for Production. */
export function evaluateDraftRcp(draft: CrgDraftState, todayIso: string): NewChangeRcpEvaluation | null {
  const production = readProductionEnvironment(draft);
  if (production === null) return null;
  return evaluateNewChangeRcp({
    productionEnvironment: {
      label: production.label,
      plannedStartUtc: readLocalDateTimeAsUtc(production.environment.plannedStartDate),
      plannedEndUtc: readLocalDateTimeAsUtc(production.environment.plannedEndDate),
      configItem: readProductionConfigItem(draft, production.environment),
    },
    totalEstimateMinutes: null,
    requestedBy: draft.chgBasicInfo.requestedBy,
    justification: draft.generatedJustification,
    shortDescription: draft.generatedShortDescription,
    backoutPlan: draft.chgPlanningContent.backoutPlan,
    description: draft.generatedDescription,
    implementationPlan: draft.chgPlanningContent.implementationPlan,
    riskImpactAnalysis: draft.generatedRiskImpact,
    testPlan: draft.chgPlanningContent.testPlan,
    todayIso,
  });
}

/** One staged task as the printed plan shows it. */
function readPlanTask(task: CrgDraftState['changeTasks'][number], configItemName: string): ChangePlanTask {
  return {
    number: task.shortDescription || task.name,
    shortDescription: task.shortDescription,
    typeLabel: task.changeTaskType ?? '',
    assignmentGroupName: task.assignmentGroup.displayName,
    assignedToName: task.assignedTo.displayName,
    configItemName,
    windowText: '',
    description: task.description,
  };
}

/** The printable change plan, from the draft — for the Production change, or the first environment otherwise. */
export function buildDraftChangePlan(draft: CrgDraftState, changeNumber: string): ChangePlan {
  const production = readProductionEnvironment(draft);
  const configItem = production ? readProductionConfigItem(draft, production.environment) : draft.chgBasicInfo.configItem;
  const windowText = production ? describeCentralWindow(
    readLocalDateTimeAsUtc(production.environment.plannedStartDate), readLocalDateTimeAsUtc(production.environment.plannedEndDate),
  ) : '';
  return {
    changeNumber: changeNumber || UNNUMBERED_CHANGE_LABEL,
    shortDescription: draft.generatedShortDescription,
    environmentLabel: production?.label ?? '',
    riskLabel: '',
    impactLabel: draft.chgPlanningAssessment.impact,
    configItemName: configItem.displayName,
    ciOwnerName: '',
    requestedByName: draft.chgBasicInfo.requestedBy.displayName,
    assignmentGroupName: draft.chgBasicInfo.assignmentGroup.displayName,
    windowText,
    description: draft.generatedDescription,
    justification: draft.generatedJustification,
    implementationPlan: draft.chgPlanningContent.implementationPlan,
    riskImpactAnalysis: draft.generatedRiskImpact,
    backoutPlan: draft.chgPlanningContent.backoutPlan,
    testPlan: draft.chgPlanningContent.testPlan,
    tasks: draft.changeTasks.map((task) => readPlanTask(task, configItem.displayName)),
  };
}
