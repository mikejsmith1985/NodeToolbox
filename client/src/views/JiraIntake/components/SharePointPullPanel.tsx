// SharePointPullPanel.tsx — Connect the SharePoint relay and pull the intake List with one click.
// Shows connection status, the bookmarklet to drag + an Open-site button, a Pull/Refresh button
// (blocked with a message when disconnected), an optional auto-refresh, and any error/warning.
// See spec 007 FR-006/007/008.

import { useEffect, useState } from 'react';

import { openSharePointRelay, SHAREPOINT_RELAY_BOOKMARKLET_CODE } from '../../../services/browserRelay.ts';
import styles from '../JiraIntake.module.css';

/** How often auto-refresh re-pulls while enabled and connected. */
const AUTO_REFRESH_INTERVAL_MS = 60000;

interface SharePointPullPanelProps {
  /** Whether the SharePoint site + list are configured (else Pull is unavailable). */
  siteConfigured: boolean;
  siteUrl: string;
  isConnected: boolean;
  isPulling: boolean;
  /** Error or missing-column warning to show, or null. */
  statusMessage: string | null;
  onCheckConnection: () => void;
  onPull: () => void;
}

/** The SharePoint live-pull panel. */
export default function SharePointPullPanel({
  siteConfigured,
  siteUrl,
  isConnected,
  isPulling,
  statusMessage,
  onCheckConnection,
  onPull,
}: SharePointPullPanelProps) {
  const [isAutoRefresh, setIsAutoRefresh] = useState(false);

  // Auto-refresh re-pulls on an interval, but only while enabled AND connected; it stops on
  // disconnect or when unchecked/unmounted (FR-007).
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
      <div className={styles.header}>
        <h2 className={styles.panelTitle}>
          Pull from SharePoint {isConnected ? '· relay connected' : '· relay not connected'}
        </h2>
        <button className={styles.secondaryButton} onClick={onCheckConnection} type="button">Check connection</button>
      </div>

      {!isConnected && (
        <div className={styles.fieldRow}>
          <p className={styles.subtitle}>
            To connect: drag this bookmarklet to your bookmarks bar, open the SharePoint site, and click it.
          </p>
          <input className={styles.input} readOnly value={SHAREPOINT_RELAY_BOOKMARKLET_CODE} aria-label="SharePoint relay bookmarklet" />
          <button className={styles.secondaryButton} onClick={() => openSharePointRelay(siteUrl)} type="button">
            Open SharePoint site
          </button>
        </div>
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
