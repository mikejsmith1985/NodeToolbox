// SaveTemplateControl.tsx — Saving the change in hand as a template, with no guessing about what happened.
//
// Owner feedback: it was unclear how to save into the template you opened without making a new one, and nothing said
// for sure whether a save worked. So: a change opened from a template offers "Update “X”" (asked once, naming what is
// overwritten) beside "Save as a new template"; a clash on a name asks instead of duplicating; and every save is
// CHECKED — the template is read back from the stored list, and the result says ✓ with what it holds, or ✗ and why.

import { useEffect, useId, useState } from 'react';

import styles from './ChangeWizard.module.css';
import type { TemplateDraft, TemplateLibrary } from './useTemplateLibrary.ts';

/** The template a job is working from, so saving can update it rather than make another. */
export interface LinkedTemplate {
  id: string;
  name: string;
}

/** Where the control stands. */
type ControlPhase =
  | { kind: 'closed' }
  | { kind: 'confirmUpdate' }
  | { kind: 'naming' }
  | { kind: 'clash'; templateId: string; existingName: string }
  | { kind: 'verifying'; templateId?: string; templateName: string; isUpdate: boolean; expectedTaskCount: number; savedAt: number }
  | { kind: 'saved'; templateName: string; isUpdate: boolean; taskCount: number; savedAt: number }
  | { kind: 'failed'; templateName: string }
  | { kind: 'cancelled' };

/** How long a save may take to appear in the stored list before it counts as not saved. */
const VERIFY_TIMEOUT_MILLISECONDS = 1500;
/** Where Toolbox keeps change templates in this browser (useCrgTemplates). */
const TEMPLATE_STORAGE_KEY = 'ntbx-crg-templates';

