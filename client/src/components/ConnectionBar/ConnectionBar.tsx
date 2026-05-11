// ConnectionBar.tsx — Compact connection status bar with interactive inline Connect panels.
//
// Each indicator is a button. Clicking it toggles an inline panel showing connection
// details and — for the relay — the bookmarklet activation workflow so users never
// have to navigate away to Admin Hub just to set up the relay bridge.

import { useState, useRef, useEffect, useCallback } from 'react';

import { useConnectionStore } from '../../store/connectionStore.ts';
import styles from './ConnectionBar.module.css';

// ── Types ──

type ActivePanel = 'jira' | 'snow' | 'relay' | null;

// ── Constants ──

/**
 * The SNow relay bookmarklet code.
 * Drag the rendered link to the browser bookmarks bar, then click it on any
 * authenticated ServiceNow page to activate the relay bridge.
 */
const SNOW_RELAY_BOOKMARKLET_CODE = [
  "javascript:(function(){",
  "const S='http://localhost:5555';",
  "const Y='snow';",
  "let run=true;",
  "function reg(){return fetch(S+'/api/relay-bridge/register?sys='+Y,{method:'POST'});}",
  "async function loop(){",
  "await reg();",
  "console.log('[NodeToolbox] SNow relay active');",
  "while(run){",
  "try{",
  "const r=await fetch(S+'/api/relay-bridge/poll?sys='+Y);",
  "const d=await r.json();",
  "if(d&&d.request){",
  "const q=d.request;",
  "try{",
  "const u=window.location.origin+q.path;",
  "const h={'Content-Type':'application/json'};",
  "if(q.authHeader)h['Authorization']=q.authHeader;",
  "const a=await fetch(u,{method:q.method||'GET',headers:h,body:q.body?JSON.stringify(q.body):undefined,credentials:'include'});",
  "const b=await a.text();",
  "await fetch(S+'/api/relay-bridge/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q.id,sys:Y,ok:a.ok,status:a.status,data:b,error:null})});",
  "}catch(e){",
  "await fetch(S+'/api/relay-bridge/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:q.id,sys:Y,ok:false,status:0,data:null,error:e.message})});",
  "}}}catch(e){await new Promise(r=>setTimeout(r,2000));}}",
  "}",
  "window.addEventListener('beforeunload',function(){",
  "run=false;",
  "navigator.sendBeacon(S+'/api/relay-bridge/deregister?sys='+Y);",
  "});",
  "loop();",
  "})();",
].join('');

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
}

/** Inline panel for the Relay indicator — shows relay status and bookmarklet activation. */
function RelayPanel({ isRelayActive, lastPingAt }: RelayPanelProps) {
  const [isCopied, setIsCopied] = useState(false);

  function handleCopyBookmarklet() {
    navigator.clipboard.writeText(SNOW_RELAY_BOOKMARKLET_CODE).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
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
            <li>Drag the bookmark button below to your browser toolbar</li>
            <li>Open any ServiceNow page while logged in</li>
            <li>Click <strong>NodeToolbox SNow Relay</strong> in your toolbar</li>
            <li>This indicator will turn green automatically</li>
          </ol>
        </>
      )}

      <div className={styles.panelActions}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a
          href={SNOW_RELAY_BOOKMARKLET_CODE}
          className={styles.bookmarkletLink}
          draggable
          title="Drag to bookmarks bar"
          onClick={(e) => e.preventDefault()}
        >
          🔖 NodeToolbox SNow Relay
        </a>
        <button className={styles.panelButton} onClick={handleCopyBookmarklet}>
          {isCopied ? '✓ Copied' : '📋 Copy Code'}
        </button>
      </div>

      <p className={styles.panelHint}>
        ⚠️ Bookmark bar must be visible (Ctrl+Shift+B). Relay resets on tab close or server restart.
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
    if (isSnowVerified) return 'Direct API probe succeeded';
    if (isRelayActive) return 'Connected via relay bridge (Okta session)';
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
  // SNow is reachable either via direct verified connection or via an active relay bookmarklet.
  const isSnowActive = isSnowVerified || isRelayActive;

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
            <RelayPanel isRelayActive={isRelayActive} lastPingAt={lastPingAt} />
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
