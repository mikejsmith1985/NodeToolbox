// JiraIntake.tsx — Teams→Jira intake importer. Wires the configuration panel, the drag-and-drop
// dropzone, and the intake queue: on import, when auto-create is on, each new submission becomes a
// Jira issue with the reporter set to the submitter (integration-account fallback). See spec 005.

import { useEffect, useMemo, useState } from 'react';

import { useJiraCreateMeta } from '../JiraTemplateMaker/hooks/useJiraCreateMeta.ts';
import IntakeConfigPanel from './components/IntakeConfigPanel.tsx';
import IntakeQueue from './components/IntakeQueue.tsx';
import SubmissionDropzone from './components/SubmissionDropzone.tsx';
import { useCreateFromSubmission } from './hooks/useCreateFromSubmission.ts';
import { useIntakeConfig } from './hooks/useIntakeConfig.ts';
import { useIntakeQueue } from './hooks/useIntakeQueue.ts';
import styles from './JiraIntake.module.css';
import type { IntakeConfig } from './lib/intakeTypes.ts';

/** The Jira Intake view: configure once, then import submission files and create issues. */
export default function JiraIntake() {
  const { config, ledger, isLoading, errorMessage: configError, saveConfig, recordProcessed } = useIntakeConfig();

  // The project whose createmeta we load — follows the saved config or the in-progress selection.
  const [metaProjectKey, setMetaProjectKey] = useState<string | null>(null);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { issueTypes, loadFields, getFieldDescriptors } = useJiraCreateMeta(metaProjectKey);
  const { entries, counts, ingestFile, updateEntry, errorMessage: queueError } = useIntakeQueue(ledger);

  const fieldDescriptors = useMemo(
    () => (config ? getFieldDescriptors(config.issueTypeId) : []),
    [config, getFieldDescriptors],
  );
  const { createAllNew } = useCreateFromSubmission({ config, fieldDescriptors, recordProcessed });

  // Once a config exists, follow its project for createmeta and load its issue-type fields.
  useEffect(() => {
    if (config) {
      setMetaProjectKey(config.projectKey);
    }
  }, [config]);

  useEffect(() => {
    if (config && metaProjectKey === config.projectKey) {
      loadFields(config.issueTypeId);
    }
  }, [config, metaProjectKey, loadFields]);

  async function handleSaveConfig(nextConfig: IntakeConfig): Promise<void> {
    setIsSaving(true);
    try {
      await saveConfig(nextConfig);
      setIsEditingConfig(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFile(file: File): Promise<void> {
    const newEntries = await ingestFile(file);
    if (config?.autoCreateOnImport && newEntries.length > 0) {
      const created = await createAllNew(newEntries);
      created.forEach(updateEntry);
    }
  }

  const shouldShowConfigPanel = isEditingConfig || !config;

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Jira Intake</h1>
        <p className={styles.subtitle}>
          Import Teams request submissions and turn them into Jira issues.
        </p>
      </header>

      {isLoading && <p className={styles.subtitle}>Loading intake configuration…</p>}
      {configError && <p className={styles.dropzoneError} role="alert">{configError}</p>}

      {shouldShowConfigPanel ? (
        <IntakeConfigPanel
          initialConfig={config}
          artProjectKeys={config ? [config.projectKey] : []}
          issueTypes={issueTypes}
          onProjectKeyChange={setMetaProjectKey}
          onSave={handleSaveConfig}
          isSaving={isSaving}
        />
      ) : (
        <>
          <section className={styles.panel} aria-label="Import submissions">
            <div className={styles.header}>
              <h2 className={styles.panelTitle}>
                {config?.projectKey} · {config?.issueTypeName}
                {' · '}
                {config?.autoCreateOnImport ? 'auto-create on import' : 'review and pick'}
              </h2>
              <button className={styles.secondaryButton} onClick={() => setIsEditingConfig(true)} type="button">
                Reconfigure
              </button>
            </div>
            <SubmissionDropzone onFile={(file) => { void handleFile(file); }} errorMessage={queueError} />
          </section>

          <section className={styles.panel} aria-label="Intake queue">
            <IntakeQueue entries={entries} counts={counts} />
          </section>
        </>
      )}
    </div>
  );
}
