// TbxBackupRestoreSection.tsx — Export / import / reset for tbx* localStorage data.
//
// Distinct from the existing BackupSection (which targets 'toolbox-' prefixed keys).
// This section handles all keys that start with 'tbx', matching the NodeToolbox
// naming convention used by the settings store and new features.

import { useRef } from 'react';

import styles from './AdminHubView.module.css';

// ── Constants ──

/** All localStorage keys matching this prefix are included in export/reset. */
const TBX_KEY_PREFIX = 'tbx';

// ── Helpers ──

/** Collects all tbx* localStorage entries into a plain object. */
function collectTbxLocalStorageData(): Record<string, string> {
  const collectedData: Record<string, string> = {};
  for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
    const storageKey = localStorage.key(storageIndex);
    if (storageKey !== null && storageKey.startsWith(TBX_KEY_PREFIX)) {
      collectedData[storageKey] = localStorage.getItem(storageKey) ?? '';
    }
  }
  return collectedData;
}

/** Removes all tbx* keys from localStorage. */
function removeTbxLocalStorageData(): void {
  const keysToRemove: string[] = [];
  for (let storageIndex = 0; storageIndex < localStorage.length; storageIndex++) {
    const storageKey = localStorage.key(storageIndex);
    if (storageKey !== null && storageKey.startsWith(TBX_KEY_PREFIX)) {
      keysToRemove.push(storageKey);
    }
  }
  for (const keyToRemove of keysToRemove) {
    localStorage.removeItem(keyToRemove);
  }
}

/** Triggers a JSON file download with the given filename and content. */
function triggerJsonDownload(filename: string, jsonString: string): void {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchorElement = document.createElement('a');
  anchorElement.href = downloadUrl;
  anchorElement.download = filename;
  anchorElement.click();
  URL.revokeObjectURL(downloadUrl);
}

// ── Main component ──

/** Backup / Restore Settings section — export, import, or reset all tbx* localStorage data. */
export default function TbxBackupRestoreSection() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExportSettings() {
    const exportData = collectTbxLocalStorageData();
    const jsonString = JSON.stringify(exportData, null, 2);
    const dateString = new Date().toISOString().slice(0, 10);
    triggerJsonDownload(`nodetoolbox-backup-${dateString}.json`, jsonString);
  }

  function handleImportFileChange(changeEvent: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = changeEvent.target.files?.[0];
    if (!selectedFile) return;

    const fileReader = new FileReader();
    fileReader.onload = (loadEvent) => {
      try {
        const rawText = loadEvent.target?.result as string;
        const parsedData = JSON.parse(rawText) as unknown;

        if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
          alert('Import failed: backup file must be a plain JSON object.');
          return;
        }

        // Only restore keys matching the tbx* prefix to avoid polluting localStorage.
        for (const [restoreKey, restoreValue] of Object.entries(
          parsedData as Record<string, unknown>,
        )) {
          if (restoreKey.startsWith(TBX_KEY_PREFIX) && typeof restoreValue === 'string') {
            localStorage.setItem(restoreKey, restoreValue);
          }
        }

        window.location.reload();
      } catch {
        alert('Import failed: invalid or corrupted backup file.');
      }
    };

    fileReader.onerror = () => {
      alert('Import failed: could not read the selected file.');
    };

    fileReader.readAsText(selectedFile);
    // Reset the input so the same file can be re-selected if the import fails.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleResetAllData() {
    const isUserConfirmed = window.confirm(
      'Clear all NodeToolbox data? This removes all tbx* localStorage keys and cannot be undone.',
    );
    if (!isUserConfirmed) return;

    removeTbxLocalStorageData();
    window.location.reload();
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>💾 Backup / Restore Settings</h2>
      <p className={styles.adminDescription}>
        Export all NodeToolbox configuration to a JSON file, or import a previously saved backup.
        Reset All Data removes every <code>tbx*</code> localStorage key — use with caution.
      </p>

      <div className={styles.devUtilitiesRow}>
        <button className={styles.actionButton} onClick={handleExportSettings}>
          ⬇ Export Settings
        </button>

        {/* Hidden file input triggered by the Import Settings button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className={styles.fileInputHidden}
          onChange={handleImportFileChange}
          aria-hidden="true"
        />
        <button
          className={styles.actionButton}
          onClick={() => fileInputRef.current?.click()}
        >
          ⬆ Import Settings
        </button>

        <button
          className={`${styles.actionButton} ${styles.dangerButton}`}
          onClick={handleResetAllData}
        >
          🗑 Reset All Data
        </button>
      </div>
    </section>
  );
}
