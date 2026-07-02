// SharePointPullPanel.tsx — Pull the intake List from SharePoint. Connection is handled in the
// app's Connection Bar (feature 008), so this panel only shows connection status + the Pull button
// (+ optional auto-refresh) and, when disconnected, points the user to the Connection Bar.

import { useEffect, useState } from 'react';

import styles from '../JiraIntake.module.css';

/** How often auto-refresh re-pulls while enabled and connected. */
const AUTO_REFRESH_INTERVAL_MS = 60000;

interface SharePointPullPanelProps {
  /** Whether the SharePoint site + list are configured (else Pull is unavailable). */
  siteConfigured: boolean;
  isConnected: boolean;
  isPulling: boolean;
  /** Error or missing-column warning to show, or null. */
  statusMessage: string | null;
  onPull: () => void;
}

/** The SharePoint live-pull panel (connect happens in the Connection Bar). */
export default function SharePointPullPanel({
  siteConfigured,
  isConnected,
  isPulling,
  statusMessage,
  onPull,
}: SharePointPullPanelProps) {
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);

  // Auto-refresh re-pulls on an interval, but only while enabled AND connected; it stops on
  // disconnect or when unchecked/unmounted.
  useEffect(() => {
    if (!isAutoRefresh || !isConnected) {
      return undefined;
    }
    const intervalId = window.setInterval(() => onPull(), AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isAutoRefresh, isConnected, onPull]);

  if (!siteConfigured) {
    return (
      <section className={styles.panel} aria-label="SharePoint pull">
        <h2 className={styles.panelTitle}>Pull from SharePoint</h2>
        <p className={styles.subtitle}>
          Add the SharePoint site URL and list name in Intake settings to enable live pull.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="SharePoint pull">
      <h2 className={styles.panelTitle}>
        Pull from SharePoint {isConnected ? '· relay connected' : '· relay not connected'}
      </h2>

      {!isConnected && (
        <p className={styles.subtitle}>
          Connect the SharePoint relay from the <strong>Connection Bar</strong> at the top of the app
          (click the SharePoint indicator), then return here to pull.
        </p>
      )}

      <div className={styles.checkboxRow}>
        <button
          className={styles.primaryButton}
          disabled={!isConnected || isPulling}
          onClick={onPull}
          type="button"
        >
          {isPulling ? 'Pulling…' : 'Pull from SharePoint'}
        </button>
        <label className={styles.checkboxRow}>
          <input
            checked={isAutoRefresh}
            disabled={!isConnected}
            onChange={(event) => setIsAutoRefresh(event.target.checked)}
            type="checkbox"
          />
          Auto-refresh
        </label>
      </div>

      {statusMessage && <p className={styles.dropzoneError} role="alert">{statusMessage}</p>}
    </section>
  );
}
