// ctaskEnvironmentPlan.ts — Which environment each change task belongs to (Business Checkout on PRD, not REL), as pure rules.
//
// Framework-first: no such rule exists in Toolbox — its create path stages every task on every environment's change
// (research R-003/R-007). This module is pure and React-free because Toolbox's own useCrgState.createChg imports
// `filterStagedCtasksForEnvironment` (recorded drift 1), so it must stay tiny and dependency-free.

/** The three environments a change can be raised for, as the plan names them. */
export type PlanEnvironmentKey = 'REL' | 'PRD' | 'PFIX';

/** One task's ticks: true where the task belongs on that environment's change. */
export type CtaskEnvironmentTicks = Record<PlanEnvironmentKey, boolean>;

/** Every chosen task, by its label, and the environments it belongs to (data-model.md CtaskEnvironmentPlan). */
export type CtaskEnvironmentPlan = Record<string, CtaskEnvironmentTicks>;

/** Remembered defaults, keyed by normalised task label. */
export type SavedCtaskEnvironmentDefaults = Record<string, CtaskEnvironmentTicks>;

/** The environments in the order the grid shows them. */
export const PLAN_ENVIRONMENT_KEYS: readonly PlanEnvironmentKey[] = ['REL', 'PRD', 'PFIX'];

/** Where this browser remembers the user's own defaults. */
export const CTASK_ENV_DEFAULTS_STORAGE_KEY = 'snowWizard:ctaskEnvDefaults';

const EVERY_ENVIRONMENT: CtaskEnvironmentTicks = { REL: true, PRD: true, PFIX: true };

/**
 * The built-in rules, keyed by normalised label. Business Checkout is the business's own check of the live system,
 * so it belongs on Production changes only; every other task (and any task not listed) runs everywhere.
 */
export const CTASK_ENVIRONMENT_DEFAULTS: Readonly<Record<string, CtaskEnvironmentTicks>> = {
  implementation: EVERY_ENVIRONMENT,
  technicalcheckout: EVERY_ENVIRONMENT,
  businesscheckout: { REL: false, PRD: true, PFIX: true },
};

