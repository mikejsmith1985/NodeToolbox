// CreateResultStep.tsx — The last step: what will be saved, then every change saved, every failure, and Try again.
//
// A new change was already created on "Create in ServiceNow"; here its finished work is saved to each change.
//
// The writes themselves run in useFinishRunner; this screen only shows them. Each change links to ServiceNow, lists
// the tasks it carries exactly as the user built them, its evidence result and the notes the create path reported
// (outages, PRB links), and a partial create offers "Retry what's missing", which never makes a second change for an
// environment.

import { useEffect, useState } from 'react';

import { buildEvidenceArchiveName } from '../../../views/SnowHub/testEvidence/evidenceBundle.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import type { ChangeWizardStepId } from '../changeWizardSteps.ts';
import { CHANGE_WIZARD_STEP_TITLES } from '../changeWizardSteps.ts';
import styles from '../ChangeWizard.module.css';
import { buildChangeLink, type CreatedChangeSummary } from '../createOutcome.ts';
import { loadSnowUrl } from '../../shell/wizardSettings.ts';
import type { PlanEnvironmentKey } from '../ctaskEnvironmentPlan.ts';
import { EVIDENCE_ATTACHED } from '../evidenceUpload.ts';
import { planModifyTaskWrites } from '../modifyTasks.ts';
import { readSavePreview, type SavePreviewRow } from '../savePreview.ts';
import TemplateSaveCard from '../TemplateSaveCard.tsx';
import type { FinishRunner } from '../useFinishRunner.ts';
import type { TemplateLibrary } from '../useTemplateLibrary.ts';

/** Each environment's tasks, as the user built them, in their order. */
export type TaskNamesByEnvironment = Partial<Record<PlanEnvironmentKey, string[]>>;

/** The last step also needs the runner, each change's tasks, the edited steps and the files chosen. */
export interface CreateResultStepProps extends ChangeStepProps {
  runner: FinishRunner;
  /** The tasks each environment's change will carry, from the cards as they stand now. */
  taskNamesByEnvironment: TaskNamesByEnvironment;
  editedStepIds: readonly ChangeWizardStepId[];
  evidenceFileCount: number;
  /** The template library, for saving this change's picks as a template — the one place templates are saved. */
  library: TemplateLibrary;
}

const TEMPLATE_TIP = 'Doing one like this again? Save its picks as a template below, so your next change starts from them.';

/** "Tasks: Deploy, Smoke test", or that the change has none. */
function describeTasks(taskNames: readonly string[] | undefined): string {
  return taskNames && taskNames.length > 0 ? `Tasks: ${taskNames.join(', ')}` : 'Tasks: none';
}

/** What saving a modify will do. */
function ModifySummary({ crg, session, editedStepIds, evidenceFileCount }: CreateResultStepProps) {
  const editedTitles = editedStepIds.map((stepId) => CHANGE_WIZARD_STEP_TITLES[stepId]);
  const taskWrites = planModifyTaskWrites(crg.state.changeTasks, session.modify?.existingTasks ?? []);
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        {'Save to '}
        {session.modify ? <a href={buildChangeLink(loadSnowUrl(), session.modify.changeNumber)} target="_blank" rel="noreferrer">{session.modify.changeNumber}</a> : null}
      </h3>
      <p className={styles.hint}>{editedTitles.length > 0 ? `Steps you changed: ${editedTitles.join(', ')}.` : 'You have not changed any step.'}</p>
      <p className={styles.hint}>{`Tasks to update: ${taskWrites.updates.length}. New tasks to add: ${taskWrites.creates.length}. Evidence files: ${evidenceFileCount}.`}</p>
    </div>
  );
}

// Long writing is cut short in the table; the whole text is on hover and in the step that holds it.
const PREVIEW_TEXT_LIMIT = 160;

/** A long text cut to the table's width, marked as cut. */
function shortenText(fullText: string): string {
  return fullText.length > PREVIEW_TEXT_LIMIT ? `${fullText.slice(0, PREVIEW_TEXT_LIMIT)}…` : fullText;
}

/** What the read of one change's preview came back with, tagged with the draft it was made for. */
interface PreviewAnswer {
  rows: SavePreviewRow[] | null;
  failureText: string;
}

