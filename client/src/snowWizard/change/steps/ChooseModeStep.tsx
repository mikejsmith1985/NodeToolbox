// ChooseModeStep.tsx — The change job's first screen: a new change, or change an existing one — and any job to continue.

import styles from '../../shell/WizardShell.module.css';
import type { WizardJob } from '../../shell/wizardJobStore.ts';
import ownStyles from '../ChangeWizard.module.css';

interface ChooseModeStepProps {
  /** In-progress jobs of this kind, offered to continue or start again. */
  resumableJobs: readonly WizardJob[];
  onChooseNew: () => void;
  onChooseExisting: () => void;
  onContinue: (job: WizardJob) => void;
  onStartAgain: (job: WizardJob) => void;
  onExit: () => void;
}

/** What each resumable job is called. */
const JOB_NAMES: Readonly<Record<string, string>> = { newChange: 'Your new change', modifyChange: 'Your change edit' };
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;

/** "5 minutes ago" / "3 hours ago" for the resume card. */
function describeAge(updatedAt: number): string {
  const minutesAgo = Math.max(0, Math.round((Date.now() - updatedAt) / MILLISECONDS_PER_MINUTE));
  return minutesAgo < MINUTES_PER_HOUR ? `${minutesAgo} minute(s) ago` : `${Math.round(minutesAgo / MINUTES_PER_HOUR)} hour(s) ago`;
}

/** The two choices, plus a card per job already under way. */
export default function ChooseModeStep({ resumableJobs, onChooseNew, onChooseExisting, onContinue, onStartAgain, onExit }: ChooseModeStepProps) {
  return (
    <section aria-labelledby="change-job-heading">
      <h2 id="change-job-heading" className={styles.cardTitle}>Make or change a change</h2>
      {resumableJobs.map((job) => (
        <div key={job.jobId} className={styles.card}>
          <p className={styles.connectionLine}>{`${JOB_NAMES[job.kind] ?? 'Your change'} is waiting (last worked on ${describeAge(job.updatedAt)}).`}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={() => onContinue(job)}>Continue</button>
            <button type="button" className={styles.secondaryButton} onClick={() => onStartAgain(job)}>Start again</button>
          </div>
        </div>
      ))}
      <div className={styles.choiceGrid}>
        <button type="button" className={styles.choiceCard} onClick={onChooseNew}>
          <span className={styles.choiceTitle}>New change</span>
          <span className={styles.choiceDescription}>Raise a change for a release, one per environment.</span>
        </button>
        <button type="button" className={styles.choiceCard} onClick={onChooseExisting}>
          <span className={styles.choiceTitle}>Change an existing one</span>
          <span className={styles.choiceDescription}>Load a change by its number and fix what needs fixing.</span>
        </button>
      </div>
      <div className={ownStyles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={onExit}>Back to home</button></div>
    </section>
  );
}
