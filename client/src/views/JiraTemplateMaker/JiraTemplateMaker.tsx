// JiraTemplateMaker.tsx — Guided wizard for building and saving reusable Jira issue templates.
// Walks the user through Project → Issue Type → Fields → Review, constraining every choice to
// live Jira metadata, then saves the template to the globally-shared library.

import { useEffect, useMemo, useState } from 'react';

import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import FieldValueInput from './components/FieldValueInput.tsx';
import IssueTypePicker from './components/IssueTypePicker.tsx';
import ScopedFieldPicker from './components/ScopedFieldPicker.tsx';
import { useJiraCreateMeta } from './hooks/useJiraCreateMeta.ts';
import { useTemplateLibrary } from './hooks/useTemplateLibrary.ts';
import { createFieldEntry, TEMPLATE_MAKER_STEPS, useTemplateMakerState } from './hooks/useTemplateMakerState.ts';
import type { TemplateMakerStep } from './hooks/useTemplateMakerState.ts';
import type { FieldDescriptor, FieldEntryMode } from './lib/templateTypes.ts';
import styles from './JiraTemplateMaker.module.css';

const STEP_LABELS: Record<TemplateMakerStep, string> = {
  project: '1. Project',
  issueType: '2. Issue type',
  fields: '3. Fields & values',
  review: '4. Review & save',
};

