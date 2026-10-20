// WizardHome.tsx — The Wizard's home: three large choices, one per job, held closed until ServiceNow and Jira are
// connected, then each opens its own guided job.

import type { WizardJobId } from './wizardJobProps.ts';
import styles from './WizardShell.module.css';

interface WizardJobChoice {
  jobId: WizardJobId;
  title: string;
  description: string;
}

/** The three jobs, in the words the user would use for them. */
const WIZARD_JOB_CHOICES: readonly WizardJobChoice[] = [
  { jobId: 'change', title: 'Make or change a change', description: 'Build a new change step by step, or fix one that already exists.' },
  { jobId: 'prb', title: 'Turn a problem into Jira work', description: 'Find a problem record and create its Defect, SL story and QE story together.' },
  { jobId: 'review', title: 'Review a change', description: 'Check any change against the review rules and get a plain-English note for its author.' },
];

const NOT_READY_REASON = 'Connect ServiceNow and Jira first';

interface WizardHomeProps {
  isReady: boolean;
  onOpenSettings: () => void;
  onChooseJob: (jobId: WizardJobId) => void;
}

/** The home screen. */
export default function WizardHome({ isReady, onOpenSettings, onChooseJob }: WizardHomeProps) {
  return (
    <section aria-labelledby="home-heading">
      <h2 id="home-heading" className={styles.cardTitle}>What would you like to do?</h2>
      <div className={styles.choiceGrid}>
        {WIZARD_JOB_CHOICES.map((jobChoice) => (
          <button key={jobChoice.jobId} type="button" className={styles.choiceCard} disabled={!isReady} onClick={() => onChooseJob(jobChoice.jobId)}>
            <span className={styles.choiceTitle}>{jobChoice.title}</span>
            <span className={styles.choiceDescription}>{jobChoice.description}</span>
            {!isReady && <span className={styles.hint}>{NOT_READY_REASON}</span>}
          </button>
        ))}
      </div>
      <button type="button" className={styles.secondaryButton} onClick={onOpenSettings}>Settings</button>
    </section>
  );
}
