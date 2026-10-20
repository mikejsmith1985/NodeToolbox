// SaveTemplateControl.tsx — "Save as template": asks only for a name, saves the change in hand, and confirms "Saved ✓".
//
// A name already in use offers "Replace it" (the existing template is updated in place) rather than a duplicate.

import { useId, useState } from 'react';

import styles from './ChangeWizard.module.css';
import type { TemplateDraft, TemplateLibrary } from './useTemplateLibrary.ts';

type ControlPhase = { kind: 'closed' } | { kind: 'naming' } | { kind: 'clash'; templateId: string; existingName: string } | { kind: 'saved'; templateName: string };

/** The name box with Save and Cancel. */
function NamingForm({ name, onNameChange, onSave, onCancel }: { name: string; onNameChange: (name: string) => void; onSave: () => void; onCancel: () => void }) {
  const nameFieldId = useId();
  return (
    <div className={styles.card}>
      <label className={styles.fieldLabel} htmlFor={nameFieldId}>Name this template</label>
      <input id={nameFieldId} className={styles.inputField} value={name} placeholder="For example: Payments monthly release" onChange={(changeEvent) => onNameChange(changeEvent.target.value)} />
      <p className={styles.hint}>It keeps this change’s details, plan, environments and tasks, so your next change starts here.</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={name.trim() === ''} onClick={onSave}>Save template</button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The question asked when the name is already taken. */
function ClashQuestion({ existingName, onReplace, onRename }: { existingName: string; onReplace: () => void; onRename: () => void }) {
  return (
    <div className={styles.card}>
      <p className={styles.noticeText}>{`You already have a template called “${existingName}”. Replace it with this change, or use another name?`}</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={onReplace}>Replace it</button>
        <button type="button" className={styles.secondaryButton} onClick={onRename}>Use another name</button>
      </div>
    </div>
  );
}

/** "Save as template" for the change being built or edited, saving through the job's one template library. */
export default function SaveTemplateControl({ draft, library }: { draft: TemplateDraft; library: TemplateLibrary }) {
  const [phase, setPhase] = useState<ControlPhase>({ kind: 'closed' });
  const [name, setName] = useState('');

  function handleSave() {
    const existingTemplate = library.findTemplateByName(name);
    if (existingTemplate) {
      setPhase({ kind: 'clash', templateId: existingTemplate.id, existingName: existingTemplate.name });
      return;
    }
    library.saveDraftAsTemplate(name.trim(), draft);
    setPhase({ kind: 'saved', templateName: name.trim() });
  }

  function handleReplace(templateId: string, existingName: string) {
    library.saveDraftAsTemplate(existingName, draft, templateId);
    setPhase({ kind: 'saved', templateName: existingName });
  }

  if (phase.kind === 'naming') return <NamingForm name={name} onNameChange={setName} onSave={handleSave} onCancel={() => setPhase({ kind: 'closed' })} />;
  if (phase.kind === 'clash') return <ClashQuestion existingName={phase.existingName} onReplace={() => handleReplace(phase.templateId, phase.existingName)} onRename={() => setPhase({ kind: 'naming' })} />;
  return (
    <span className={styles.buttonRow}>
      <button type="button" className={styles.secondaryButton} onClick={() => { setName(''); setPhase({ kind: 'naming' }); }}>Save as template</button>
      {phase.kind === 'saved' ? <span className={styles.successText} role="status">{`Saved ✓ “${phase.templateName}” is in your templates.`}</span> : null}
    </span>
  );
}
