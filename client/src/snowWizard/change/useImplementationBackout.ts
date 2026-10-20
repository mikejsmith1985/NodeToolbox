// useImplementationBackout.ts — Keeps every Implementation task's backout plan in step with the change's, as it is written.
//
// Runs the pure rule (implementationBackout.ts) whenever the change's backout plan or the tasks change, so the task
// cards, the checks and the create all see the same descriptions — no separate stamping at create time.

import { useEffect, useRef } from 'react';

import type { CtaskTemplateData } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgHook } from './changeDraft.ts';
import { listImplementationBackoutUpdates } from './implementationBackout.ts';

/** Copies the change's backout plan into Implementation tasks that have none of their own. */
export function useImplementationBackout(crg: CrgHook): void {
  const changeBackoutPlan = crg.state.chgPlanningContent.backoutPlan;
  const changeTasks = crg.state.changeTasks;
  const { updateChangeTask } = crg.actions;
  const previousPlanRef = useRef('');

  useEffect(() => {
    const updates = listImplementationBackoutUpdates(changeTasks, changeBackoutPlan, previousPlanRef.current);
    previousPlanRef.current = changeBackoutPlan.trim();
    for (const update of updates) {
      const task = changeTasks.find((changeTask) => changeTask.id === update.taskId);
      if (task) updateChangeTask(update.taskId, { ...task, description: update.description } as CtaskTemplateData);
    }
  }, [changeBackoutPlan, changeTasks, updateChangeTask]);
}
