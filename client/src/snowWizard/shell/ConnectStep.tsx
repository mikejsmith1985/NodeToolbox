// ConnectStep.tsx — The Connect screen: one button per system. Each opens that system in a tab; the user clicks the
// SNow Wizard bookmark there and comes straight back.

import { describeConnection, type ConnectionState } from './wizardConnectionStore.ts';
import styles from './WizardShell.module.css';

interface ConnectStepProps {
  snowState: ConnectionState;
  jiraState: ConnectionState;
  snowUrl: string;
  jiraUrl: string;
  onConnectSnow: () => void;
  onConnectJira: () => void;
  onOpenSettings: () => void;
}

interface ConnectRowProps {
  systemLabel: string;
  systemUrl: string;
  connectionState: ConnectionState;
  onConnect: () => void;
}

function ConnectRow({ systemLabel, systemUrl, connectionState, onConnect }: ConnectRowProps) {
  const isConnected = connectionState.status === 'connected';
  const isConnecting = connectionState.status === 'connecting';
  return (
    <>
      <p className={styles.connectionLine} data-status={connectionState.status}>{describeConnection(systemLabel, connectionState)}</p>
      {connectionState.detail && <p className={styles.hint}>{connectionState.detail}</p>}
      {isConnecting && <p className={styles.hint}>In the {systemLabel} tab ({systemUrl}), sign in if asked, then click the SNow Wizard bookmark.</p>}
      {!isConnected && (
        <button type="button" className={styles.primaryButton} onClick={onConnect}>
          {isConnecting ? `Open ${systemLabel} again` : `Connect ${systemLabel}`}
        </button>
      )}
    </>
  );
}

/** The Connect screen. Jobs on Home open once both rows say connected. */
export default function ConnectStep(props: ConnectStepProps) {
  return (
    <section className={styles.card} aria-labelledby="connect-heading">
      <h2 id="connect-heading" className={styles.cardTitle}>Connect to ServiceNow and Jira</h2>
      <ConnectRow systemLabel="ServiceNow" systemUrl={props.snowUrl} connectionState={props.snowState} onConnect={props.onConnectSnow} />
      <ConnectRow systemLabel="Jira" systemUrl={props.jiraUrl} connectionState={props.jiraState} onConnect={props.onConnectJira} />
      <p className={styles.hint}>
        No SNow Wizard bookmark yet? Get it from{' '}
        <button type="button" className={styles.linkButton} onClick={props.onOpenSettings}>Settings</button> — drag it to your
        bookmarks bar once.
      </p>
    </section>
  );
}