/** "10:42" — when a save happened, so two saves in a row are told apart. */
function formatSaveTime(savedAt: number): string {
  return new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The stored template (from the browser's own copy), by id or name, or null. */
function readStoredTemplate(templateId: string | undefined, templateName: string): { id: string; name: string; ctaskTemplateIds?: string[] } | null {
  try {
    const storedTemplates = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? '[]') as Array<{ id: string; name: string; ctaskTemplateIds?: string[] }>;
    return storedTemplates.find((template) => (templateId ? template.id === templateId : template.name.trim().toLowerCase() === templateName.trim().toLowerCase())) ?? null;
  } catch {
    return null;
  }
}

/** The name box with Save and Cancel. */
function NamingForm({ name, onNameChange, onSave, onCancel }: { name: string; onNameChange: (name: string) => void; onSave: () => void; onCancel: () => void }) {
  const nameFieldId = useId();
  return (
    <div className={styles.card}>
      <label className={styles.fieldLabel} htmlFor={nameFieldId}>Name the new template</label>
      <input id={nameFieldId} className={styles.inputField} value={name} placeholder="For example: Payments monthly release" onChange={(changeEvent) => onNameChange(changeEvent.target.value)} />
      <p className={styles.hint}>It keeps this change’s details, plan, environments and tasks, so your next change starts here.</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={name.trim() === ''} onClick={onSave}>Save new template</button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The one question before overwriting the template the job was opened from. */
function ConfirmUpdate({ templateName, taskCount, onConfirm, onCancel }: { templateName: string; taskCount: number; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className={styles.card} role="alertdialog" aria-label={`Update ${templateName}?`}>
      <p className={styles.noticeText}>{`Update “${templateName}” with what is on screen now? Its details, plan, environments and tasks are replaced by this change’s (${taskCount} task${taskCount === 1 ? '' : 's'}).`}</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={onConfirm}>{`Yes, update “${templateName}”`}</button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The question asked when the new name is already taken. */
function ClashQuestion({ existingName, onReplace, onRename }: { existingName: string; onReplace: () => void; onRename: () => void }) {
  return (
    <div className={styles.card} role="alertdialog" aria-label="Name already used">
      <p className={styles.noticeText}>{`You already have a template called “${existingName}”. Nothing was saved yet. Update that one with this change, or use another name?`}</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={onReplace}>{`Update “${existingName}”`}</button>
        <button type="button" className={styles.secondaryButton} onClick={onRename}>Use another name</button>
      </div>
    </div>
  );
}

/** The plain result of the last save, cancel or failure — never left to guess. */
function SaveResult({ phase }: { phase: ControlPhase }) {
  if (phase.kind === 'verifying') return <span className={styles.hint} role="status">Saving and checking…</span>;
  if (phase.kind === 'saved') {
    return (
      <span className={styles.successText} role="status">
        {`✓ ${phase.isUpdate ? 'Updated' : 'Saved new template'} “${phase.templateName}” at ${formatSaveTime(phase.savedAt)} — details, plan, environments and ${phase.taskCount} task${phase.taskCount === 1 ? '' : 's'}.`}
      </span>
    );
  }
  if (phase.kind === 'failed') return <span className={styles.errorText} role="status">{`✗ “${phase.templateName}” was NOT saved — it is not in your templates. Nothing changed; try again.`}</span>;
  if (phase.kind === 'cancelled') return <span className={styles.hint} role="status">Nothing was saved.</span>;
  return null;
}

/** Waits for a save to show up in the stored list, then says for certain whether it did. */
function useSaveVerification(phase: ControlPhase, library: TemplateLibrary, onPhase: (phase: ControlPhase) => void, onLinked?: (template: LinkedTemplate) => void) {
  useEffect(() => {
    if (phase.kind !== 'verifying') return undefined;
    // Read after the library has written its list to storage (its own effect runs after this one).
    const checkTimer = window.setTimeout(() => {
      const storedTemplate = readStoredTemplate(phase.templateId, phase.templateName);
      if (!storedTemplate) return;
      onPhase({ kind: 'saved', templateName: storedTemplate.name, isUpdate: phase.isUpdate, taskCount: storedTemplate.ctaskTemplateIds?.length ?? 0, savedAt: phase.savedAt });
      onLinked?.({ id: storedTemplate.id, name: storedTemplate.name });
    }, 0);
    const failTimer = window.setTimeout(() => onPhase({ kind: 'failed', templateName: phase.templateName }), VERIFY_TIMEOUT_MILLISECONDS);
    return () => { window.clearTimeout(checkTimer); window.clearTimeout(failTimer); };
  }, [phase, library.templates, onPhase, onLinked]);
}

/** What the control needs: the change in hand, the library, and the template the job is working from (if any). */
export interface SaveTemplateControlProps {
  draft: TemplateDraft;
  library: TemplateLibrary;
  linkedTemplate?: LinkedTemplate | null;
  /** Called once a save is confirmed, so the job works from that template from now on. */
  onLinkTemplate?: (template: LinkedTemplate) => void;
}

/** "Update “X”" (when the job came from a template) and "Save as a new template", each with a certain result. */
export default function SaveTemplateControl({ draft, library, linkedTemplate, onLinkTemplate }: SaveTemplateControlProps) {
  const [phase, setPhase] = useState<ControlPhase>({ kind: 'closed' });
  const [name, setName] = useState('');
  useSaveVerification(phase, library, setPhase, onLinkTemplate);
  const taskCount = draft.changeTasks.length;

  function saveInto(templateId: string, templateName: string) {
    library.saveDraftAsTemplate(templateName, draft, templateId);
    setPhase({ kind: 'verifying', templateId, templateName, isUpdate: true, expectedTaskCount: taskCount, savedAt: Date.now() });
  }

  function saveNew() {
    const trimmedName = name.trim();
    const existingTemplate = library.findTemplateByName(trimmedName);
    if (existingTemplate) { setPhase({ kind: 'clash', templateId: existingTemplate.id, existingName: existingTemplate.name }); return; }
    library.saveDraftAsTemplate(trimmedName, draft);
    setPhase({ kind: 'verifying', templateName: trimmedName, isUpdate: false, expectedTaskCount: taskCount, savedAt: Date.now() });
  }

  if (phase.kind === 'naming') return <NamingForm name={name} onNameChange={setName} onSave={saveNew} onCancel={() => setPhase({ kind: 'cancelled' })} />;
  if (phase.kind === 'clash') return <ClashQuestion existingName={phase.existingName} onReplace={() => saveInto(phase.templateId, phase.existingName)} onRename={() => setPhase({ kind: 'naming' })} />;
  if (phase.kind === 'confirmUpdate' && linkedTemplate) {
    return <ConfirmUpdate templateName={linkedTemplate.name} taskCount={taskCount} onConfirm={() => saveInto(linkedTemplate.id, linkedTemplate.name)} onCancel={() => setPhase({ kind: 'cancelled' })} />;
  }
  return (
    <span className={styles.buttonRow}>
      {linkedTemplate ? <button type="button" className={styles.actionButton} onClick={() => setPhase({ kind: 'confirmUpdate' })}>{`Update template “${linkedTemplate.name}”`}</button> : null}
      <button type="button" className={styles.secondaryButton} onClick={() => { setName(''); setPhase({ kind: 'naming' }); }}>{linkedTemplate ? 'Save as a new template' : 'Save as template'}</button>
      <SaveResult phase={phase} />
    </span>
  );
}
