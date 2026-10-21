// CreateNowStep.tsx — "Create in ServiceNow": makes one change per environment, with its tasks, before any writing.
//
// Creating first gives the job real CHG and CTASK numbers for the AI and the text to quote (owner's decision, GH #468).
// The write itself is the runner's (Toolbox's createChg); this screen says what will be made, then shows each change
// with its task numbers, any notes, and "Retry what's missing" if one environment's change did not get made.

import { useState } from 'react';

import { readEnabledPlanEnvironments } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { buildChangeLink, type CreatedChangeSummary } from '../createOutcome.ts';
import type { PlanEnvironmentKey } from '../ctaskEnvironmentPlan.ts';
import type { FinishRunner } from '../useFinishRunner.ts';
import type { TaskNamesByEnvironment } from './CreateResultStep.tsx';

/** The step also needs the runner and the tasks each environment's change will carry. */
export interface CreateNowStepProps extends ChangeStepProps {
  runner: FinishRunner;
  taskNamesByEnvironment: TaskNamesByEnvironment;
}

/** "2 changes and 3 tasks", from the plan as it stands. */
function describePlanCount(environmentCount: number, taskNamesByEnvironment: TaskNamesByEnvironment): string {
  const taskCount = Object.values(taskNamesByEnvironment).reduce((runningTotal, taskNames) => runningTotal + (taskNames?.length ?? 0), 0);
  return `${environmentCount} change${environmentCount === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'}`;
}

/** What pressing "Yes, create …" will make. */
function CreatePlan({ crg, taskNamesByEnvironment }: Pick<CreateNowStepProps, 'crg' | 'taskNamesByEnvironment'>) {
  return (
    <ul className={styles.itemList} aria-label="Changes to create">
      {readEnabledPlanEnvironments(crg.state).map((environmentLabel) => {
        const taskNames = taskNamesByEnvironment[environmentLabel] ?? [];
        return (
          <li key={environmentLabel} className={styles.card}>
            <h3 className={styles.cardTitle}>{`${environmentLabel} change`}</h3>
            <p className={styles.hint}>{taskNames.length > 0 ? `Tasks: ${taskNames.join(', ')}` : 'Tasks: none'}</p>
          </li>
        );
      })}
    </ul>
  );
}

// A ServiceNow change number: "CHG" and its digits.
const CHANGE_NUMBER_PATTERN = /^CHG\d+$/;

/**
 * "Already created them?": one number per environment, so a job that lost track of its changes (or a fresh job for
 * changes made earlier) uses them instead of making duplicates.
 */
function ExistingChangesForm({ environmentLabels, runner }: { environmentLabels: PlanEnvironmentKey[]; runner: FinishRunner }) {
  const [typedNumbers, setTypedNumbers] = useState<Partial<Record<PlanEnvironmentKey, string>>>({});
  const readNumber = (environmentLabel: PlanEnvironmentKey) => (typedNumbers[environmentLabel] ?? '').trim().toUpperCase();
  const isComplete = environmentLabels.every((environmentLabel) => CHANGE_NUMBER_PATTERN.test(readNumber(environmentLabel)));
  return (
    <details className={styles.moreOptions}>
      <summary>Already created these changes? Use them instead</summary>
      <p className={styles.hint}>Type each change&apos;s number. Nothing new is created; the last step saves your work to these.</p>
      {environmentLabels.map((environmentLabel) => (
        <label key={environmentLabel} className={styles.fieldLabel}>
          {`${environmentLabel} change number`}
          <input className={styles.inputField} value={typedNumbers[environmentLabel] ?? ''} placeholder="CHG0012345"
            onChange={(changeEvent) => setTypedNumbers({ ...typedNumbers, [environmentLabel]: changeEvent.target.value })} />
        </label>
      ))}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={!isComplete}
          onClick={() => runner.adoptExistingChanges(environmentLabels.map((environmentLabel) => ({ environmentLabel, changeNumber: readNumber(environmentLabel) })))}>
          Use these changes
        </button>
      </div>
    </details>
  );
}

/** One change now in ServiceNow, with the numbers of its tasks. */
function CreatedChangeLine({ createdChange, session }: { createdChange: CreatedChangeSummary } & Pick<ChangeStepProps, 'session'>) {
  const taskRecords = session.createdTasks?.[createdChange.changeNumber];
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>
        {`${createdChange.environmentLabel ?? 'Change'}: `}
        <a href={buildChangeLink(window.location.origin, createdChange.changeNumber)} target="_blank" rel="noreferrer">{createdChange.changeNumber}</a>
      </h3>
      <p className={styles.hint}>
        {taskRecords === undefined ? 'Tasks: reading their numbers…'
          : taskRecords.length === 0 ? 'Tasks: none'
            : `Tasks: ${taskRecords.map((taskRecord) => `${taskRecord.number} ${taskRecord.shortDescription}`.trim()).join(', ')}`}
      </p>
    </li>
  );
}

/** Step: create the changes in ServiceNow now. */
export default function CreateNowStep({ crg, session, runner, taskNamesByEnvironment }: CreateNowStepProps) {
  const createdLabels = new Set(session.createdChanges.map((createdChange) => createdChange.environmentLabel));
  const hasMissing = readEnabledPlanEnvironments(crg.state).some((environmentLabel) => !createdLabels.has(environmentLabel));
  const hasCreated = session.createdChanges.length > 0;
  return (
    <div>
      <p className={styles.stepIntro}>
        Your changes are made in ServiceNow now, before the writing, so the text can name their real change and task numbers.
        The finished text, plans and test evidence are saved to them on the last step.
      </p>
      {runner.phase.kind === 'working' ? <p className={styles.hint} role="status">{runner.phase.message}</p> : null}
      {hasCreated ? (
        <ul className={styles.itemList} aria-label="Changes in ServiceNow">
          {session.createdChanges.map((createdChange) => <CreatedChangeLine key={createdChange.changeNumber} createdChange={createdChange} session={session} />)}
        </ul>
      ) : (
        <>
          <p className={styles.noticeText}>{`This makes ${describePlanCount(readEnabledPlanEnvironments(crg.state).length, taskNamesByEnvironment)} in ServiceNow. Nothing is made until you press the button below.`}</p>
          <CreatePlan crg={crg} taskNamesByEnvironment={taskNamesByEnvironment} />
          <ExistingChangesForm environmentLabels={readEnabledPlanEnvironments(crg.state)} runner={runner} />
        </>
      )}
      {hasCreated && !hasMissing ? <p className={styles.successText}>Created. Press Next — the AI writes the text next, using these numbers.</p> : null}
      {session.outcomeNotes.map((outcomeNote) => <p key={outcomeNote} className={styles.hint}>{`• ${outcomeNote}`}</p>)}
      {session.failureText !== null && hasMissing ? (
        <div className={styles.card}>
          <p className={styles.errorText}>{`Not everything was created: ${session.failureText}`}</p>
          {hasCreated ? (
            <div className={styles.buttonRow}>
              <button type="button" className={styles.actionButton} onClick={runner.retryMissing}>Retry what&apos;s missing</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
