// SharePointPullPanel.tsx — Connect the SharePoint relay and pull the intake List with one click.
// Shows connection status, the bookmarklet to drag + an Open-site button, a Pull/Refresh button
// (blocked with a message when disconnected), an optional auto-refresh, and any error/warning.
// See spec 007 FR-006/007/008.

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';

import { BookmarkletInstallLink } from '../../../components/BookmarkletInstallLink/index.tsx';
import { SHAREPOINT_RELAY_BOOKMARKLET_CODE } from '../../../services/browserRelay.ts';
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
  onCheckConnection: () => void;
  onPull: () => void;
}

/** Warns if the user clicks the bookmarklet here instead of dragging it to the bookmarks bar. */
function handleBookmarkletClick(clickEvent: ReactMouseEvent<HTMLAnchorElement>): void {
  clickEvent.preventDefault();
  window.alert(
    'Drag "NodeToolbox SharePoint Relay" to your browser bookmarks bar first. ' +
    'Then open your SharePoint site and click that bookmark from the SharePoint tab.',
  );
}

/** The SharePoint live-pull panel. */
export default function SharePointPullPanel({
  siteConfigured,
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
          <p className={styles.subtitle}>To connect the relay (one-time bookmarklet install):</p>
          <ol className={styles.panelSteps}>
            <li>Drag the link below to your browser&apos;s bookmarks bar.</li>
            <li>Open your SharePoint site in a browser tab (where you can see the Jira-Intake list).</li>
            <li>Click the <strong>NodeToolbox SharePoint Relay</strong> bookmark from that tab, then return here and click <strong>Check connection</strong>.</li>
          </ol>
          <BookmarkletInstallLink
            bookmarkletCode={SHAREPOINT_RELAY_BOOKMARKLET_CODE}
            className={styles.secondaryButton}
            title="Drag this to your bookmarks bar"
            onClick={handleBookmarkletClick}
          >
            🔖 Drag to bookmarks: NodeToolbox SharePoint Relay
          </BookmarkletInstallLink>
          <p className={styles.subtitle}>
            ⚠️ Don&apos;t click it here — drag it to the bookmarks bar, then click it from the SharePoint tab.
          </p>
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
