// quickSchedule.ts — The "Just the task schedule" short cut on a modify: write every task's slot on the timeline and the
// change's estimated-duration block, without walking the other steps (owner, GH #475).
//
// Framework-first: the tasks go through saveModifyTasks (Toolbox's task writers, dated by taskTimeline), and the block is
// Toolbox's own applyDurationBlock — the same text a full save puts on the implementation plan — so a short cut and a
// full save leave the change identical.

import { snowFetch } from '../../services/snowApi.ts';
import { applyDurationBlock, rollUpEstimates } from '../../views/SnowHub/ctaskDurations.ts';
import type { ChangeTaskDefaults } from '../../views/SnowHub/ctaskParentDefaults.ts';
import { fetchChangeTaskDefaults, type CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { saveModifyTasks, type ExistingTaskLink, type ModifyTaskWriters } from './modifyTasks.ts';

/** What the short cut writes from. */
export interface QuickScheduleInput {
  changeNumber: string;
  changeSysId: string;
  tasks: readonly CtaskTemplate[];
  links: readonly ExistingTaskLink[];
  /** The change's implementation plan as loaded, which the duration block is added to (or replaces the old one in). */
  implementationPlan: string;
}

/** The writes the short cut makes; replaceable in tests. */
export interface QuickScheduleWriters {
  saveTasks: typeof saveModifyTasks;
  readChangeDefaults: (changeSysId: string) => Promise<ChangeTaskDefaults>;
  patchImplementationPlan: (changeSysId: string, implementationPlan: string) => Promise<void>;
  taskWriters?: ModifyTaskWriters;
}

const DEFAULT_WRITERS: QuickScheduleWriters = {
  saveTasks: saveModifyTasks,
  readChangeDefaults: fetchChangeTaskDefaults,
  patchImplementationPlan: async (changeSysId, implementationPlan) => {
    await snowFetch(`/api/now/table/change_request/${encodeURIComponent(changeSysId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ implementation_plan: implementationPlan }),
    });
  },
};

/**
 * Re-dates every task back to back in the change's window and rewrites the duration block on the implementation plan.
 * Returns a plain summary; a failed write throws with ServiceNow's reason.
 */
export async function saveQuickSchedule(input: QuickScheduleInput, writers: QuickScheduleWriters = DEFAULT_WRITERS): Promise<string> {
  const tasksSummary = await writers.saveTasks(
    { changeNumber: input.changeNumber, changeSysId: input.changeSysId, draftTasks: input.tasks, links: input.links, shouldWriteEveryTask: true },
    writers.taskWriters,
  );
  const changeDefaults = await writers.readChangeDefaults(input.changeSysId);
  const plannedWithDurations = applyDurationBlock(
    input.implementationPlan, rollUpEstimates(input.tasks.map((task) => task.durationEstimates)), changeDefaults.plannedStartDate, changeDefaults.plannedEndDate,
  );
  await writers.patchImplementationPlan(input.changeSysId, plannedWithDurations);
  return `${tasksSummary ?? `No tasks on ${input.changeNumber} to date.`} The implementation plan now states the estimated durations.`;
}
