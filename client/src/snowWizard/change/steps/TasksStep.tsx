// TasksStep.tsx — Step 7 "Which tasks are needed?": tick the change tasks from ServiceNow's own list of task types.
//
// Implementation and Technical Checkout are added by ServiceNow to every change itself, so they show as always
// present rather than being staged twice (GH #376). On a modify, the change's existing tasks are listed and only
// new ones are added.

import { useChangeTaskTypeOptions } from '../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts';
import { buildStagedChangeTask, isServiceNowAddedTaskType } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';

const SERVICENOW_ADDED_NOTE = 'ServiceNow adds this to every change itself.';

/** The tasks a change being modified already has. */
function ExistingTasks({ taskNames }: { taskNames: readonly string[] }) {
  if (taskNames.length === 0) return null;
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Already on this change</h3>
      <ul className={styles.itemList}>{taskNames.map((taskName) => <li key={taskName} className={styles.hint}>{taskName}</li>)}</ul>
    </div>
  );
}

/** Step 7: the change tasks. */
export default function TasksStep({ crg, session }: ChangeStepProps) {
  const { typeOptions, isLoading, loadErrorMessage } = useChangeTaskTypeOptions();
  const { state, actions } = crg;

  function toggleTaskType(typeOption: (typeof typeOptions)[number]) {
    const stagedTask = state.changeTasks.find((task) => task.shortDescription === typeOption.label);
    if (stagedTask) actions.removeChangeTask(stagedTask.id);
    else actions.addChangeTask(buildStagedChangeTask(typeOption, state));
  }

  return (
    <div>
      <p className={styles.stepIntro}>
        {session.mode === 'modify' ? 'Tick any task this change now also needs.' : 'Tick each task this change needs.'}
      </p>
      <ExistingTasks taskNames={session.modify?.existingTaskNames ?? []} />
      {isLoading ? <p className={styles.hint} role="status">Loading ServiceNow&apos;s task types…</p> : null}
      {loadErrorMessage ? <p className={styles.errorText}>{`ServiceNow's task types could not be read: ${loadErrorMessage}`}</p> : null}
      <ul className={styles.itemList}>
        {typeOptions.map((typeOption) => {
          const isAddedByServiceNow = isServiceNowAddedTaskType(typeOption.label) && session.mode === 'create';
          const isChosen = isAddedByServiceNow || state.changeTasks.some((task) => task.shortDescription === typeOption.label);
          return (
            <li key={typeOption.value}>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={isChosen} disabled={isAddedByServiceNow} onChange={() => toggleTaskType(typeOption)} />
                {typeOption.label}
              </label>
              {isAddedByServiceNow ? <p className={styles.hint}>{SERVICENOW_ADDED_NOTE}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
