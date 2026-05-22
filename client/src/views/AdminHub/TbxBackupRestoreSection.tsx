// TbxBackupRestoreSection.tsx — Export / import / reset for durable NodeToolbox localStorage settings.
//
// Distinct from the existing BackupSection (which targets older toolbox-prefixed data).
// This section covers the modern settings store plus legacy persistent keys that still
// power a few tools, so updates do not silently drop saved configuration.

import { useRef, useState } from 'react';

import ConfirmDialog from '../../components/ConfirmDialog/index.tsx';
import { useToast } from '../../components/Toast/ToastContext.ts';
import {
  collectPersistentSettingsLocalStorageData,
  removePersistentSettingsLocalStorageData,
  restorePersistentSettingsLocalStorageData,
} from '../../utils/persistentSettingsStorage.ts';
import {
  createDemoModeUrl,
  disableDemoModeForCurrentTab,
  isDemoModeEnabled,
} from '../../utils/demoModeStorage.ts';
import styles from './AdminHubView.module.css';

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

/** Backup / Restore Settings section — export, import, or reset all durable local settings. */
export default function TbxBackupRestoreSection() {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isDemoModeActive, setIsDemoModeActive] = useState(() => isDemoModeEnabled());

  function handleExportSettings() {
    const exportData = collectPersistentSettingsLocalStorageData();
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
          showToast('Import failed: backup file must be a plain JSON object.', 'error');
          return;
        }

        restorePersistentSettingsLocalStorageData(parsedData as Record<string, unknown>);

        window.location.reload();
      } catch {
        showToast('Import failed: invalid or corrupted backup file.', 'error');
      }
    };

    fileReader.onerror = () => {
      showToast('Import failed: could not read the selected file.', 'error');
    };

    fileReader.readAsText(selectedFile);
    // Reset the input so the same file can be re-selected if the import fails.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleConfirmResetAllData() {
    setIsResetDialogOpen(false);
    removePersistentSettingsLocalStorageData();
    window.location.reload();
  }

  function handleOpenDemoMode() {
    if (isDemoModeActive) {
      disableDemoModeForCurrentTab();
      setIsDemoModeActive(false);
      showToast('Demo mode ended. Reloading your regular settings.', 'success');
      window.location.reload();
      return;
    }

    const firstInstallDemoUrl = createDemoModeUrl(new URL('/setup', window.location.href).toString());
    const demoModeWindow = window.open(firstInstallDemoUrl, '_blank', 'noopener');
    if (demoModeWindow) {
      showToast('Opening a first-install demo in a new tab. Your saved settings stay untouched.', 'success');
    } else {
      showToast('Demo tab was blocked by the browser. Allow pop-ups or open the current URL with ?demo=1.', 'error');
    }
  }

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>💾 Backup / Restore Settings</h2>
      <p className={styles.adminDescription}>
        Export all NodeToolbox configuration to a JSON file, or import a previously saved backup.
        Reset All Data removes every durable local setting, including older keys that some tools
        still use behind the scenes.
      </p>

      <div className={styles.devUtilitiesRow}>
        <button className={styles.actionButton} onClick={handleOpenDemoMode}>
          {isDemoModeActive ? '🛑 Exit Demo Mode' : '🎬 Open First-Install Demo'}
        </button>

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
          onClick={() => setIsResetDialogOpen(true)}
        >
          🗑 Reset All Data
        </button>
      </div>

      {isResetDialogOpen && (
        <ConfirmDialog
          confirmLabel="Reset All Data"
          isDangerous
          message="Clear all saved NodeToolbox settings? This removes every durable localStorage setting and cannot be undone."
          onCancel={() => setIsResetDialogOpen(false)}
          onConfirm={handleConfirmResetAllData}
        />
      )}
    </section>
  );
}
