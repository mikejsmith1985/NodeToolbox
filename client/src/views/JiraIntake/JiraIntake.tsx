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
  const { createFromSubmission, createAllNew } = useCreateFromSubmission({ config, recordProcessed });

  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const hasProject = Boolean(config && config.projectKey.trim() !== '');
  const isReviewMode = Boolean(config && !config.autoCreateOnImport);
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
    // Auto-create only when configured and a project is set; otherwise rows wait for review.
    if (config?.autoCreateOnImport && hasProject && newEntries.length > 0) {
      const created = await createAllNew(newEntries);
      created.forEach(updateEntry);
    }
  }

  // Review-and-pick: create one submission on demand, reflecting progress in the queue.
  async function handleCreateEntry(entry: QueueEntry): Promise<void> {
    updateEntry({ ...entry, state: 'creating' });
    updateEntry(await createFromSubmission(entry));
  }

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
              {config?.projectKey} · {config?.autoCreateOnImport ? 'auto-create on import' : 'review and pick'}
            </h2>
            <button className={styles.secondaryButton} onClick={() => setIsEditingSettings(true)} type="button">
              Edit settings
            </button>
          </div>
        </section>
      )}

      <section className={styles.panel} aria-label="Import submissions">
        <h2 className={styles.panelTitle}>Import submissions</h2>
        {!hasProject && (
          <p className={styles.subtitle}>Set a target project above to create issues from imported rows.</p>
        )}
        <SubmissionDropzone onFile={(file) => { void handleFile(file); }} errorMessage={queueError} />
      </section>

      <section className={styles.panel} aria-label="Intake queue">
        <IntakeQueue
          entries={entries}
          counts={counts}
          isReviewMode={isReviewMode}
          onCreate={(entry) => { void handleCreateEntry(entry); }}
          onDismiss={(entry) => dismissEntry(entry.submission.id)}
        />
      </section>
    </div>
  );
}
