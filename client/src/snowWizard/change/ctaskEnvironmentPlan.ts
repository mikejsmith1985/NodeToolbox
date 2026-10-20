// ctaskEnvironmentPlan.ts — Which environment's change each task goes on, as pure rules the user's own ticks drive.
//
// Framework-first: no such rule exists in Toolbox — its create path stages every task on every environment's change
// (research R-003/R-007). This module is pure and React-free because Toolbox's own useCrgState.createChg imports
// `filterStagedCtasksForEnvironment` (recorded drift 1), so it must stay tiny and dependency-free. There are no
// built-in defaults: a task goes where the user ticks it, and a new task starts on every environment in use.

/** The three environments a change can be raised for, as the plan names them. */
export type PlanEnvironmentKey = 'REL' | 'PRD' | 'PFIX';

/** One task's ticks: true where the task belongs on that environment's change. */
export type CtaskEnvironmentTicks = Record<PlanEnvironmentKey, boolean>;

/** Every task, by its id (or, for older callers, its label), and the environments it belongs to. */
export type CtaskEnvironmentPlan = Record<string, CtaskEnvironmentTicks>;

/** The parts of a staged task the plan reads. */
export interface PlannedTask {
  id?: string;
  shortDescription?: string;
  name?: string;
  /** The environments the user ticked; absent means every environment the change uses. */
  environmentKeys?: readonly PlanEnvironmentKey[];
}

/** The environments in the order the screens show them. */
export const PLAN_ENVIRONMENT_KEYS: readonly PlanEnvironmentKey[] = ['REL', 'PRD', 'PFIX'];

/** The label a staged task is known by — the words it will be created with. */
export function readCtaskPlanKey(stagedTask: { shortDescription?: string; name?: string }): string {
  return (stagedTask.shortDescription || stagedTask.name || '').trim();
}

/** A task's ticks on the environments in use: its own choice, or every one in use when it has made none. */
export function readTaskEnvironmentTicks(task: PlannedTask, enabledEnvironments: readonly PlanEnvironmentKey[]): CtaskEnvironmentTicks {
  const chosenEnvironments = task.environmentKeys ?? enabledEnvironments;
  return {
    REL: enabledEnvironments.includes('REL') && chosenEnvironments.includes('REL'),
    PRD: enabledEnvironments.includes('PRD') && chosenEnvironments.includes('PRD'),
    PFIX: enabledEnvironments.includes('PFIX') && chosenEnvironments.includes('PFIX'),
  };
}

/** The task's environments with one environment switched on or off; the task itself is left untouched. */
export function toggleTaskEnvironment(task: PlannedTask, environmentKey: PlanEnvironmentKey, enabledEnvironments: readonly PlanEnvironmentKey[]): PlanEnvironmentKey[] {
  const ticks = readTaskEnvironmentTicks(task, enabledEnvironments);
  const nextTicks = { ...ticks, [environmentKey]: !ticks[environmentKey] };
  return PLAN_ENVIRONMENT_KEYS.filter((planKey) => nextTicks[planKey]);
}

/** The plan the create path reads: every task's ticks, keyed by the task's id. */
export function buildCtaskEnvironmentPlan(tasks: readonly PlannedTask[], enabledEnvironments: readonly PlanEnvironmentKey[]): CtaskEnvironmentPlan {
  const plan: CtaskEnvironmentPlan = {};
  for (const task of tasks) if (task.id) plan[task.id] = readTaskEnvironmentTicks(task, enabledEnvironments);
  return plan;
}

/** Each environment in use and the labels of the tasks going on its change, in the user's order. */
export function listTaskLabelsByEnvironment(tasks: readonly PlannedTask[], enabledEnvironments: readonly PlanEnvironmentKey[]): Partial<Record<PlanEnvironmentKey, string[]>> {
  const labelsByEnvironment: Partial<Record<PlanEnvironmentKey, string[]>> = {};
  for (const environmentKey of enabledEnvironments) {
    labelsByEnvironment[environmentKey] = tasks
      .map((task, taskIndex) => ({ task, label: readCtaskPlanKey(task) || `Task ${taskIndex + 1}` }))
      .filter(({ task }) => readTaskEnvironmentTicks(task, enabledEnvironments)[environmentKey])
      .map(({ label }) => label);
  }
  return labelsByEnvironment;
}

/**
 * The staged tasks that belong on one environment's change. A task is found in the plan by its id, then by its
 * label; one the plan does not mention keeps today's behaviour (every environment). With no plan the very same
 * list comes back, so callers without one are unchanged.
 */
export function filterStagedCtasksForEnvironment<StagedTask extends { id?: string; shortDescription?: string; name?: string }>(
  stagedTasks: StagedTask[],
  plan: CtaskEnvironmentPlan | undefined,
  environmentKey: PlanEnvironmentKey,
): StagedTask[] {
  if (!plan) return stagedTasks;
  return stagedTasks.filter((stagedTask) => {
    const ticks = (stagedTask.id ? plan[stagedTask.id] : undefined) ?? plan[readCtaskPlanKey(stagedTask)];
    return ticks ? ticks[environmentKey] : true;
  });
}
