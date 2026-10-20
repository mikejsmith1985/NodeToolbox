// TaskCard.tsx — One task the user builds: what it is, its type, who does it, which changes get it, and its own buttons.
//
// Every value that must match ServiceNow exactly is picked from ServiceNow's own lists (the task type list, the group
// and people look-ups), never typed. The configuration item is not asked for: every task takes the change's own.

import { useId, useState } from 'react';

import { SnowLookupField } from '../../../views/SnowHub/components/SnowLookupField.tsx';
import type { CtaskTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import type { SnowChoiceOption } from '../../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import ChoiceSelect from '../ChoiceSelect.tsx';
import styles from '../ChangeWizard.module.css';
import { readTaskEnvironmentTicks, toggleTaskEnvironment, type PlanEnvironmentKey } from '../ctaskEnvironmentPlan.ts';
import { describeTaskCard } from '../taskCards.ts';

/** Everything one card needs, and the ways it can change. */
export interface TaskCardProps {
  task: CtaskTemplate;
  taskIndex: number;
  taskCount: number;
  typeOptions: readonly SnowChoiceOption[];
  /** Shown in the type list while ServiceNow's task types are not available. */
  typeUnavailableText: string;
  enabledEnvironments: readonly PlanEnvironmentKey[];
  /** A new change is one change per environment, so each task says which it goes on; a modify edits one change. */
  isEnvironmentChoiceShown: boolean;
  /** A task the change already has: edits update it, and it cannot be removed here. */
  isExistingTask: boolean;
  onChange: (updatedTask: CtaskTemplate) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
  /** Saves the card as a reusable task template under the name given. */
  onSaveAsTemplate: (templateName: string) => void;
}

/** The short description and the longer description. */
function TaskWords({ task, onChange }: Pick<TaskCardProps, 'task' | 'onChange'>) {
  const titleFieldId = useId();
  const descriptionFieldId = useId();
  return (
    <>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor={titleFieldId}>Short description (needed)</label>
        <input id={titleFieldId} className={styles.inputField} value={task.shortDescription} placeholder="For example: Smoke test the payments page"
          onChange={(changeEvent) => onChange({ ...task, shortDescription: changeEvent.target.value })} />
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor={descriptionFieldId}>Description</label>
        <textarea id={descriptionFieldId} className={styles.textArea} value={task.description} placeholder="What to do, step by step"
          onChange={(changeEvent) => onChange({ ...task, description: changeEvent.target.value })} />
      </div>
    </>
  );
}

/** The tick boxes for which environment's change gets this task. */
function TaskEnvironmentTicks({ task, taskIndex, enabledEnvironments, onChange }: Pick<TaskCardProps, 'task' | 'taskIndex' | 'enabledEnvironments' | 'onChange'>) {
  const ticks = readTaskEnvironmentTicks(task, enabledEnvironments);
  const taskLabel = describeTaskCard(task, taskIndex);
  return (
    <fieldset className={styles.fieldGroup}>
      <legend className={styles.fieldLabel}>Which changes get this task?</legend>
      {enabledEnvironments.map((environmentKey) => (
        <label key={environmentKey} className={styles.checkboxRow}>
          <input type="checkbox" aria-label={`${taskLabel} on ${environmentKey}`} checked={ticks[environmentKey]}
            onChange={() => onChange({ ...task, environmentKeys: toggleTaskEnvironment(task, environmentKey, enabledEnvironments) })} />
          {`The ${environmentKey} change`}
        </label>
      ))}
    </fieldset>
  );
}

/** "Save as task template": asks for a name (starting from the short description) and confirms. */
function SaveAsTaskTemplate({ task, taskIndex, onSaveAsTemplate }: Pick<TaskCardProps, 'task' | 'taskIndex' | 'onSaveAsTemplate'>) {
  const nameFieldId = useId();
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [savedName, setSavedName] = useState('');
  if (templateName === null) {
    return (
      <span className={styles.buttonRow}>
        <button type="button" className={styles.secondaryButton} onClick={() => setTemplateName(describeTaskCard(task, taskIndex))}>Save as task template</button>
        {savedName ? <span className={styles.successText} role="status">{`Saved ✓ “${savedName}” is in your saved tasks.`}</span> : null}
      </span>
    );
  }
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={nameFieldId}>Name this task template</label>
      <input id={nameFieldId} className={styles.inputField} value={templateName} onChange={(changeEvent) => setTemplateName(changeEvent.target.value)} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={templateName.trim() === ''}
          onClick={() => { onSaveAsTemplate(templateName.trim()); setSavedName(templateName.trim()); setTemplateName(null); }}>Save task template</button>
        <button type="button" className={styles.secondaryButton} onClick={() => setTemplateName(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** Move up / Move down / Remove for one card. */
function TaskOrderButtons({ task, taskIndex, taskCount, isExistingTask, onMove, onRemove }: Pick<TaskCardProps, 'task' | 'taskIndex' | 'taskCount' | 'isExistingTask' | 'onMove' | 'onRemove'>) {
  const taskLabel = describeTaskCard(task, taskIndex);
  return (
    <div className={styles.buttonRow}>
      <button type="button" className={styles.secondaryButton} aria-label={`Move ${taskLabel} up`} disabled={taskIndex === 0} onClick={() => onMove(-1)}>Move up</button>
      <button type="button" className={styles.secondaryButton} aria-label={`Move ${taskLabel} down`} disabled={taskIndex === taskCount - 1} onClick={() => onMove(1)}>Move down</button>
      {isExistingTask ? null : <button type="button" className={styles.secondaryButton} aria-label={`Remove ${taskLabel}`} onClick={onRemove}>Remove</button>}
    </div>
  );
}

/** One task card. */
export default function TaskCard(props: TaskCardProps) {
  const { task, taskIndex, typeOptions, typeUnavailableText, isEnvironmentChoiceShown, isExistingTask, onChange } = props;
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>{`Task ${taskIndex + 1}: ${describeTaskCard(task, taskIndex)}`}</h3>
      {isExistingTask ? <p className={styles.hint}>Already on this change. Your edits update it.</p> : null}
      <TaskWords task={task} onChange={onChange} />
      <ChoiceSelect label="Task type" options={typeOptions} value={task.changeTaskType ?? ''} unavailableText={typeUnavailableText}
        onChange={(changeTaskType) => onChange({ ...task, changeTaskType })} />
      <SnowLookupField label="Assignment group" tableName="sys_user_group" value={task.assignmentGroup} onChange={(assignmentGroup) => onChange({ ...task, assignmentGroup })} />
      <SnowLookupField label="Assigned to" tableName="sys_user" value={task.assignedTo} onChange={(assignedTo) => onChange({ ...task, assignedTo })} />
      <p className={styles.hint}>The configuration item is the change&apos;s own, so there is nothing to pick.</p>
      {isEnvironmentChoiceShown ? <TaskEnvironmentTicks task={task} taskIndex={taskIndex} enabledEnvironments={props.enabledEnvironments} onChange={onChange} /> : null}
      <TaskOrderButtons {...props} />
      <SaveAsTaskTemplate task={task} taskIndex={taskIndex} onSaveAsTemplate={props.onSaveAsTemplate} />
    </li>
  );
}
