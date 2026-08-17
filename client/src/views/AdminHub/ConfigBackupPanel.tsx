// ConfigBackupPanel.tsx — Taking this app's settings out to a file, and putting them back.
//
// Everything NodeToolbox knows about a Jira instance — board columns, checklist mappings, team
// profiles, scope choices, field pins — lives in this browser and nowhere else. A cleared browser, a
// new laptop or a new Jira and it is all gone, or all re-entered by hand.
//
// So: one file out, one file in. It is a backup today; it is also how a re-point at a different Jira
// starts from what the team already agreed rather than from a blank page.
//
// A restore says what it would change BEFORE it changes anything. These settings took months to
// arrive at, and nobody should learn they were overwritten by noticing their board look wrong.

import { useRef, useState } from 'react';

import {
  applyConfigRestore,
  buildBackupFileName,
  buildConfigBackup,
  describeBackupProblem,
  describeRestorePlan,
  planConfigRestore,
  type ConfigBackup,
  type ConfigChange,
} from '../../services/configBackup.ts';
import styles from './AdminHubView.module.css';

/** The app version stamped into a backup, for when a restore behaves oddly a year from now. */
const APP_VERSION = String(import.meta.env?.VITE_APP_VERSION ?? 'unknown');

/** Downloads the backup as a file, without asking a server to do it. */
function downloadBackup(backup: ConfigBackup): void {
  const fileBlob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(fileBlob);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = buildBackupFileName(backup.exportedAt);
  downloadLink.click();
  URL.revokeObjectURL(objectUrl);
}

/** Backs up and restores every setting this app owns. */
export function ConfigBackupPanel(): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // Held between choosing a file and confirming it: nothing is written until somebody has read the
  // plan and pressed the second button.
  const [pendingBackup, setPendingBackup] = useState<ConfigBackup | null>(null);
  const [pendingChanges, setPendingChanges] = useState<ConfigChange[]>([]);

  function handleExport(): void {
    setErrorMessage('');
    const backup = buildConfigBackup(window.localStorage, APP_VERSION, new Date().toISOString());
    const settingCount = Object.keys(backup.entries).length;
    downloadBackup(backup);
    setStatusMessage(`Saved ${settingCount} settings. The admin passphrase and the unlock flags are `
      + 'deliberately not in the file.');
  }

  async function handleFileChosen(chosenFile: File | undefined): Promise<void> {
    setStatusMessage('');
    setErrorMessage('');
    setPendingBackup(null);
    if (chosenFile === undefined) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await chosenFile.text());
    } catch (parseError: unknown) {
      setErrorMessage(`That file is not readable JSON: ${String(parseError)}`);
      return;
    }

    const problem = describeBackupProblem(parsed);
    if (problem !== null) {
      setErrorMessage(problem);
      return;
    }

    const backup = parsed as ConfigBackup;
    setPendingBackup(backup);
    setPendingChanges(planConfigRestore(window.localStorage, backup));
  }

  function handleConfirmRestore(): void {
    if (pendingBackup === null) return;
    const appliedCount = applyConfigRestore(window.localStorage, pendingBackup);
    setPendingBackup(null);
    setPendingChanges([]);
    // Reload rather than claim success: every store read its settings once, at startup, and would go
    // on showing the old ones until something happened to re-read them.
    setStatusMessage(`Restored ${appliedCount} settings. Reloading so every screen picks them up…`);
    window.setTimeout(() => window.location.reload(), 1200);
  }

  const replacedChanges = pendingChanges.filter((change) => change.kind === 'replaced');

  return (
    <div className={styles.panelCard} data-testid="config-backup-panel">
      <h3 className={styles.sectionTitle}>Settings backup</h3>
      <p className={styles.fieldLabel}>
        Everything this app knows about your Jira — board columns, checklist mappings, team profiles,
        scope choices, field pins — lives in this browser and nowhere else. Save it to a file, and put
        it back on another machine, after a cleared browser, or when pointing at a different Jira.
      </p>

      <div className={styles.panelSection}>
        <button className={styles.actionButton} onClick={handleExport} type="button">
          Save my settings to a file
        </button>

        <button
          className={styles.actionButton}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          Restore from a file…
        </button>

        <input
          accept="application/json,.json"
          aria-label="Settings backup file"
          hidden
          onChange={(changeEvent) => void handleFileChosen(changeEvent.target.files?.[0])}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {statusMessage !== '' && <p className={styles.panelStatusLine}>{statusMessage}</p>}
      {errorMessage !== '' && <p className={styles.panelStatusLine}>{errorMessage}</p>}

      {pendingBackup !== null && (
        <div className={styles.panelSection}>
          <p className={styles.fieldLabel}>
            From {pendingBackup.exportedAt.slice(0, 10)} (NodeToolbox {pendingBackup.appVersion}).{' '}
            <strong>{describeRestorePlan(pendingChanges)}</strong>
          </p>

          {/* The replacements named, not just counted. A number is enough to worry somebody and not
              enough to let them decide. */}
          {replacedChanges.length > 0 && (
            <ul>
              {replacedChanges.map((change) => <li key={change.storageKey}>{change.storageKey}</li>)}
            </ul>
          )}

          <button className={styles.dangerButton} onClick={handleConfirmRestore} type="button">
            Replace my settings with this file
          </button>
          <button
            className={styles.actionButton}
            onClick={() => { setPendingBackup(null); setPendingChanges([]); }}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
