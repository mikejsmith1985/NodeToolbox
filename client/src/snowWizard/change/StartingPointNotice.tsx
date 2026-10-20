// StartingPointNotice.tsx — The note at the top of a new change that began as a copy of an old change or from a template.

import styles from './ChangeWizard.module.css';
import type { StartingPointHandle } from './useStartingPoint.ts';

const SAVE_TIP = 'When it looks right, press “Save as template” at the top so your next change starts here.';

/** One line of news about the starting point, with the buttons that fit it. */
export default function StartingPointNotice({ startingPoint }: { startingPoint: StartingPointHandle }) {
  const { status, retry, dismiss } = startingPoint;
  if (status.kind === 'none') return null;
  if (status.kind === 'copying') return <p className={styles.hint} role="status">{`Copying ${status.changeNumber} from ServiceNow…`}</p>;
  if (status.kind === 'failed') {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>{`We could not copy ${status.changeNumber}: ${status.message}`}</p>
        <div className={styles.buttonRow}>
          <button type="button" className={styles.actionButton} onClick={retry}>Try again</button>
          <button type="button" className={styles.secondaryButton} onClick={dismiss}>Carry on with a blank change</button>
        </div>
      </div>
    );
  }
  const newsText = status.kind === 'copied'
    ? `Copied ${status.changeNumber} into a new change, tasks included. Pick this release’s Jira issues, then check each step — dates are usually different. ${SAVE_TIP}`
    : `Filled in from your template “${status.templateName}”. Pick this release’s Jira issues, then check each step. ${SAVE_TIP}`;
  return (
    <div className={styles.card}>
      <p className={styles.successText}>{newsText}</p>
      <div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={dismiss}>Got it</button></div>
    </div>
  );
}
