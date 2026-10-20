// taskCards.ts — The rules behind the task cards a user builds: a new blank card, a card from a saved task, and what is still missing (pure).
//
// Every task on the change is one the user built — there are no hidden or default tasks. A card's configuration item
// is never chosen here: create and save always stamp the change's own (ctaskParentDefaults), so it is not a field.

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import type { ChangeWizardMode } from './changeWizardSteps.ts';
import { PLAN_ENVIRONMENT_KEYS, readTaskEnvironmentTicks, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';

const UNTITLED_TASK_PREFIX = 'Task';

/** "Smoke test", or "Task 3" for a card with no short description yet. */
export function describeTaskCard(task: Pick<CtaskTemplate, 'shortDescription'>, taskIndex: number): string {
  return task.shortDescription.trim() || `${UNTITLED_TASK_PREFIX} ${taskIndex + 1}`;
}

/**
 * A new, empty card. It starts with the change's own assignment group and owner, which the user can change; it has
 * no environments of its own, so it goes on every change in use until the user unticks one.
 */
export function buildBlankChangeTask(draft: Pick<CrgDraftState, 'chgBasicInfo'>): CtaskTemplate {
  return {
    id: '',
    name: '',
    createdAt: new Date().toISOString(),
    shortDescription: '',
    description: '',
    assignmentGroup: draft.chgBasicInfo.assignmentGroup,
    assignedTo: draft.chgBasicInfo.assignedTo,
    plannedStartDate: '',
    plannedEndDate: '',
    closeNotes: '',
    changeTaskType: '',
  };
}

/** A card filled from a saved task, remembering where it came from so saving the change as a template reuses it. */
export function buildTaskFromTemplate(ctaskTemplate: CtaskTemplate): CtaskTemplate {
  return { ...ctaskTemplate, sourceTemplateId: ctaskTemplate.id, createdAt: new Date().toISOString() };
}

/** True when the card goes on at least one of the environments in use. */
function isOnAnyEnvironment(task: CtaskTemplate, enabledEnvironments: readonly PlanEnvironmentKey[]): boolean {
  const ticks = readTaskEnvironmentTicks(task, enabledEnvironments);
  return PLAN_ENVIRONMENT_KEYS.some((environmentKey) => ticks[environmentKey]);
}

/**
 * What stops the tasks step, in plain words: a card with no short description, or (for a new change, which is one
 * change per environment) a card ticked for no environment.
 */
export function listTaskProblems(tasks: readonly CtaskTemplate[], enabledEnvironments: readonly PlanEnvironmentKey[], mode: ChangeWizardMode): string[] {
  const taskProblems: string[] = [];
  tasks.forEach((task, taskIndex) => {
    if (task.shortDescription.trim() === '') taskProblems.push(`Task ${taskIndex + 1} needs a short description.`);
    if (mode === 'create' && enabledEnvironments.length > 0 && !isOnAnyEnvironment(task, enabledEnvironments)) {
      taskProblems.push(`${describeTaskCard(task, taskIndex)} is not on any change. Tick at least one environment.`);
    }
  });
  return taskProblems;
}
