// TasksStep.tsx — Step "Build the tasks": a blank canvas where the user builds each change task, or starts one from a saved task.
//
// The cards ARE the change's tasks: nothing is added behind the user's back, and the order here is the order they are
// written in. On a new change each card says which environment's change gets it; on a modify, the change's own tasks
// arrive as cards (edits update them) and any card added is created on the change.

import { useChangeTaskTypeOptions } from '../../../views/SnowHub/hooks/useChangeTaskTypeOptions.ts';
import type { CtaskTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import ChoiceSelect from '../ChoiceSelect.tsx';
import { readEnabledPlanEnvironments } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { buildBlankChangeTask, buildTaskFromTemplate, listTaskProblems } from '../taskCards.ts';
import TemplateSaveCard from '../TemplateSaveCard.tsx';
import { buildTaskTemplateData } from '../templateSave.ts';
import type { TemplateLibrary } from '../useTemplateLibrary.ts';
import TaskCard from './TaskCard.tsx';

/** The step also needs the job's template library, for "Add from a saved task" and "Save as task template". */
export interface TasksStepProps extends ChangeStepProps {
  library: TemplateLibrary;
}

const TYPES_LOADING_TEXT = 'Getting ServiceNow’s task types…';
const TYPES_FAILED_TEXT = 'ServiceNow’s task types are not available';

/** "Add a task" and "Add from a saved task". */
function AddTaskControls({ crg, library }: Pick<TasksStepProps, 'crg' | 'library'>) {
  const savedTaskOptions = library.ctaskTemplates.map((ctaskTemplate) => ({ value: ctaskTemplate.id, label: ctaskTemplate.name }));
  function addFromSavedTask(templateId: string) {
    const chosenTemplate = library.ctaskTemplates.find((ctaskTemplate) => ctaskTemplate.id === templateId);
    if (chosenTemplate) crg.actions.addChangeTask(buildTaskFromTemplate(chosenTemplate));
  }
  return (
    <div className={styles.card}>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={() => crg.actions.addChangeTask(buildBlankChangeTask(crg.state))}>Add a task</button>
      </div>
      <ChoiceSelect label="Add from a saved task" options={savedTaskOptions} value="" onChange={addFromSavedTask}
        unavailableText="You have no saved tasks yet" />
    </div>
  );
}

/** What the step says first. */
function readIntro(isModify: boolean): string {
  return isModify
    ? 'These are the tasks on this change. Change any of them, put them in order, or add more.'
    : 'Build each task this change needs, in the order they happen. Tick which changes get each one.';
}

/** The tasks step. */
export default function TasksStep({ crg, session, updateSession, library }: TasksStepProps) {
  const { typeOptions, isLoading, loadErrorMessage } = useChangeTaskTypeOptions();
  const { state, actions } = crg;
  const enabledEnvironments = readEnabledPlanEnvironments(state);
  const existingTaskIds = new Set((session.modify?.existingTasks ?? []).map((link) => link.taskId));
  const taskProblems = listTaskProblems(state.changeTasks, enabledEnvironments, session.mode);
  const updateTask = (updatedTask: CtaskTemplate) => actions.updateChangeTask(updatedTask.id, buildTaskTemplateData(updatedTask));
  return (
    <div>
      <p className={styles.stepIntro}>{readIntro(session.mode === 'modify')}</p>
      {loadErrorMessage ? <p className={styles.errorText}>{`ServiceNow's task types could not be read: ${loadErrorMessage}`}</p> : null}
      {state.changeTasks.length === 0 ? <p className={styles.hint}>No tasks yet. Press “Add a task” to build one.</p> : null}
      <ol className={styles.itemList} aria-label="Your tasks">
        {state.changeTasks.map((task, taskIndex) => (
          <TaskCard key={task.id} task={task} taskIndex={taskIndex} taskCount={state.changeTasks.length} typeOptions={typeOptions}
            typeUnavailableText={isLoading || !loadErrorMessage ? TYPES_LOADING_TEXT : TYPES_FAILED_TEXT}
            enabledEnvironments={enabledEnvironments} isEnvironmentChoiceShown={session.mode === 'create'} isExistingTask={existingTaskIds.has(task.id)}
            onChange={updateTask} onMove={(offset) => actions.moveChangeTask(task.id, offset)} onRemove={() => actions.removeChangeTask(task.id)}
            onSaveAsTemplate={(templateName) => library.saveCtaskTemplate(templateName, buildTaskTemplateData(task))} />
        ))}
      </ol>
      <AddTaskControls crg={crg} library={library} />
      {taskProblems.map((taskProblem) => <p key={taskProblem} className={styles.errorText}>{taskProblem}</p>)}
      {/* The last picking step: every pick is made, nothing is written yet — the natural moment to keep them. */}
      {session.mode === 'create' ? <TemplateSaveCard crg={crg} session={session} updateSession={updateSession} library={library} /> : null}
    </div>
  );
}