/** A task label reduced to lowercase letters and digits, so "Business Check-out" and "business checkout" match. */
export function normalizeCtaskLabel(taskLabel: string): string {
  return taskLabel.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The label a staged task is planned under — the words it will be created with. */
export function readCtaskPlanKey(stagedTask: { shortDescription?: string; name?: string }): string {
  return (stagedTask.shortDescription || stagedTask.name || '').trim();
}

/** The ticks a task starts with: the user's saved default, else the built-in rule, else every environment. */
function readDefaultTicks(taskLabel: string, savedDefaults: SavedCtaskEnvironmentDefaults): CtaskEnvironmentTicks {
  const normalizedLabel = normalizeCtaskLabel(taskLabel);
  return savedDefaults[normalizedLabel] ?? CTASK_ENVIRONMENT_DEFAULTS[normalizedLabel] ?? EVERY_ENVIRONMENT;
}

/** Clears every tick on an environment the change does not use. */
function maskToEnabledEnvironments(ticks: CtaskEnvironmentTicks, enabledEnvironments: readonly PlanEnvironmentKey[]): CtaskEnvironmentTicks {
  return {
    REL: ticks.REL && enabledEnvironments.includes('REL'),
    PRD: ticks.PRD && enabledEnvironments.includes('PRD'),
    PFIX: ticks.PFIX && enabledEnvironments.includes('PFIX'),
  };
}

/** True when at least one environment is ticked. */
function hasAnyTick(ticks: CtaskEnvironmentTicks): boolean {
  return PLAN_ENVIRONMENT_KEYS.some((environmentKey) => ticks[environmentKey]);
}

/**
 * The plan for the chosen tasks. A task already in `existingPlan` keeps the user's ticks; a new one starts from its
 * default. Ticks on environments the change does not use are cleared, and a kept row left with none is re-seeded.
 */
export function seedCtaskEnvironmentPlan(
  selectedTaskLabels: readonly string[],
  enabledEnvironments: readonly PlanEnvironmentKey[],
  savedDefaults: SavedCtaskEnvironmentDefaults,
  existingPlan: CtaskEnvironmentPlan = {},
): CtaskEnvironmentPlan {
  const plan: CtaskEnvironmentPlan = {};
  for (const taskLabel of selectedTaskLabels) {
    const defaultTicks = maskToEnabledEnvironments(readDefaultTicks(taskLabel, savedDefaults), enabledEnvironments);
    const existingTicks = existingPlan[taskLabel];
    const keptTicks = existingTicks ? maskToEnabledEnvironments(existingTicks, enabledEnvironments) : null;
    plan[taskLabel] = keptTicks && hasAnyTick(keptTicks) ? keptTicks : defaultTicks;
  }
  return plan;
}

/** Plain-English problems that stop the plan being used: a task on no environment, or a tick on an unused one. */
export function listPlanErrors(plan: CtaskEnvironmentPlan, enabledEnvironments: readonly PlanEnvironmentKey[]): string[] {
  const planErrors: string[] = [];
  for (const [taskLabel, ticks] of Object.entries(plan)) {
    if (!hasAnyTick(ticks)) planErrors.push(`${taskLabel} is not ticked for any environment.`);
    for (const environmentKey of PLAN_ENVIRONMENT_KEYS) {
      if (ticks[environmentKey] && !enabledEnvironments.includes(environmentKey)) {
        planErrors.push(`${taskLabel} is ticked for ${environmentKey}, which this change does not use.`);
      }
    }
  }
  return planErrors;
}

/**
 * The staged tasks that belong on one environment's change. A task the plan does not mention keeps today's
 * behaviour (every environment). With no plan the very same list comes back, so callers without one are unchanged.
 */
export function filterStagedCtasksForEnvironment<StagedTask extends { shortDescription?: string; name?: string }>(
  stagedTasks: StagedTask[],
  plan: CtaskEnvironmentPlan | undefined,
  environmentKey: PlanEnvironmentKey,
): StagedTask[] {
  if (!plan) return stagedTasks;
  return stagedTasks.filter((stagedTask) => {
    const ticks = plan[readCtaskPlanKey(stagedTask)];
    return ticks ? ticks[environmentKey] : true;
  });
}

/** The plan with one tick flipped; the original is left untouched. */
export function toggleCtaskEnvironment(plan: CtaskEnvironmentPlan, taskLabel: string, environmentKey: PlanEnvironmentKey): CtaskEnvironmentPlan {
  const currentTicks = plan[taskLabel] ?? { REL: false, PRD: false, PFIX: false };
  return { ...plan, [taskLabel]: { ...currentTicks, [environmentKey]: !currentTicks[environmentKey] } };
}

/** The user's remembered defaults; nothing when storage is empty, blocked or damaged. */
export function loadSavedCtaskEnvironmentDefaults(storage: Storage = window.localStorage): SavedCtaskEnvironmentDefaults {
  try {
    const storedText = storage.getItem(CTASK_ENV_DEFAULTS_STORAGE_KEY);
    const parsedDefaults: unknown = storedText ? JSON.parse(storedText) : {};
    return typeof parsedDefaults === 'object' && parsedDefaults !== null ? parsedDefaults as SavedCtaskEnvironmentDefaults : {};
  } catch {
    return {};
  }
}

/** Remembers one task's ticks as this browser's default for that task. */
export function saveCtaskEnvironmentDefault(taskLabel: string, ticks: CtaskEnvironmentTicks, storage: Storage = window.localStorage): void {
  const savedDefaults = { ...loadSavedCtaskEnvironmentDefaults(storage), [normalizeCtaskLabel(taskLabel)]: ticks };
  try {
    storage.setItem(CTASK_ENV_DEFAULTS_STORAGE_KEY, JSON.stringify(savedDefaults));
  } catch {
    // A default is a convenience; the plan for this change still works without it.
  }
}
