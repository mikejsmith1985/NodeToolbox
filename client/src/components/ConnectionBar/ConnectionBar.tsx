// ConnectionBar.tsx — Compact connection status bar with interactive inline Connect panels.
//
// Each indicator is a button. Clicking it toggles an inline panel showing connection
// details and — for the relay — the bookmarklet activation workflow so users never
// have to navigate away to Admin Hub just to set up the relay bridge.

import { useState, useRef, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from 'react';

import { BookmarkletInstallLink } from '../BookmarkletInstallLink/index.tsx';
import { openSnowRelay, SNOW_RELAY_BOOKMARKLET_CODE } from '../../services/browserRelay.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import styles from './ConnectionBar.module.css';

// ── Types ──

type ActivePanel = 'jira' | 'snow' | 'relay' | null;

// ── Constants ──

// ── Sub-components ──

interface ConnectionIndicatorButtonProps {
  label: string;
  isReady: boolean;
  isExpanded: boolean;
  panelId: string;
  onClick(): void;
}

/**
 * A single connection indicator rendered as an accessible button.
 * Green dot = service ready; red dot = not connected.
 * Clicking toggles the inline detail panel.
 */
function ConnectionIndicatorButton({
  label,
  isReady,
  isExpanded,
  panelId,
  onClick,
}: ConnectionIndicatorButtonProps) {
  return (
    <button
      className={`${styles.indicatorButton} ${isReady ? styles.ready : styles.notReady}`}
      onClick={onClick}
      aria-expanded={isExpanded}
      aria-controls={panelId}
      aria-label={`${label} connection status — click for details`}
    >
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </button>
  );
}

// ── Panel sub-components ──

interface RelayPanelProps {
  isRelayActive: boolean;
  lastPingAt: string | null;
  /** The ServiceNow instance base URL from proxy config — used for the "Open ServiceNow" button. */
  snowBaseUrl: string | null;
}

/** Inline panel for the Relay indicator — shows relay status and bookmarklet activation. */
function RelayPanel({ isRelayActive, lastPingAt, snowBaseUrl }: RelayPanelProps) {
  /** Opens the ServiceNow instance in a new tab so the user can activate the relay bookmarklet. */
  function handleOpenSnowPage() {
    if (snowBaseUrl !== null && snowBaseUrl !== '') {
      const didOpenRelayTab = openSnowRelay(snowBaseUrl);
      if (!didOpenRelayTab) {
        window.alert('NodeToolbox could not open ServiceNow. Allow popups for this site, then try again.');
      }
    }
  }

  function handleBookmarkletClick(clickEvent: ReactMouseEvent<HTMLAnchorElement>) {
    clickEvent.preventDefault();
    window.alert(
      'Drag "NodeToolbox SNow Relay" to your browser bookmarks bar first. ' +
      'After ServiceNow opens, click that bookmark from the ServiceNow tab.',
    );
  }

  const lastPingText = lastPingAt !== null
    ? new Date(lastPingAt).toLocaleTimeString()
    : null;

  return (
    <div className={styles.panelContent}>
      <p className={styles.panelStatus}>
        {isRelayActive
          ? `🟢 Active${lastPingText !== null ? ` — last ping at ${lastPingText}` : ''}`
          : '🔴 Inactive — relay bridge not connected'}
      </p>

      {!isRelayActive && (
        <>
          <p className={styles.panelLabel}>To activate:</p>
          <ol className={styles.panelSteps}>
            <li>
              {snowBaseUrl !== null && snowBaseUrl !== ''
                ? <>Click <strong>Open ServiceNow</strong> below, or navigate to any SNow page while logged in</>
                : 'Navigate to any ServiceNow page while logged in'}
            </li>
            <li>Click <strong>NodeToolbox SNow Relay</strong> in your bookmarks bar</li>
            <li>The relay will activate and return focus to this tab automatically</li>
          </ol>
        </>
      )}

      <div className={styles.panelActions}>
        {!isRelayActive && snowBaseUrl !== null && snowBaseUrl !== '' && (
          <button className={styles.panelButton} onClick={handleOpenSnowPage}>
            🔗 Open ServiceNow
          </button>
        )}
        <BookmarkletInstallLink
          bookmarkletCode={SNOW_RELAY_BOOKMARKLET_CODE}
          className={styles.bookmarkletLink}
          title="Drag this to your bookmarks bar"
          onClick={handleBookmarkletClick}
        >
          🔖 Drag to bookmarks: NodeToolbox SNow Relay
        </BookmarkletInstallLink>
      </div>

      <p className={styles.panelHint}>
        ⚠️ Do not click the bookmarklet here. Drag it to the bookmarks bar, then click it from the ServiceNow tab.
      </p>
    </div>
  );
}

interface SnowPanelProps {
  isSnowActive: boolean;
  isRelayActive: boolean;
  isSnowVerified: boolean;
}

/** Inline panel for the SNow indicator — shows connection method and config hint. */
function SnowPanel({ isSnowActive, isRelayActive, isSnowVerified }: SnowPanelProps) {
  function getConnectionMethodText(): string {
    if (isRelayActive) return 'Connected via relay bookmarklet (Okta browser session)';
    if (isSnowVerified) return 'Proxy probe succeeded, but app traffic still requires relay';
    return 'Not connected';
  }

  return (
    <div className={styles.panelContent}>
      <p className={styles.panelStatus}>
        {isSnowActive ? '✅ ServiceNow reachable' : '❌ ServiceNow not reachable'}
      </p>
      <p className={styles.panelLabel}>Method: {getConnectionMethodText()}</p>
      {!isSnowActive && (
        <p className={styles.panelHint}>
          Configure Snow credentials in Admin Hub → 🔌 Service Connectivity
        </p>
      )}
    </div>
  );
}

interface JiraPanelProps {
  isJiraReady: boolean;
}

/** Inline panel for the Jira indicator — shows Jira config state. */
function JiraPanel({ isJiraReady }: JiraPanelProps) {
  return (
    <div className={styles.panelContent}>
      <p className={styles.panelStatus}>
        {isJiraReady ? '✅ Jira credentials configured' : '❌ Jira not configured'}
      </p>
    </div>
  );
}

// ── Root component ──

/**
 * Displays global Jira, SNow, and relay bridge readiness as interactive buttons.
 * Clicking an indicator opens an inline panel with connection details and —
 * for the relay — the bookmarklet activation workflow.
 */
export function ConnectionBar() {
  const isJiraReady = useConnectionStore((state) => state.isJiraReady);
  // Use the live-probe result for SNow, not just "credentials present" (isSnowReady),
  // because SNow behind Okta will reject direct calls even when configured.
  const isSnowVerified = useConnectionStore((state) => state.isSnowVerified);
  const relayBridgeStatus = useConnectionStore((state) => state.relayBridgeStatus);
  const isRelayActive = relayBridgeStatus?.isConnected ?? false;
  // The original ToolBox app treated ServiceNow as connected only after the relay pong.
  const isSnowActive = isRelayActive;
  // The SNow base URL comes from proxy config — used to provide a direct "Open" button.
  const snowBaseUrl = useConnectionStore((state) => state.proxyStatus?.snow?.baseUrl ?? null);

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /** Toggles the given panel or closes it if already open. */
  const handleIndicatorClick = useCallback((panel: ActivePanel) => {
    setActivePanel((currentPanel) => (currentPanel === panel ? null : panel));
  }, []);

  // Close the panel when the user clicks outside the connection bar.
  useEffect(() => {
    function handleDocumentClick(clickEvent: MouseEvent) {
      if (barRef.current !== null && !barRef.current.contains(clickEvent.target as Node)) {
        setActivePanel(null);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  const lastPingAt = relayBridgeStatus?.lastPingAt ?? null;

  return (
    <div ref={barRef} className={styles.connectionBarWrapper}>
      <div className={styles.connectionBar} aria-label="Connection status">
        <ConnectionIndicatorButton
          label="Jira"
          isReady={isJiraReady}
          isExpanded={activePanel === 'jira'}
          panelId="conn-panel-jira"
          onClick={() => handleIndicatorClick('jira')}
        />
        <ConnectionIndicatorButton
          label="SNow"
          isReady={isSnowActive}
          isExpanded={activePanel === 'snow'}
          panelId="conn-panel-snow"
          onClick={() => handleIndicatorClick('snow')}
        />
        <ConnectionIndicatorButton
          label="Relay"
          isReady={isRelayActive}
          isExpanded={activePanel === 'relay'}
          panelId="conn-panel-relay"
          onClick={() => handleIndicatorClick('relay')}
        />
      </div>

      {activePanel !== null && (
        <div className={styles.connectPanel} role="region" aria-label="Connection details">
          {activePanel === 'relay' && (
            <RelayPanel isRelayActive={isRelayActive} lastPingAt={lastPingAt} snowBaseUrl={snowBaseUrl} />
          )}
          {activePanel === 'snow' && (
            <SnowPanel
              isSnowActive={isSnowActive}
              isRelayActive={isRelayActive}
              isSnowVerified={isSnowVerified}
            />
          )}
          {activePanel === 'jira' && <JiraPanel isJiraReady={isJiraReady} />}
        </div>
      )}
    </div>
  );
}
