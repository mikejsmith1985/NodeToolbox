// TaskTemplatesSection.tsx — "Your saved tasks" on the templates screen: each saved task, ready to share as a code or file, or delete.
//
// A saved task travels in the same task code Toolbox's "Share all" makes, so one person's saved tasks can go to
// another person's Wizard (or come over from Toolbox) by pasting a code or choosing a file below.

import { useId, useState } from 'react';

import { buildCtaskTemplatesShareFile, downloadShareFile, encodeCtaskTemplatesShareCode } from '../../views/SnowHub/ctaskTemplateShare.ts';
import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import CopyButton from '../shell/CopyButton.tsx';
import styles from './ChangeWizard.module.css';
import type { TemplateLibrary } from './useTemplateLibrary.ts';

/** "Assigned to Pat · goes on PRD" for one saved task. */
function describeSavedTask(ctaskTemplate: CtaskTemplate): string {
  const assigneeText = ctaskTemplate.assignedTo.displayName ? `Assigned to ${ctaskTemplate.assignedTo.displayName}` : 'No one assigned yet';
  const environmentText = ctaskTemplate.environmentKeys ? `goes on ${ctaskTemplate.environmentKeys.join(', ') || 'no change yet'}` : 'goes on every change';
  return `${assigneeText} · ${environmentText}`;
}

/** The code for one saved task, ready to copy. */
function TaskSharePanel({ ctaskTemplate }: { ctaskTemplate: CtaskTemplate }) {
  const codeFieldId = useId();
  const shareCode = encodeCtaskTemplatesShareCode([ctaskTemplate]);
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={codeFieldId}>{`Task code for “${ctaskTemplate.name}”`}</label>
      <textarea id={codeFieldId} className={styles.textArea} readOnly value={shareCode} />
      <p className={styles.hint}>Copy it and paste it into Teams or an email. The other person pastes it under “Add something someone shared”.</p>
      <div className={styles.buttonRow}><CopyButton text={shareCode} label="Copy the code" fallbackTargetId={codeFieldId} /></div>
    </div>
  );
}

/** One saved task with Share, Download and a two-step Delete. */
function SavedTaskCard({ ctaskTemplate, library }: { ctaskTemplate: CtaskTemplate; library: TemplateLibrary }) {
  const [isSharing, setIsSharing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>{ctaskTemplate.name}</h3>
      <p className={styles.hint}>{describeSavedTask(ctaskTemplate)}</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.secondaryButton} aria-expanded={isSharing} aria-label={`Share ${ctaskTemplate.name}`} onClick={() => setIsSharing(!isSharing)}>Share</button>
        <button type="button" className={styles.secondaryButton} aria-label={`Download ${ctaskTemplate.name}`} onClick={() => downloadShareFile(buildCtaskTemplatesShareFile([ctaskTemplate]))}>Download</button>
        <button type="button" className={styles.secondaryButton} aria-label={`Delete ${ctaskTemplate.name}`} onClick={() => setIsConfirmingDelete(true)}>Delete</button>
      </div>
      {isSharing ? <TaskSharePanel ctaskTemplate={ctaskTemplate} /> : null}
      {isConfirmingDelete ? (
        <div className={styles.buttonRow} role="alertdialog" aria-label={`Delete ${ctaskTemplate.name}?`}>
          <p className={styles.noticeText}>{`Delete “${ctaskTemplate.name}”? This cannot be undone.`}</p>
          <button type="button" className={styles.actionButton} onClick={() => library.deleteCtaskTemplate(ctaskTemplate.id)}>Yes, delete it</button>
          <button type="button" className={styles.secondaryButton} onClick={() => setIsConfirmingDelete(false)}>Keep it</button>
        </div>
      ) : null}
    </li>
  );
}

/** "Your saved tasks". */
export default function TaskTemplatesSection({ library }: { library: TemplateLibrary }) {
  return (
    <section aria-labelledby="saved-tasks-heading">
      <h3 id="saved-tasks-heading" className={styles.cardTitle}>Your saved tasks</h3>
      <p className={styles.hint}>A saved task fills in a task card for you. Save one from any task card, or bring them over from Toolbox with its “Share all”.</p>
      {library.ctaskTemplates.length === 0 ? <p className={styles.hint}>You have no saved tasks yet.</p> : null}
      <ul className={styles.itemList} aria-label="Saved tasks">
        {library.ctaskTemplates.map((ctaskTemplate) => <SavedTaskCard key={ctaskTemplate.id} ctaskTemplate={ctaskTemplate} library={library} />)}
      </ul>
    </section>
  );
}
