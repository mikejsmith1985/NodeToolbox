// StartOverControl.tsx — "Start over": throws this job away and goes back to the first screen, after one on-page question.
//
// Asked on the page (never a browser pop-up, which can freeze the Wizard's window). When the job already made changes in
// ServiceNow, the question says plainly that they stay there and how to pick them up again, so nothing is lost by surprise.

import { useState } from 'react';

import styles from './ChangeWizard.module.css';

/** What the control needs: the job's changes already in ServiceNow (if any), and what starting over does. */
export interface StartOverControlProps {
  createdChangeNumbers: readonly string[];
  onStartOver: () => void;
}

/** The "Start over" button and its one question. */
export default function StartOverControl({ createdChangeNumbers, onStartOver }: StartOverControlProps) {
  const [isAsking, setIsAsking] = useState(false);
  if (!isAsking) {
    return <button type="button" className={styles.secondaryButton} onClick={() => setIsAsking(true)}>Start over</button>;
  }
  const hasCreatedChanges = createdChangeNumbers.length > 0;
  return (
    <div className={styles.card} role="alertdialog" aria-label="Start over?">
      <p className={styles.noticeText}>Start over? Everything in this job is cleared and you go back to the first screen.</p>
      {hasCreatedChanges ? (
        <p className={styles.hint}>
          {`${createdChangeNumbers.join(' and ')} stay in ServiceNow — starting over does not delete them. To finish them later, choose “Finish one I started”, then “Finish changes you already created”.`}
        </p>
      ) : null}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={onStartOver}>Yes, start over</button>
        <button type="button" className={styles.secondaryButton} onClick={() => setIsAsking(false)}>Keep going</button>
      </div>
    </div>
  );
}