/** Top-level Jira Template Maker view. */
export default function JiraTemplateMaker() {
  const state = useTemplateMakerState();
  const createMeta = useJiraCreateMeta(state.projectKey || null);
  const library = useTemplateLibrary();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Once createmeta resolves the project, capture its id (needed for the create payload).
  useEffect(() => {
    if (createMeta.project && createMeta.project.id !== state.projectId) {
      state.setProject(state.projectKey, createMeta.project.id);
    }
  }, [createMeta.project, state]);

  const fieldDescriptors = useMemo(
    () => (state.issueTypeId ? createMeta.getFieldDescriptors(state.issueTypeId) : []),
    [createMeta, state.issueTypeId],
  );
  const descriptorById = useMemo(
    () => new Map(fieldDescriptors.map((descriptor) => [descriptor.fieldId, descriptor])),
    [fieldDescriptors],
  );

  function handleAddField(descriptor: FieldDescriptor): void {
    if (descriptor.internalType) {
      state.addField(createFieldEntry(descriptor.fieldId, descriptor.name, descriptor.internalType));
    }
  }

  async function handleSave(): Promise<void> {
    setSaveMessage(null);
    if (!state.templateName.trim()) {
      setSaveMessage('Give the template a name before saving.');
      return;
    }
    const outcome = await library.saveTemplate({
      name: state.templateName.trim(),
      description: state.templateDescription.trim(),
      projectKey: state.projectKey,
      projectId: state.projectId,
      issueTypeId: state.issueTypeId,
      issueTypeName: state.issueTypeName,
      fields: state.fieldEntries,
    });
    if (!outcome.ok) {
      setSaveMessage('Someone else changed these templates while you were editing. Reload the library and try again.');
      return;
    }
    setSaveMessage(`Saved "${state.templateName.trim()}" to the shared library.`);
    state.reset();
  }

  return (
    <div className={styles.view}>
      <h1>Jira Template Maker</h1>
      <p>Build a reusable issue template — pick a project, an issue type, and the fields you want, then save it for everyone to use.</p>

      <nav className={styles.steps} aria-label="Wizard steps">
        {TEMPLATE_MAKER_STEPS.map((step) => (
          <button
            className={`${styles.stepButton} ${state.currentStep === step ? styles.stepButtonActive : ''}`}
            key={step}
            onClick={() => state.goToStep(step)}
            type="button"
          >
            {STEP_LABELS[step]}
          </button>
        ))}
      </nav>

      {state.rescopeWarning && (
        <div className={styles.warning} role="status">
          {state.rescopeWarning}{' '}
          <button className={styles.toolbarButton} onClick={state.dismissRescopeWarning} type="button">Dismiss</button>
        </div>
      )}
      {createMeta.errorMessage && <div className={styles.error} role="alert">{createMeta.errorMessage}</div>}

      {state.currentStep === 'project' && (
        <section className={styles.section}>
          <JiraProjectPicker
            id="tmpl-project"
            label="Project"
            value={state.projectKey}
            onChange={(projectKey) => state.setProject(projectKey, '')}
          />
          <button
            className={styles.primaryButton}
            disabled={!state.projectKey || createMeta.isLoading || !createMeta.hasCreatePermission}
            onClick={() => state.goToStep('issueType')}
            type="button"
          >
            {createMeta.isLoading ? 'Loading…' : 'Next: issue type'}
          </button>
        </section>
      )}

      {state.currentStep === 'issueType' && (
        <section className={styles.section}>
          <IssueTypePicker
            id="tmpl-issuetype"
            label="Issue type"
            issueTypes={createMeta.issueTypes}
            value={state.issueTypeId}
            onChange={state.setIssueType}
          />
          <button
            className={styles.primaryButton}
            disabled={!state.issueTypeId}
            onClick={() => state.goToStep('fields')}
            type="button"
          >
            Next: choose fields
          </button>
        </section>
      )}

      {state.currentStep === 'fields' && (
        <section className={styles.section}>
          <h2>Available fields</h2>
          <ScopedFieldPicker
            descriptors={fieldDescriptors}
            addedFieldIds={state.fieldEntries.map((entry) => entry.fieldId)}
            onAdd={handleAddField}
          />

          <h2>Selected fields</h2>
          {state.fieldEntries.length === 0 && <p>No fields added yet.</p>}
          {state.fieldEntries.map((entry) => {
            const descriptor = descriptorById.get(entry.fieldId);
            return (
              <div className={styles.fieldRow} key={entry.fieldId}>
                <span className={styles.fieldLabel}>
                  {entry.fieldName}
                  {descriptor?.required && <span className={styles.required} title="Required">*</span>}
                  <button className={styles.toolbarButton} onClick={() => state.removeField(entry.fieldId)} type="button" style={{ marginLeft: '0.5rem' }}>Remove</button>
                </span>
                <label className={styles.modeToggle}>
                  <input
                    checked={entry.mode === 'promptAtLaunch'}
                    onChange={(event) => state.setFieldMode(entry.fieldId, (event.target.checked ? 'promptAtLaunch' : 'fixed') as FieldEntryMode)}
                    type="checkbox"
                  />
                  Ask for this value each time it&apos;s used
                </label>
                {descriptor && entry.mode === 'fixed' && (
                  <FieldValueInput
                    descriptor={descriptor}
                    value={entry.value}
                    onChange={(value) => state.setFieldValue(entry.fieldId, value)}
                  />
                )}
              </div>
            );
          })}
          <button className={styles.primaryButton} onClick={() => state.goToStep('review')} type="button">Next: review & save</button>
        </section>
      )}

      {state.currentStep === 'review' && (
        <section className={styles.section}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="tmpl-name">Template name</label>
            <input className={styles.input} id="tmpl-name" type="text"
              onChange={(event) => state.setTemplateName(event.target.value)} value={state.templateName} />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel} htmlFor="tmpl-desc">Description (optional)</label>
            <input className={styles.input} id="tmpl-desc" type="text"
              onChange={(event) => state.setTemplateDescription(event.target.value)} value={state.templateDescription} />
          </div>
          <p>{state.projectKey} · {state.issueTypeName} · {state.fieldEntries.length} field(s)</p>
          <button className={styles.primaryButton} onClick={() => void handleSave()} type="button">Save template</button>
          {saveMessage && <p role="status">{saveMessage}</p>}
        </section>
      )}
    </div>
  );
}
