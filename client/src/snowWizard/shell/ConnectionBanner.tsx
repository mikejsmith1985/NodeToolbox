// ConnectionBanner.tsx — The strip on every Wizard screen: both connections in words, and the one action that fixes
// whichever is lost. The user's place in a job is never touched by it.

import { describeConnection, type ConnectionState } from './wizardConnectionStore.ts';
import styles from './WizardShell.module.css';

interface ConnectionBannerProps {
  snowState: ConnectionState;
  jiraState: ConnectionState;
  onConnectSnow: () => void;
  onConnectJira: () => void;
}

/** The connection banner. Amber ("warning") whenever either system needs the user's attention. */
export default function ConnectionBanner({ snowState, jiraState, onConnectSnow, onConnectJira }: ConnectionBannerProps) {
  const isSnowLost = snowState.status === 'expired';
  const isJiraLost = jiraState.status === 'expired';
  return (
    <div role="status" className={styles.banner} data-tone={isSnowLost || isJiraLost ? 'warning' : 'ok'}>
      <span>{describeConnection('ServiceNow', snowState)} · {describeConnection('Jira', jiraState)}.</span>
      {!isSnowLost && !isJiraLost && <span> Keep the ServiceNow and Jira tabs open while you work.</span>}
      {isSnowLost && <button type="button" className={styles.bannerButton} onClick={onConnectSnow}>Connect ServiceNow again</button>}
      {isJiraLost && <button type="button" className={styles.bannerButton} onClick={onConnectJira}>Connect Jira again</button>}
    </div>
  );
}
