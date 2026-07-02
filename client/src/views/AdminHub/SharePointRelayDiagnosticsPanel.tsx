// SharePointRelayDiagnosticsPanel.tsx — Admin Hub Dev Panel section that diagnoses a SharePoint
// intake relay 403. Runs three escalating read probes through the relay (auth → list permission →
// field schema) and shows each status plus a plain-English conclusion, so a SharePoint
// permissions/policy issue can be told apart from a Toolbox bug. Self-sourcing: it reads the site
// URL + list name from the shared bridge (set by Jira Intake settings) and the relay connection
// from the connection store — no intake config load needed.

import { useState } from 'react';

import { interpretSharePointProbes, probeSharePoint, type SharePointProbe } from '../../services/sharepointIntakeApi.ts';
import { readSharePointListName, readSharePointSiteUrl } from '../../services/sharePointSiteUrl.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import styles from './AdminHubView.module.css';

/** SharePoint relay diagnostics — a Dev Panel troubleshooting card for the intake pull. */
export default function SharePointRelayDiagnosticsPanel() {
  const [results, setResults] = useState<SharePointProbe[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const isConnected = useConnectionStore((storeState) => storeState.relayStatusBySystem?.sharepoint?.isConnected ?? false);

  const siteUrl = readSharePointSiteUrl();
  const listName = readSharePointListName();
  const isConfigured = siteUrl !== null && listName !== null;

  async function handleRun() {
    if (siteUrl === null || listName === null) {
      return;
    }
    setIsRunning(true);
    try {
      setResults(await probeSharePoint(siteUrl, listName));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>🩺 SharePoint Relay Diagnostics</h2>
      <p className={styles.adminDescription}>
        Runs three read checks through the relay (signed-in user → list read → list fields) to
        localize a SharePoint 403. Save the SharePoint site + list in <strong>Jira Intake</strong>
        settings and connect the relay from the Connection Bar first.
      </p>

      {!isConfigured && (
        <p className={styles.sectionErrorText}>
          No SharePoint site/list configured. Set a full site URL and list name in Jira Intake settings.
        </p>
      )}

      <div className={styles.devUtilitiesRow}>
        <button
          className={styles.actionButton}
          disabled={!isConfigured || !isConnected || isRunning}
          onClick={() => void handleRun()}
        >
          {isRunning ? '⏳ Running…' : '🔍 Run SharePoint Diagnostics'}
        </button>
        {isConfigured && !isConnected && (
          <span className={styles.adminDescription}>Relay not connected — connect it from the Connection Bar.</span>
        )}
      </div>

      {results !== null && (
        <>
          <div className={styles.diagnosticsGrid}>
            {results.map((probe) => (
              <div className={styles.diagnosticsRow} key={probe.label}>
                <span className={styles.diagnosticsLabel}>{probe.ok ? '✅' : '❌'} {probe.label}</span>
                <span className={styles.diagnosticsValue}>
                  {probe.ok ? probe.detail : `${probe.status || 'error'}: ${probe.detail}`}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.adminDescription}><strong>{interpretSharePointProbes(results)}</strong></p>
        </>
      )}
    </section>
  );
}
