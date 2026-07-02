// SharePointDiagnostics.tsx — A one-click relay diagnostic that runs three escalating SharePoint
// read probes (auth → list → fields) and explains a 403 in plain English, so a permissions/policy
// issue can be told apart from a Toolbox bug without pasting console snippets.

import { useState } from 'react';

import { interpretSharePointProbes, probeSharePoint, type SharePointProbe } from '../../../services/sharepointIntakeApi.ts';
import styles from '../JiraIntake.module.css';

interface SharePointDiagnosticsProps {
  siteRelativeUrl: string;
  listName: string;
  isConnected: boolean;
}

/** Collapsible relay diagnostics for the SharePoint intake pull. */
export default function SharePointDiagnostics({ siteRelativeUrl, listName, isConnected }: SharePointDiagnosticsProps) {
  const [results, setResults] = useState<SharePointProbe[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function handleRun() {
    setIsRunning(true);
    try {
      setResults(await probeSharePoint(siteRelativeUrl, listName));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <details className={styles.diagnostics}>
      <summary>🩺 SharePoint relay diagnostics</summary>
      <p className={styles.subtitle}>
        Runs three read checks through the relay (auth → list permission → field schema) to localize a
        403. Connect the relay from the Connection Bar first.
      </p>
      <button
        className={styles.secondaryButton}
        disabled={!isConnected || isRunning}
        onClick={() => void handleRun()}
        type="button"
      >
        {isRunning ? 'Running…' : 'Run diagnostics'}
      </button>

      {results !== null && (
        <>
          <ul className={styles.diagList}>
            {results.map((probe) => (
              <li key={probe.label}>
                <strong>{probe.ok ? '✅' : '❌'} {probe.label}</strong>
                {' — '}
                {probe.ok ? probe.detail : `${probe.status || 'error'}: ${probe.detail}`}
              </li>
            ))}
          </ul>
          <p className={styles.diagConclusion}>{interpretSharePointProbes(results)}</p>
        </>
      )}
    </details>
  );
}
