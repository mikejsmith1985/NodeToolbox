// ConnectStep.tsx — The Connect screen: shows ServiceNow (already connected — the Wizard runs inside it) and walks the
// user through opening Jira, in three plain numbered steps.

import { describeConnection, type ConnectionState } from './wizardConnectionStore.ts';
import styles from './WizardShell.module.css';

interface ConnectStepProps {
  snowState: ConnectionState;
  jiraState: ConnectionState;
  jiraUrl: string;
  onOpenJira: () => void;
}

/** The Connect screen. Jobs on Home open once both rows say connected. */
export default function ConnectStep({ snowState, jiraState, jiraUrl, onOpenJira }: ConnectStepProps) {
  const isJiraConnected = jiraState.status === 'connected';
  return (
    <section className={styles.card} aria-labelledby="connect-heading">
      <h2 id="connect-heading" className={styles.cardTitle}>Connect to ServiceNow and Jira</h2>
      <p className={styles.connectionLine} data-status={snowState.status}>{describeConnection('ServiceNow', snowState)}</p>
      {snowState.detail && <p className={styles.hint}>{snowState.detail}</p>}
      <p className={styles.connectionLine} data-status={jiraState.status}>{describeConnection('Jira', jiraState)}</p>
      {jiraState.detail && <p className={styles.hint}>{jiraState.detail}</p>}
      {!isJiraConnected && (
        <>
          <ol className={styles.numberedSteps}>
            <li>Press <strong>Open Jira</strong>. Jira opens in a new tab ({jiraUrl}).</li>
            <li>Sign in to Jira if it asks.</li>
            <li>Click the SNow Wizard bookmark on the Jira tab — you will come straight back here.</li>
          </ol>
          <button type="button" className={styles.primaryButton} onClick={onOpenJira}>Open Jira</button>
        </>
      )}
    </section>
  );
}
