// ConnectionBanner.tsx — The strip on every Wizard screen: both connections in words, and the one action that fixes
// whichever is lost. The user's place in a job is never touched by it.

import { describeConnection, type ConnectionState } from './wizardConnectionStore.ts';
import styles from './WizardShell.module.css';

interface ConnectionBannerProps {
  snowState: ConnectionState;
  jiraState: ConnectionState;
  onOpenJira: () => void;
}

/** The connection banner. Amber ("warning") whenever either system needs the user's attention. */
export default function ConnectionBanner({ snowState, jiraState, onOpenJira }: ConnectionBannerProps) {
  const isSnowExpired = snowState.status === 'expired';
  const isJiraLost = jiraState.status === 'expired';
  const isWarning = isSnowExpired || isJiraLost;
  return (
    <div role="status" className={styles.banner} data-tone={isWarning ? 'warning' : 'ok'}>
      <span>{describeConnection('ServiceNow', snowState)} · {describeConnection('Jira', jiraState)}.</span>
      {isSnowExpired
        ? <span> Your ServiceNow session ended — click the SNow Wizard bookmark on your ServiceNow tab again.</span>
        : <span> Keep your ServiceNow tab open while you work.</span>}
      {isJiraLost && <button type="button" className={styles.bannerButton} onClick={onOpenJira}>Open Jira again</button>}
    </div>
  );
}
