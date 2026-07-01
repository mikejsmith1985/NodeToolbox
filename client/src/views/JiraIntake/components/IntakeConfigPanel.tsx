// IntakeConfigPanel.tsx — Configures the single active intake. Because the Teams contract is fixed
// and mapping is by convention, the only settings are the target project (not carried in the
// record), the Acceptance Criteria field id, and the auto-create toggle. See FR-1.

import { useState } from 'react';

import ArtProjectInput from '../../JiraTemplateMaker/components/ArtProjectInput.tsx';
import styles from '../JiraIntake.module.css';
import { DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID, type IntakeConfig } from '../lib/intakeTypes.ts';

interface IntakeConfigPanelProps {
  initialConfig: IntakeConfig | null;
  artProjectKeys: string[];
  onSave: (config: IntakeConfig) => Promise<void> | void;
  isSaving?: boolean;
}

/** The (minimal) intake configuration form. */
export default function IntakeConfigPanel({ initialConfig, artProjectKeys, onSave, isSaving = false }: IntakeConfigPanelProps) {
  const [projectKey, setProjectKey] = useState(initialConfig?.projectKey ?? '');
  const [acceptanceCriteriaFieldId, setAcceptanceCriteriaFieldId] = useState(
    initialConfig?.acceptanceCriteriaFieldId ?? DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID,
  );
  const [autoCreateOnImport, setAutoCreateOnImport] = useState(initialConfig?.autoCreateOnImport ?? true);

  const canSave = projectKey.trim() !== '' && !isSaving;

  function handleSave(): void {
    onSave({
      projectKey: projectKey.trim().toUpperCase(),
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
        Issue type and priority come from each submission — only the target project is set here.
      </p>

      <ArtProjectInput
        id="intake-project"
        label="Target project"
        value={projectKey}
        artProjectKeys={artProjectKeys}
        onChange={setProjectKey}
      />

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
