// IntakeConfigPanel.tsx — Configures the single active intake: target project + issue type, the
// core-field→Jira-field mapping, and the auto-create toggle. Reuses the Template Maker's project
// and issue-type pickers so the experience matches the rest of the app. See FR-1.

import { useMemo, useState } from 'react';

import type { CreateMetaIssueType } from '../../../types/jira.ts';
import ArtProjectInput from '../../JiraTemplateMaker/components/ArtProjectInput.tsx';
import IssueTypePicker from '../../JiraTemplateMaker/components/IssueTypePicker.tsx';
import styles from '../JiraIntake.module.css';
import type { CoreFieldKey, FieldTransform, IntakeConfig, IntakeFieldMapping } from '../lib/intakeTypes.ts';

interface IntakeConfigPanelProps {
  initialConfig: IntakeConfig | null;
  artProjectKeys: string[];
  issueTypes: CreateMetaIssueType[];
  /** Notifies the parent when the project key changes so it can load that project's createmeta. */
  onProjectKeyChange: (projectKey: string) => void;
  onSave: (config: IntakeConfig) => Promise<void> | void;
  isSaving?: boolean;
}

/** One editable mapping row's working state (jiraFieldId blank = this core field is not mapped). */
interface MappingDraft {
  coreField: CoreFieldKey;
  jiraFieldId: string;
  transform: FieldTransform;
}

// Sensible defaults matching the Teams core fields; the user can edit field ids and transforms.
const DEFAULT_MAPPING_DRAFTS: MappingDraft[] = [
  { coreField: 'summary', jiraFieldId: 'summary', transform: 'raw' },
  { coreField: 'description', jiraFieldId: 'description', transform: 'wikiMarkup' },
  { coreField: 'acceptanceCriteria', jiraFieldId: '', transform: 'wikiMarkup' },
  { coreField: 'priority', jiraFieldId: 'priority', transform: 'choiceByName' },
  { coreField: 'issueType', jiraFieldId: '', transform: 'choiceByName' },
];

const TRANSFORM_OPTIONS: FieldTransform[] = ['raw', 'wikiMarkup', 'choiceByName'];
const CORE_FIELD_LABEL: Record<CoreFieldKey, string> = {
  summary: 'Summary',
  description: 'Description',
  acceptanceCriteria: 'Acceptance Criteria',
  issueType: 'Issue Type',
  priority: 'Priority',
};

/** Seeds the editable mapping rows from an existing config, else from the defaults. */
function initialDrafts(config: IntakeConfig | null): MappingDraft[] {
  if (!config) {
    return DEFAULT_MAPPING_DRAFTS;
  }
  return DEFAULT_MAPPING_DRAFTS.map((draft) => {
    const existing = config.fieldMappings.find((mapping) => mapping.coreField === draft.coreField);
    return existing
      ? { coreField: draft.coreField, jiraFieldId: existing.jiraFieldId, transform: existing.transform }
      : draft;
  });
}

/** The intake configuration form. */
export default function IntakeConfigPanel({
  initialConfig,
  artProjectKeys,
  issueTypes,
  onProjectKeyChange,
  onSave,
  isSaving = false,
}: IntakeConfigPanelProps) {
  const [projectKey, setProjectKey] = useState(initialConfig?.projectKey ?? '');
  const [issueTypeId, setIssueTypeId] = useState(initialConfig?.issueTypeId ?? '');
  const [issueTypeName, setIssueTypeName] = useState(initialConfig?.issueTypeName ?? '');
  const [autoCreateOnImport, setAutoCreateOnImport] = useState(initialConfig?.autoCreateOnImport ?? true);
  const [mappingDrafts, setMappingDrafts] = useState<MappingDraft[]>(() => initialDrafts(initialConfig));

  const canSave = useMemo(
    () => projectKey.trim() !== '' && issueTypeId.trim() !== '' && !isSaving,
    [projectKey, issueTypeId, isSaving],
  );

  function handleProjectKeyChange(nextKey: string): void {
    setProjectKey(nextKey);
    onProjectKeyChange(nextKey);
  }

  function updateMapping(coreField: CoreFieldKey, patch: Partial<MappingDraft>): void {
    setMappingDrafts((drafts) => drafts.map((draft) => (draft.coreField === coreField ? { ...draft, ...patch } : draft)));
  }

  function handleSave(): void {
    // Only mapped core fields (non-blank Jira field id) become real mappings.
    const fieldMappings: IntakeFieldMapping[] = mappingDrafts
      .filter((draft) => draft.jiraFieldId.trim() !== '')
      .map((draft) => ({
        coreField: draft.coreField,
        jiraFieldId: draft.jiraFieldId.trim(),
        jiraFieldType: 'text',
        transform: draft.transform,
      }));

    const config: IntakeConfig = {
      projectKey: projectKey.trim().toUpperCase(),
      projectId: initialConfig?.projectId ?? '',
      issueTypeId,
      issueTypeName,
      fieldMappings,
      autoCreateOnImport,
      updatedAt: '',
      updatedBy: '',
    };
    void onSave(config);
  }

  return (
    <section className={styles.panel} aria-label="Intake configuration">
      <h2 className={styles.panelTitle}>Intake configuration</h2>

      <ArtProjectInput
        id="intake-project"
        label="Target project"
        value={projectKey}
        artProjectKeys={artProjectKeys}
        onChange={handleProjectKeyChange}
      />

      <IssueTypePicker
        id="intake-issue-type"
        label="Issue type"
        issueTypes={issueTypes}
        value={issueTypeId}
        onChange={(nextId, nextName) => { setIssueTypeId(nextId); setIssueTypeName(nextName); }}
      />

      <div>
        <span className={styles.fieldLabel}>Field mapping (core → Jira)</span>
        {mappingDrafts.map((draft) => (
          <div className={styles.mappingRow} key={draft.coreField}>
            <span>{CORE_FIELD_LABEL[draft.coreField]}</span>
            <input
              aria-label={`${CORE_FIELD_LABEL[draft.coreField]} Jira field id`}
              className={styles.input}
              onChange={(event) => updateMapping(draft.coreField, { jiraFieldId: event.target.value })}
              placeholder="Jira field id (blank = skip)"
              value={draft.jiraFieldId}
            />
            <select
              aria-label={`${CORE_FIELD_LABEL[draft.coreField]} transform`}
              className={styles.select}
              onChange={(event) => updateMapping(draft.coreField, { transform: event.target.value as FieldTransform })}
              value={draft.transform}
            >
              {TRANSFORM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        ))}
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
        {isSaving ? 'Saving…' : 'Save configuration'}
      </button>
    </section>
  );
}
