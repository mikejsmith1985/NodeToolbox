// ConnectionBar.tsx — Compact connection status bar with interactive inline connect panels.
//
// Each indicator button represents one connected service. Clicking it toggles an inline
// detail panel. The SNow panel includes the relay bookmarklet activation workflow so
// users never need to navigate away to Admin Hub just to set up the relay bridge.
//
// Service readiness is driven by the Zustand connectionStore, which is updated from
// GET /api/proxy-status on every server health check.

import { useState, useRef, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from 'react';

import { BookmarkletInstallLink } from '../BookmarkletInstallLink/index.tsx';
import { openSnowRelay, SNOW_RELAY_BOOKMARKLET_CODE } from '../../services/browserRelay.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import styles from './ConnectionBar.module.css';

// ── Types ──

type ActivePanel = 'jira' | 'snow' | 'confluence' | 'github' | null;

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
 * Green dot = service ready; red dot = not connected or not configured.
 * Clicking toggles the inline detail panel for that service.
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

interface SnowPanelProps {
  isSnowActive: boolean;
  isRelayActive: boolean;
  isSnowVerified: boolean;
  /** The ServiceNow instance base URL from proxy config — used to provide an "Open ServiceNow" button. */
  snowBaseUrl: string | null;
  lastPingAt: string | null;
  /** True once the bookmarklet has detected ServiceNow's g_ck token for write APIs. */
  hasSessionToken: boolean;
}

/**
 * Inline panel for the SNow indicator.
 * When the relay is active, shows the connection status and last ping time.
 * When the relay is inactive, shows the full bookmarklet activation workflow
 * (including an "Open ServiceNow" shortcut) so users can set up the relay bridge
 * without leaving NodeToolbox.
 */
function SnowPanel({
  isSnowActive,
  isRelayActive,
  isSnowVerified,
  snowBaseUrl,
  lastPingAt,
  hasSessionToken,
}: SnowPanelProps) {
  const lastPingText = lastPingAt !== null
    ? new Date(lastPingAt).toLocaleTimeString()
    : null;

  /** Opens the ServiceNow instance in a named relay tab so the bookmarklet can activate. */
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

  function getConnectionMethodText(): string {
    if (isRelayActive) return 'Connected via relay bookmarklet (Okta browser session)';
    if (isSnowVerified) return 'Proxy probe succeeded, but app traffic still requires relay';
    return 'Not connected — relay bridge inactive';
  }

  return (
    <div className={styles.panelContent}>
      <p className={styles.panelStatus}>
        {isSnowActive
          ? `✅ ServiceNow reachable${lastPingText !== null ? ` — last relay ping at ${lastPingText}` : ''}`
          : '❌ ServiceNow not reachable'}
      </p>
      <p className={styles.panelLabel}>Method: {getConnectionMethodText()}</p>
      {isRelayActive && !hasSessionToken ? (
        <p className={styles.panelWarning} role="alert">
          ⚠ Relay is connected, but the ServiceNow session token is not ready yet. Wait for the SNow page to finish
          loading, then click the latest NodeToolbox SNow Relay bookmarklet again.
        </p>
      ) : null}

      {!isRelayActive && (
        <>
          <p className={styles.panelLabel}>To activate the relay bridge:</p>
          <ol className={styles.panelSteps}>
            <li>
              {snowBaseUrl !== null && snowBaseUrl !== ''
                ? <>Click <strong>Open ServiceNow</strong> below, or navigate to any SNow page while logged in</>
                : 'Navigate to any ServiceNow page while logged in'}
            </li>
            <li>Click <strong>NodeToolbox SNow Relay</strong> in your bookmarks bar</li>
            <li>The relay will activate and return focus to this tab automatically</li>
          </ol>

          <div className={styles.panelActions}>
            {snowBaseUrl !== null && snowBaseUrl !== '' && (
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
        </>
      )}
    </div>
  );
}

interface ConfluencePanelProps {
  isConfluenceReady: boolean;
  /** The Confluence Cloud base URL from proxy config — used to provide an "Open Confluence" button. */
  confluenceBaseUrl: string | null;
}

/**
 * Inline panel for the Confluence indicator.
 * Shows whether Confluence credentials are configured and provides a direct
 * link to open the Confluence site. Confluence Cloud connects via Basic Auth
 * (no relay required).
 */
function ConfluencePanel({ isConfluenceReady, confluenceBaseUrl }: ConfluencePanelProps) {
  function handleOpenConfluence() {
    if (confluenceBaseUrl !== null && confluenceBaseUrl !== '') {
      window.open(confluenceBaseUrl, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className={styles.panelContent}>
      <p className={styles.panelStatus}>
        {isConfluenceReady ? '✅ Confluence credentials configured' : '❌ Confluence not configured'}
      </p>

      {isConfluenceReady && confluenceBaseUrl !== null && confluenceBaseUrl !== '' && (
        <div className={styles.panelActions}>
          <button className={styles.panelButton} onClick={handleOpenConfluence}>
            🔗 Open Confluence
          </button>
        </div>
      )}

      {!isConfluenceReady && (
        <p className={styles.panelHint}>
          Configure Confluence credentials in Admin Hub → ⚙️ Config → 🔌 Service Connectivity
        </p>
      )}
    </div>
  );
}

interface GitHubPanelProps {
  isGitHubReady: boolean;
}

/**
 * Inline panel for the GitHub indicator.
 * Shows whether a GitHub PAT is configured. GitHub connects directly via REST API.
 */
function GitHubPanel({ isGitHubReady }: GitHubPanelProps) {
  return (
    <div className={styles.panelContent}>
      <p className={styles.panelStatus}>
        {isGitHubReady ? '✅ GitHub PAT configured' : '❌ GitHub not configured'}
      </p>
      {!isGitHubReady && (
        <p className={styles.panelHint}>
          Configure a GitHub Personal Access Token in Admin Hub → ⚙️ Config → 🔌 Service Connectivity
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
      {!isJiraReady && (
        <p className={styles.panelHint}>
          Configure Jira credentials in Admin Hub → ⚙️ Config → Proxy & Server Setup
        </p>
      )}
    </div>
  );
}

// ── Root component ──

/**
 * Displays global Jira, SNow, Confluence, and GitHub readiness as interactive buttons.
 * Clicking an indicator opens an inline panel with connection details.
 * The SNow panel includes the full relay bookmarklet activation workflow.
 *
 * Service readiness is driven by the Zustand connectionStore — no direct API calls
 * are made here; the store is updated by the proxy-status health check in the app root.
 */
export function ConnectionBar() {
  const isJiraReady = useConnectionStore((state) => state.isJiraReady);
  const isSnowVerified = useConnectionStore((state) => state.isSnowVerified);
  const relayBridgeStatus = useConnectionStore((state) => state.relayBridgeStatus);
  const isRelayActive = relayBridgeStatus?.isConnected ?? false;
  // SNow is treated as active only after the relay bridge handshake — a successful
  // direct proxy probe is insufficient because SNow traffic goes through the browser relay.
  const isSnowActive = isRelayActive;
  const snowBaseUrl = useConnectionStore((state) => state.proxyStatus?.snow?.baseUrl ?? null);
  const isConfluenceReady = useConnectionStore((state) => state.isConfluenceReady);
  const confluenceBaseUrl = useConnectionStore((state) => state.proxyStatus?.confluence?.baseUrl ?? null);
  const isGitHubReady = useConnectionStore((state) => state.isGitHubReady);
  const lastPingAt = relayBridgeStatus?.lastPingAt ?? null;
  const hasSessionToken = relayBridgeStatus?.hasSessionToken ?? false;

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /** Toggles the given panel open, or closes it if it is already the active panel. */
  const handleIndicatorClick = useCallback((panel: ActivePanel) => {
    setActivePanel((currentPanel) => (currentPanel === panel ? null : panel));
  }, []);

  // Close the panel when the user clicks anywhere outside the connection bar.
  useEffect(() => {
    function handleDocumentClick(clickEvent: MouseEvent) {
      if (barRef.current !== null && !barRef.current.contains(clickEvent.target as Node)) {
        setActivePanel(null);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

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
          label="Confluence"
          isReady={isConfluenceReady}
          isExpanded={activePanel === 'confluence'}
          panelId="conn-panel-confluence"
          onClick={() => handleIndicatorClick('confluence')}
        />
        <ConnectionIndicatorButton
          label="GitHub"
          isReady={isGitHubReady}
          isExpanded={activePanel === 'github'}
          panelId="conn-panel-github"
          onClick={() => handleIndicatorClick('github')}
        />
      </div>

      {activePanel !== null && (
        <div className={styles.connectPanel} role="region" aria-label="Connection details">
          {activePanel === 'jira' && <JiraPanel isJiraReady={isJiraReady} />}
          {activePanel === 'snow' && (
            <SnowPanel
              isSnowActive={isSnowActive}
              isRelayActive={isRelayActive}
              isSnowVerified={isSnowVerified}
              snowBaseUrl={snowBaseUrl}
              lastPingAt={lastPingAt}
              hasSessionToken={hasSessionToken}
            />
          )}
          {activePanel === 'confluence' && (
            <ConfluencePanel
              isConfluenceReady={isConfluenceReady}
              confluenceBaseUrl={confluenceBaseUrl}
            />
          )}
          {activePanel === 'github' && <GitHubPanel isGitHubReady={isGitHubReady} />}
        </div>
      )}
    </div>
  );
}
