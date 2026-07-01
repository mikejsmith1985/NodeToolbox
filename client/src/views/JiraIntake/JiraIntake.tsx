// JiraIntake.tsx — Teams→Jira intake importer. Drop the exported Excel/CSV, see the parsed queue,
// and create Jira issues from it. Mapping is by convention (issue type + priority come from each
// row); the only setting is the target project. On import, when auto-create is on, each new row
// becomes an issue with the reporter set to the submitter (integration-account fallback). Spec 005.

import { useState } from 'react';

import IntakeConfigPanel from './components/IntakeConfigPanel.tsx';
import IntakeQueue from './components/IntakeQueue.tsx';
import SubmissionDropzone from './components/SubmissionDropzone.tsx';
import { useCreateFromSubmission } from './hooks/useCreateFromSubmission.ts';
import { useIntakeConfig } from './hooks/useIntakeConfig.ts';
import { useIntakeQueue } from './hooks/useIntakeQueue.ts';
import styles from './JiraIntake.module.css';
import type { IntakeConfig, QueueEntry } from './lib/intakeTypes.ts';

/** The Jira Intake view: set the project once, then import submission files and create issues. */
export default function JiraIntake() {
  const { config, ledger, isLoading, errorMessage: configError, saveConfig, recordProcessed } = useIntakeConfig();
  const { entries, counts, ingestFile, updateEntry, dismissEntry, errorMessage: queueError } = useIntakeQueue(ledger);
  const { createFromSubmission, createAllNew, reconcileExisting } = useCreateFromSubmission({ config, recordProcessed });

  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isConfigured = Boolean(config);
  const shouldShowSettings = isEditingSettings || !config;

  async function handleSaveConfig(nextConfig: IntakeConfig): Promise<void> {
    setIsSaving(true);
    try {
      await saveConfig(nextConfig);
      setIsEditingSettings(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFile(file: File): Promise<void> {
    const newEntries = await ingestFile(file);
    if (newEntries.length === 0) {
      return;
    }
    // Dedup pre-scan: mark rows whose issue already exists in Jira as Imported before any create,
    // so re-imports never create duplicates even if the local ledger was reset (feature 006).
    let reconciled = newEntries;
    if (isConfigured) {
      reconciled = await reconcileExisting(newEntries);
      reconciled.forEach(updateEntry);
    }
    // Auto-create only when configured; otherwise the remaining new rows wait for a manual Create.
    if (config?.autoCreateOnImport && isConfigured) {
      const created = await createAllNew(reconciled);
      created.forEach(updateEntry);
    }
  }

  // Create one submission on demand (manual create / retry), reflecting progress in the queue.
  async function handleCreateEntry(entry: QueueEntry): Promise<void> {
    updateEntry({ ...entry, state: 'creating' });
    updateEntry(await createFromSubmission(entry));
  }

  // Manual bulk create of every row still waiting (new or previously failed).
  async function handleCreateAll(): Promise<void> {
    const pending = entries.filter((entry) => entry.state === 'new' || entry.state === 'failed');
    const created = await createAllNew(pending.map((entry) => ({ ...entry, state: 'new' as const })));
    created.forEach(updateEntry);
  }

  const pendingCount = entries.filter((entry) => entry.state === 'new' || entry.state === 'failed').length;

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Jira Intake</h1>
        <p className={styles.subtitle}>
          Import Teams request submissions and turn them into Jira issues.
        </p>
      </header>

      {isLoading && <p className={styles.subtitle}>Loading intake settings…</p>}
      {configError && <p className={styles.dropzoneError} role="alert">{configError}</p>}

      {shouldShowSettings ? (
        <IntakeConfigPanel
          initialConfig={config}
          artProjectKeys={config ? [config.projectKey] : []}
          onSave={handleSaveConfig}
          isSaving={isSaving}
        />
      ) : (
        <section className={styles.panel} aria-label="Intake settings summary">
          <div className={styles.header}>
            <h2 className={styles.panelTitle}>
              {config?.projectKey ? `Default ${config.projectKey}` : 'Routed by project mapping'}
              {' · '}
              {config?.autoCreateOnImport ? 'auto-create on import' : 'review and pick'}
            </h2>
            <button className={styles.secondaryButton} onClick={() => setIsEditingSettings(true)} type="button">
              Edit settings
            </button>
          </div>
        </section>
      )}

      <section className={styles.panel} aria-label="Import submissions">
        <h2 className={styles.panelTitle}>Import submissions</h2>
        {!isConfigured && (
          <p className={styles.subtitle}>Save intake settings above to create issues from imported rows.</p>
        )}
        <SubmissionDropzone onFile={(file) => { void handleFile(file); }} errorMessage={queueError} />
      </section>

      <section className={styles.panel} aria-label="Intake queue">
        <div className={styles.header}>
          <h2 className={styles.panelTitle}>Intake queue</h2>
          {pendingCount > 0 && (
            <button
              className={styles.primaryButton}
              disabled={!isConfigured}
              onClick={() => { void handleCreateAll(); }}
              type="button"
            >
              {isConfigured ? `Create ${pendingCount} issue${pendingCount === 1 ? '' : 's'} in Jira` : 'Save settings to create'}
            </button>
          )}
        </div>
        <IntakeQueue
          entries={entries}
          counts={counts}
          onCreate={(entry) => { void handleCreateEntry(entry); }}
          onDismiss={(entry) => dismissEntry(entry.submission.id)}
        />
      </section>
    </div>
  );
}
