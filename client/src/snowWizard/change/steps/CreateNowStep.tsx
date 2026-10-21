// CreateNowStep.tsx — "Create in ServiceNow": makes one change per environment, with its tasks, before any writing.
//
// Creating first gives the job real CHG and CTASK numbers for the AI and the text to quote (owner's decision, GH #468).
// The write itself is the runner's (Toolbox's createChg); this screen says what will be made, then shows each change
// with its task numbers, any notes, and "Retry what's missing" if one environment's change did not get made.

import { readEnabledPlanEnvironments } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { buildChangeLink, type CreatedChangeSummary } from '../createOutcome.ts';
import { buildEvidenceArchiveName } from '../../../views/SnowHub/testEvidence/evidenceBundle.ts';
import { EVIDENCE_ATTACHED } from '../evidenceUpload.ts';
import type { JiraEvidenceAttachment } from '../jiraEvidence.ts';
import type { FinishRunner } from '../useFinishRunner.ts';
import WritingEditor from '../WritingEditor.tsx';
import type { TaskNamesByEnvironment } from './CreateResultStep.tsx';

/** The step also needs the runner and the tasks each environment's change will carry. */
export interface CreateNowStepProps extends ChangeStepProps {
  runner: FinishRunner;
  taskNamesByEnvironment: TaskNamesByEnvironment;
  /** Every file on the chosen Jira issues — the test-evidence zip that goes on each change as it is created. */
  jiraEvidence: readonly JiraEvidenceAttachment[];
}

/** What the test-evidence zip will hold: every file on the chosen Jira issues. Nothing to choose. */
function EvidenceZipSummary({ jiraEvidence }: { jiraEvidence: readonly JiraEvidenceAttachment[] }) {
  if (jiraEvidence.length === 0) {
    return <p className={styles.noticeText}>Test evidence: your Jira issues have no files attached, so no evidence zip goes on. Release Management checks for it — attach the test results to the Jira issues first if you can.</p>;
  }
  return (
    <details className={styles.card}>
      <summary className={styles.hint}>{`📎 Test evidence: one zip, “${buildEvidenceArchiveName('<change>', new Date())}”, with all ${jiraEvidence.length} file(s) from your Jira issues — attached as each change is created.`}</summary>
      <ul className={styles.itemList} aria-label="Files in the evidence zip">
        {jiraEvidence.map((evidence) => <li key={evidence.attachment.attachmentId} className={styles.hint}>{`${evidence.issueKey}: ${evidence.attachment.filename}`}</li>)}
      </ul>
    </details>
  );
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

/** One change now in ServiceNow, with the numbers of its tasks. */
function CreatedChangeLine({ createdChange, session }: { createdChange: CreatedChangeSummary } & Pick<ChangeStepProps, 'session'>) {
  const taskRecords = session.createdTasks?.[createdChange.changeNumber];
  const evidenceResult = session.evidenceResults[createdChange.changeNumber];
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
      <p className={styles.hint}>
        {evidenceResult === undefined ? 'Test evidence: not attached yet.'
          : evidenceResult === EVIDENCE_ATTACHED ? `Test evidence: ✓ attached as ${buildEvidenceArchiveName(createdChange.changeNumber, new Date())}.`
            : `Test evidence: ✗ not attached — ${evidenceResult}. Saving on the last step tries again.`}
      </p>
    </li>
  );
}

/** Step: create the changes in ServiceNow now. */
export default function CreateNowStep({ crg, session, runner, taskNamesByEnvironment, jiraEvidence }: CreateNowStepProps) {
  const createdLabels = new Set(session.createdChanges.map((createdChange) => createdChange.environmentLabel));
  const hasMissing = readEnabledPlanEnvironments(crg.state).some((environmentLabel) => !createdLabels.has(environmentLabel));
  const hasCreated = session.createdChanges.length > 0;
  return (
    <div>
      <p className={styles.stepIntro}>
        Your changes are made in ServiceNow now — with their tasks and the test evidence — so the Risk Check and the final
        checks run on the real ticket. Any fixes they make are saved to it on the last step.
      </p>
      {runner.phase.kind === 'working' ? <p className={styles.hint} role="status">{runner.phase.message}</p> : null}
      {hasCreated ? (
        <ul className={styles.itemList} aria-label="Changes in ServiceNow">
          {session.createdChanges.map((createdChange) => <CreatedChangeLine key={createdChange.changeNumber} createdChange={createdChange} session={session} />)}
        </ul>
      ) : (
        <>
          <p className={styles.noticeText}>{`This makes ${describePlanCount(readEnabledPlanEnvironments(crg.state).length, taskNamesByEnvironment)} in ServiceNow, each with the test-evidence zip. Nothing is made until you press the button below.`}</p>
          <EvidenceZipSummary jiraEvidence={jiraEvidence} />
          <WritingEditor crg={crg} title="Last look at the writing before it goes in — edit anything" isOpenAtStart={false} />
          <CreatePlan crg={crg} taskNamesByEnvironment={taskNamesByEnvironment} />
        </>
      )}
      {hasCreated && !hasMissing ? <p className={styles.successText}>Created. Press Next to run the Risk Check on the real ticket.</p> : null}
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
