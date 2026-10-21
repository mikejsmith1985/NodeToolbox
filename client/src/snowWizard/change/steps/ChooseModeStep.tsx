// ChooseModeStep.tsx — The change job's first screen: create a new change, or modify a change that is in ServiceNow.
//
// Owner feedback: the screen did not flow — it managed half-finished states ("finish one I started", "use them in my
// open change"). Now there are two choices. A job already under way simply reopens where it was left (its button
// says so), and "Start over" inside it begins afresh; a change already in ServiceNow is finished through "Modify".

import type { WizardJob } from '../../shell/wizardJobStore.ts';
import styles from '../../shell/WizardShell.module.css';
import ownStyles from '../ChangeWizard.module.css';

interface ChooseModeStepProps {
  /** Jobs already under way (at most one of each kind), so their button can say it picks up where it was left. */
  resumableJobs: readonly WizardJob[];
  onCreate: () => void;
  onModify: () => void;
  onOpenTemplates: () => void;
  onExit: () => void;
}

const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;

/** "5 minutes ago" / "3 hours ago". */
function describeAge(updatedAt: number): string {
  const minutesAgo = Math.max(0, Math.round((Date.now() - updatedAt) / MILLISECONDS_PER_MINUTE));
  return minutesAgo < MINUTES_PER_HOUR ? `${minutesAgo} minute(s) ago` : `${Math.round(minutesAgo / MINUTES_PER_HOUR)} hour(s) ago`;
}

/** One of the two big choices, saying when it picks up a job already under way. */
function ChoiceCard({ title, description, waitingJob, onChoose }: { title: string; description: string; waitingJob?: WizardJob; onChoose: () => void }) {
  return (
    <button type="button" className={styles.choiceCard} onClick={onChoose}>
      <span className={styles.choiceTitle}>{title}</span>
      <span className={styles.choiceDescription}>{description}</span>
      {waitingJob ? <span className={styles.hint}>{`Picks up the one you started ${describeAge(waitingJob.updatedAt)}.`}</span> : null}
    </button>
  );
}

/** The first screen of the change job. */
export default function ChooseModeStep({ resumableJobs, onCreate, onModify, onOpenTemplates, onExit }: ChooseModeStepProps) {
  return (
    <section aria-labelledby="change-job-heading">
      <h2 id="change-job-heading" className={styles.cardTitle}>What do you want to do?</h2>
      <div className={styles.choiceGrid}>
        <ChoiceCard title="Create a new change" description="Raise a change for a release — one per environment — from Jira work, a template, or a change you raised before."
          waitingJob={resumableJobs.find((job) => job.kind === 'newChange')} onChoose={onCreate} />
        <ChoiceCard title="Modify a change in ServiceNow" description="Load any change by its number (or pick one of yours), fix what needs fixing, and save it."
          waitingJob={resumableJobs.find((job) => job.kind === 'modifyChange')} onChoose={onModify} />
      </div>
      <div className={ownStyles.buttonRow}>
        <button type="button" className={styles.secondaryButton} onClick={onOpenTemplates}>Manage templates</button>
        <button type="button" className={styles.secondaryButton} onClick={onExit}>Back to home</button>
      </div>
    </section>
  );
}
