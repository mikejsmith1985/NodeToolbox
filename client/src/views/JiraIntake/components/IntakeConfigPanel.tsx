// IntakeConfigPanel.tsx — Configures the intake. Mapping is by convention, so the settings are:
// the default target project, the team→project routing for the submission "project" column, the
// Acceptance Criteria field id, and the auto-create toggle. See FR-1.

import { useState } from 'react';

import ArtProjectInput from '../../JiraTemplateMaker/components/ArtProjectInput.tsx';
import styles from '../JiraIntake.module.css';
import { DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID, type IntakeConfig, type ProjectMapping } from '../lib/intakeTypes.ts';

interface IntakeConfigPanelProps {
  initialConfig: IntakeConfig | null;
  artProjectKeys: string[];
  onSave: (config: IntakeConfig) => Promise<void> | void;
  isSaving?: boolean;
}

/** The intake configuration form. */
export default function IntakeConfigPanel({ initialConfig, artProjectKeys, onSave, isSaving = false }: IntakeConfigPanelProps) {
  const [projectKey, setProjectKey] = useState(initialConfig?.projectKey ?? '');
  const [acceptanceCriteriaFieldId, setAcceptanceCriteriaFieldId] = useState(
    initialConfig?.acceptanceCriteriaFieldId ?? DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID,
  );
  const [autoCreateOnImport, setAutoCreateOnImport] = useState(initialConfig?.autoCreateOnImport ?? true);
  const [projectMappings, setProjectMappings] = useState<ProjectMapping[]>(initialConfig?.projectMappings ?? []);

  const canSave = projectKey.trim() !== '' && !isSaving;

  function updateMapping(index: number, patch: Partial<ProjectMapping>): void {
    setProjectMappings((mappings) => mappings.map((mapping, position) => (position === index ? { ...mapping, ...patch } : mapping)));
  }

  function addMapping(): void {
    setProjectMappings((mappings) => [...mappings, { projectName: '', projectKey: '' }]);
  }

  function removeMapping(index: number): void {
    setProjectMappings((mappings) => mappings.filter((_, position) => position !== index));
  }

  function handleSave(): void {
    // Keep only fully-filled mapping rows so blank editor rows are not persisted.
    const cleanedMappings = projectMappings
      .filter((mapping) => mapping.projectName.trim() !== '' && mapping.projectKey.trim() !== '')
      .map((mapping) => ({ projectName: mapping.projectName.trim(), projectKey: mapping.projectKey.trim().toUpperCase() }));

    onSave({
      projectKey: projectKey.trim().toUpperCase(),
      projectMappings: cleanedMappings,
      acceptanceCriteriaFieldId: acceptanceCriteriaFieldId.trim(),
      autoCreateOnImport,
      updatedAt: '',
      updatedBy: '',
    });
  }

  return (
    <section className={styles.panel} aria-label="Intake settings">
      <h2 className={styles.panelTitle}>Intake settings</h2>
      <p className={styles.subtitle}>
        Issue type and priority come from each submission. The row&apos;s &quot;project&quot; column is a
        project name — map each project name to a Jira project key below; rows with no project use
        the default project.
      </p>

      <ArtProjectInput
        id="intake-project"
        label="Default project"
        value={projectKey}
        artProjectKeys={artProjectKeys}
        onChange={setProjectKey}
      />

      <div>
        <span className={styles.fieldLabel}>Project → Jira project-key mapping</span>
        {projectMappings.map((mapping, index) => (
          <div className={styles.mappingRow} key={index}>
            <input
              aria-label={`Project name ${index + 1}`}
              className={styles.input}
              onChange={(event) => updateMapping(index, { projectName: event.target.value })}
              placeholder="Project name (e.g. Cleanup Crew)"
              value={mapping.projectName}
            />
            <input
              aria-label={`Jira project key ${index + 1}`}
              className={styles.input}
              onChange={(event) => updateMapping(index, { projectKey: event.target.value })}
              placeholder="Jira project key (e.g. ENCUC)"
              value={mapping.projectKey}
            />
            <button className={styles.secondaryButton} onClick={() => removeMapping(index)} type="button">Remove</button>
          </div>
        ))}
        <button className={styles.secondaryButton} onClick={addMapping} type="button">+ Add project mapping</button>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.fieldLabel} htmlFor="intake-ac-field">Acceptance Criteria field id</label>
        <input
          className={styles.input}
          id="intake-ac-field"
          onChange={(event) => setAcceptanceCriteriaFieldId(event.target.value)}
          placeholder={DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID}
          value={acceptanceCriteriaFieldId}
        />
      </div>

      <label className={styles.checkboxRow}>
        <input
          checked={autoCreateOnImport}
          onChange={(event) => setAutoCreateOnImport(event.target.checked)}
          type="checkbox"
        />
        Auto-create issues on import (off = review and pick)
      </label>

      <button className={styles.primaryButton} disabled={!canSave} onClick={handleSave} type="button">
        {isSaving ? 'Saving…' : 'Save settings'}
      </button>
    </section>
  );
}
