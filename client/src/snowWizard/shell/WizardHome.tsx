// WizardHome.tsx — The Wizard's home: three large choices, one per job, held closed until ServiceNow and Jira are
// connected. The jobs themselves arrive in later releases (tasks.md US1–US4).

import styles from './WizardShell.module.css';

interface WizardJobChoice {
  title: string;
  description: string;
}

/** The three jobs, in the words the user would use for them. */
const WIZARD_JOB_CHOICES: readonly WizardJobChoice[] = [
  { title: 'Make or change a change', description: 'Build a new change step by step, or fix one that already exists.' },
  { title: 'Turn a problem into Jira work', description: 'Find a problem record and create its Defect, SL story and QE story together.' },
  { title: 'Review a change', description: 'Check any change against the review rules and get a plain-English note for its author.' },
];

const NOT_READY_REASON = 'Connect ServiceNow and Jira first';
const NOT_YET_AVAILABLE_REASON = 'Arrives in the next update';

interface WizardHomeProps {
  isReady: boolean;
  onOpenSettings: () => void;
}

/** The home screen. */
export default function WizardHome({ isReady, onOpenSettings }: WizardHomeProps) {
  return (
    <section aria-labelledby="home-heading">
      <h2 id="home-heading" className={styles.cardTitle}>What would you like to do?</h2>
      <div className={styles.choiceGrid}>
        {WIZARD_JOB_CHOICES.map((jobChoice) => (
          <button key={jobChoice.title} type="button" className={styles.choiceCard} disabled aria-describedby={`${jobChoice.title}-reason`}>
            <span className={styles.choiceTitle}>{jobChoice.title}</span>
            <span className={styles.choiceDescription}>{jobChoice.description}</span>
            <span id={`${jobChoice.title}-reason`} className={styles.hint}>{isReady ? NOT_YET_AVAILABLE_REASON : NOT_READY_REASON}</span>
          </button>
        ))}
      </div>
      <button type="button" className={styles.secondaryButton} onClick={onOpenSettings}>Settings</button>
    </section>
  );
}
