// implementationBackout.ts — Gives every Implementation task the change's backout plan unless it has its own (pure).
//
// Release Management checks that each Implementation task carries a backout plan (Toolbox keeps it as a marked section
// of the task's description). The plan is the change's own, so asking the user to write it twice made the Wizard loop:
// writing the change's backout plan never cleared the task check (owner feedback). A task whose backout section the
// user wrote differently is left alone; one still holding an earlier copy of the change's plan is kept in step.

import { readBackoutSectionFromDescription, upsertBackoutSection } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';

/** The part of a staged task this rule reads. */
export interface BackoutTask {
  id: string;
  changeTaskType?: string;
  description: string;
}

/** One task's new description. */
export interface BackoutUpdate {
  taskId: string;
  description: string;
}

const IMPLEMENTATION_TASK_TYPE = 'implementation';

/** True for a task of ServiceNow's Implementation type. */
export function isImplementationTask(task: Pick<BackoutTask, 'changeTaskType'>): boolean {
  return (task.changeTaskType ?? '').trim().toLowerCase() === IMPLEMENTATION_TASK_TYPE;
}

/**
 * The description updates that bring Implementation tasks in line with the change's backout plan. A task is updated
 * when its backout section is empty or still equals the plan it was last given (`previousChangeBackoutPlan`).
 */
export function listImplementationBackoutUpdates(
  tasks: readonly BackoutTask[], changeBackoutPlan: string, previousChangeBackoutPlan: string,
): BackoutUpdate[] {
  const plan = changeBackoutPlan.trim();
  if (plan === '') return [];
  return tasks
    .filter(isImplementationTask)
    .filter((task) => {
      const taskBackout = readBackoutSectionFromDescription(task.description);
      return taskBackout === '' || (taskBackout !== plan && taskBackout === previousChangeBackoutPlan.trim());
    })
    .map((task) => ({ taskId: task.id, description: upsertBackoutSection(task.description, plan) }));
}
