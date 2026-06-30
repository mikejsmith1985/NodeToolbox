// JiraTemplateMaker.tsx — Guided wizard for building and saving reusable Jira issue templates.
// Walks the user through Project → Issue Type → Fields → Review, constraining every choice to
// live Jira metadata, then saves the template to the globally-shared library.

import { useEffect, useMemo, useState } from 'react';

import ArtProjectInput from './components/ArtProjectInput.tsx';
import FieldValueInput from './components/FieldValueInput.tsx';
import IssueTypePicker from './components/IssueTypePicker.tsx';
import LaunchDialog from './components/LaunchDialog.tsx';
import ScopedFieldPicker from './components/ScopedFieldPicker.tsx';
import { getArtProjectKeys } from './lib/artProjects.ts';
import type { JiraTemplate } from './lib/templateTypes.ts';
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
  // The template the user is creating an issue from (launch flow); loads its own createmeta so
  // it works regardless of what the wizard above currently has selected.
  const [launchTemplate, setLaunchTemplate] = useState<JiraTemplate | null>(null);
  const launchMeta = useJiraCreateMeta(launchTemplate?.projectKey ?? null);
  const launchDescriptors = launchTemplate ? launchMeta.getFieldDescriptors(launchTemplate.issueTypeId) : [];
  // ART-configured project keys seed the project search (no full project dropdown).
  const artProjectKeys = useMemo(() => getArtProjectKeys(), []);

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
      id: state.editingTemplateId ?? undefined,
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

  async function handleDelete(templateId: string, templateName: string): Promise<void> {
    if (!window.confirm(`Delete the template "${templateName}"? This affects everyone.`)) {
      return;
    }
    const outcome = await library.deleteTemplate(templateId);
    setSaveMessage(outcome.ok
      ? `Deleted "${templateName}".`
      : 'Someone else changed these templates. Reload and try again.');
  }

  /** Whether a step is reachable yet — gates the step chips so prerequisites can't be skipped. */
  function canVisitStep(step: TemplateMakerStep): boolean {
    if (step === 'project') {
      return true;
    }
    if (step === 'issueType') {
      return Boolean(state.projectKey) && createMeta.hasCreatePermission;
    }
    return Boolean(state.issueTypeId); // fields + review need an issue type
  }

  return (
    <div className={styles.view}>
      <h1>Jira Template Maker</h1>
      <p>Build a reusable issue template — pick a project, an issue type, and the fields you want, then save it for everyone to use.</p>

      <nav className={styles.steps} aria-label="Wizard steps">
        {TEMPLATE_MAKER_STEPS.map((step) => (
          <button
            className={`${styles.stepButton} ${state.currentStep === step ? styles.stepButtonActive : ''}`}
            disabled={!canVisitStep(step)}
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
          <ArtProjectInput
            id="tmpl-project"
            label="Project"
            value={state.projectKey}
            artProjectKeys={artProjectKeys}
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
                {descriptor && entry.mode === 'promptAtLaunch' && (
                  <div>
                    <span className={styles.unsupportedTag}>Optional default to pre-fill the prompt:</span>
                    <FieldValueInput
                      descriptor={descriptor}
                      value={entry.defaultValue}
                      onChange={(value) => state.setFieldDefault(entry.fieldId, value)}
                    />
                  </div>
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

      <section className={styles.section} aria-label="Saved templates">
        <h2>Saved templates</h2>
        {library.isLoading && <p>Loading templates…</p>}
        {library.errorMessage && <div className={styles.error} role="alert">{library.errorMessage}</div>}
        {!library.isLoading && library.templates.length === 0 && <p>No templates saved yet.</p>}
        {library.templates.map((template) => (
          <div className={styles.fieldPickerItem} key={template.id}>
            <span>{template.name} <span className={styles.unsupportedTag}>{template.projectKey} · {template.issueTypeName} · by {template.authorName}</span></span>
            <span>
              <button className={styles.toolbarButton} onClick={() => setLaunchTemplate(template)} type="button">Use</button>
              <button className={styles.toolbarButton} onClick={() => state.loadTemplate(template)} type="button" style={{ marginLeft: '0.4rem' }}>Edit</button>
              <button className={styles.toolbarButton} onClick={() => void handleDelete(template.id, template.name)} type="button" style={{ marginLeft: '0.4rem' }}>Delete</button>
            </span>
          </div>
        ))}
      </section>

      {launchTemplate && (
        launchMeta.isLoading
          ? <p>Loading template fields…</p>
          : (
            <LaunchDialog
              template={launchTemplate}
              descriptors={launchDescriptors}
              onClose={() => setLaunchTemplate(null)}
            />
          )
      )}
    </div>
  );
}
