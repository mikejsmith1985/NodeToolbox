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

/**
 * Displays global Jira, SNow, and relay bridge readiness for the app shell.
 * Jira and SNow indicators go green only after a live API probe succeeds —
 * not just when credentials are present in the config file.
 */
export function ConnectionBar() {
  // Use verified flags so the indicator reflects actual reachability, not just config presence.
  const isJiraVerified = useConnectionStore((state) => state.isJiraVerified);
  const isSnowVerified = useConnectionStore((state) => state.isSnowVerified);
  const relayBridgeStatus = useConnectionStore((state) => state.relayBridgeStatus);
  const isRelayActive = relayBridgeStatus?.isConnected ?? false;

  return (
    <div className={styles.connectionBar} aria-label="Connection status">
      <ConnectionIndicator label="Jira" isReady={isJiraVerified} />
      <ConnectionIndicator label="SNow" isReady={isSnowVerified} />
      <ConnectionIndicator label="Relay" isReady={isRelayActive} />
    </div>
  );
}