/** Before saving: each piece of writing that will change on this change, as it is now beside what will be saved. */
function SavePreview({ crg, createdChange }: Pick<CreateResultStepProps, 'crg'> & { createdChange: CreatedChangeSummary }) {
  const [answer, setAnswer] = useState<PreviewAnswer>({ rows: null, failureText: '' });
  const draft = crg.state;
  useEffect(() => {
    let isCurrent = true;
    readSavePreview(draft, createdChange)
      .then((rows) => { if (isCurrent) setAnswer({ rows, failureText: '' }); })
      .catch((readError: unknown) => { if (isCurrent) setAnswer({ rows: [], failureText: readError instanceof Error ? readError.message : String(readError) }); });
    return () => { isCurrent = false; };
  }, [draft, createdChange]);
  if (answer.failureText) return <p className={styles.hint}>{`Could not read ${createdChange.changeNumber} to preview it (${answer.failureText}). Saving still works.`}</p>;
  if (answer.rows === null) return <p className={styles.hint}>Reading what is there now…</p>;
  if (answer.rows.length === 0) return <p className={styles.hint}>The writing already matches — saving updates the tasks and evidence.</p>;
  return (
    <details open>
      <summary className={styles.hint}>{`See what will change (${answer.rows.length})`}</summary>
      <table className={styles.gridTable} aria-label={`What will change on ${createdChange.changeNumber}`}>
        <thead><tr><th>Field</th><th>In ServiceNow now</th><th>After saving</th></tr></thead>
        <tbody>
          {answer.rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td title={row.nowText}>{row.nowText ? shortenText(row.nowText) : '(empty)'}</td>
              <td title={row.afterText}>{row.afterText ? shortenText(row.afterText) : '(empty)'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** What pressing the button will do. */
function PlanSummary(props: CreateResultStepProps) {
  const { session, taskNamesByEnvironment, evidenceFileCount } = props;
  if (session.mode === 'modify') return <ModifySummary {...props} />;
  return (
    <ul className={styles.itemList} aria-label="Changes to save">
      {session.createdChanges.map((createdChange) => (
        <li key={createdChange.changeNumber} className={styles.card}>
          <h3 className={styles.cardTitle}>{`Save to ${createdChange.changeNumber} (${createdChange.environmentLabel ?? 'change'})`}</h3>
          <p className={styles.hint}>{`The text, plans, dates and ${describeTasks(createdChange.environmentLabel ? taskNamesByEnvironment[createdChange.environmentLabel] : undefined).toLowerCase()}`}</p>
          <p className={styles.hint}>{evidenceFileCount > 0 ? `Evidence: ${evidenceFileCount} file(s) zipped and attached.` : 'Evidence: every file on the Jira issues, zipped and attached.'}</p>
          <SavePreview crg={props.crg} createdChange={createdChange} />
        </li>
      ))}
    </ul>
  );
}

/** One change that now exists, with its link, the tasks it was made with, and evidence. */
function CreatedChangeCard({ createdChange, session }: { createdChange: CreatedChangeSummary } & Pick<CreateResultStepProps, 'session'>) {
  const evidenceResult = session.evidenceResults[createdChange.changeNumber];
  const builtTaskNames = createdChange.environmentLabel ? session.taskNamesByEnvironment?.[createdChange.environmentLabel] : undefined;
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>
        {`${createdChange.environmentLabel ?? 'Change'}: `}
        <a href={buildChangeLink(loadSnowUrl(), createdChange.changeNumber)} target="_blank" rel="noreferrer">{createdChange.changeNumber}</a>
      </h3>
      {session.mode === 'create' ? <p className={styles.hint}>{describeTasks(builtTaskNames)}</p> : null}
      <p className={styles.hint}>{evidenceResult === undefined ? 'Evidence: none attached.' : evidenceResult === EVIDENCE_ATTACHED ? `Test evidence: attached as ${buildEvidenceArchiveName(createdChange.changeNumber, new Date())}.` : `Evidence not attached: ${evidenceResult}`}</p>
    </li>
  );
}

/** What happened: every record made, the notes, and any failure with its retry. */
function OutcomeReport(props: CreateResultStepProps) {
  const { session, runner } = props;
  const failureText = session.mode === 'create' ? session.saveFailureText ?? null : session.failureText;
  return (
    <div>
      {failureText === null ? <p className={styles.successText}>All done. Everything below is in ServiceNow.</p> : null}
      {failureText === null ? <p className={styles.hint}>{TEMPLATE_TIP}</p> : null}
      <ul className={styles.itemList} aria-label="What was made">
        {session.createdChanges.map((createdChange) => <CreatedChangeCard key={createdChange.changeNumber} createdChange={createdChange} session={session} />)}
      </ul>
      {session.outcomeNotes.map((outcomeNote) => <p key={outcomeNote} className={styles.hint}>{`• ${outcomeNote}`}</p>)}
      {failureText !== null ? (
        <div className={styles.card}>
          <p className={styles.errorText}>{`Not everything worked: ${failureText}`}</p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.actionButton} onClick={session.mode === 'create' ? runner.startSaveCreated : runner.startSave}>Try saving again</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Both values of every value changed in ServiceNow since the change was loaded, before anything is overwritten. */
function ConflictPanel({ runner }: Pick<CreateResultStepProps, 'runner'>) {
  if (runner.phase.kind !== 'conflicts') return null;
  return (
    <div className={styles.card} role="alertdialog" aria-label="Changed in ServiceNow">
      <p className={styles.noticeText}>Someone changed this in ServiceNow after you loaded it. Saving now puts your values back over theirs.</p>
      <table className={styles.gridTable}>
        <thead><tr><th>Value</th><th>When you loaded it</th><th>In ServiceNow now</th></tr></thead>
        <tbody>
          {runner.phase.conflicts.map((conflict) => (
            <tr key={conflict.fieldLabel}><td>{conflict.fieldLabel}</td><td>{conflict.loadedValue || '(empty)'}</td><td>{conflict.serviceNowValue || '(empty)'}</td></tr>
          ))}
        </tbody>
      </table>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={runner.confirmSave}>Save mine anyway</button>
        <button type="button" className={styles.secondaryButton} onClick={runner.cancelSave}>Don&apos;t save</button>
      </div>
    </div>
  );
}

/** The last step. */
export default function CreateResultStep(props: CreateResultStepProps) {
  const { session, runner } = props;
  const hasAttempted = session.mode === 'create'
    ? Boolean(session.hasSavedChanges) || Boolean(session.saveFailureText)
    : session.createdChanges.length > 0 || session.failureText !== null;
  return (
    <div>
      {runner.phase.kind === 'working' ? <p className={styles.hint} role="status">{runner.phase.message}</p> : null}
      <ConflictPanel runner={runner} />
      {hasAttempted ? <OutcomeReport {...props} /> : <PlanSummary {...props} />}
      <TemplateSaveCard crg={props.crg} session={session} updateSession={props.updateSession} library={props.library} />
    </div>
  );
}
