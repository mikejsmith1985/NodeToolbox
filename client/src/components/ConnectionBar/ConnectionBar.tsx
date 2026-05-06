// ConnectionBar.tsx — Compact status bar showing live Jira, SNow, and relay connectivity.

import { useConnectionStore } from '../../store/connectionStore.ts';
import styles from './ConnectionBar.module.css';

interface ConnectionIndicatorProps {
  label: string;
  isReady: boolean;
}

/** Renders a single labeled connection indicator for the top status bar. */
function ConnectionIndicator({
  label,
  isReady,
}: ConnectionIndicatorProps) {
  return (
    <span className={`${styles.indicator} ${isReady ? styles.ready : styles.notReady}`}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Displays global Jira, SNow, and relay bridge readiness for the app shell. */
export function ConnectionBar() {
  const isJiraReady = useConnectionStore((state) => state.isJiraReady);
  const isSnowReady = useConnectionStore((state) => state.isSnowReady);
  const relayBridgeStatus = useConnectionStore((state) => state.relayBridgeStatus);
  const isRelayActive = relayBridgeStatus?.isConnected ?? false;

  return (
    <div className={styles.connectionBar} aria-label="Connection status">
      <ConnectionIndicator label="Jira" isReady={isJiraReady} />
      <ConnectionIndicator label="SNow" isReady={isSnowReady} />
      <ConnectionIndicator label="Relay" isReady={isRelayActive} />
    </div>
  );
}
