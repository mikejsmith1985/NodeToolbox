// TemplatesScreen.tsx — "Your templates": open one in a new change, share it as a code or a file, delete it, or add one someone shared.
//
// Sharing needs no server: a template travels as a code people paste into Teams or an email, or as a downloaded file.
// The same place takes a task code — from another Wizard, or from Toolbox's "Share all" — and lists the saved tasks.

import { useId, useState, type ChangeEvent } from 'react';

import { decodeCtaskTemplatesShare, downloadShareFile, isCtaskTemplatesShareText } from '../../views/SnowHub/ctaskTemplateShare.ts';
import type { CrgTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import CopyButton from '../shell/CopyButton.tsx';
import shellStyles from '../shell/WizardShell.module.css';
import styles from './ChangeWizard.module.css';
import TaskTemplatesSection from './TaskTemplatesSection.tsx';
import { buildTemplateShareFile, decodeTemplateShare, encodeTemplateShareCode } from './templateShare.ts';
import type { TemplateLibrary } from './useTemplateLibrary.ts';

interface TemplatesScreenProps {
  library: TemplateLibrary;
  onUseTemplate: (templateId: string) => void;
  onBack: () => void;
  /** The words on the use button ("Use it on this change" inside a job). */
  useLabel?: string;
}

type ImportOutcome = { kind: 'idle' } | { kind: 'added'; message: string } | { kind: 'failed'; message: string };

/** Saves the template as a `.snow-template.json` file through the browser's own download. */
function downloadTemplateFile(template: CrgTemplate, library: TemplateLibrary): void {
  downloadShareFile(buildTemplateShareFile(template, library.listLinkedTasks(template)));
}

/** "Added “Deploy” and “Smoke test” to your saved tasks ✓". */
function describeAddedTasks(taskNames: readonly string[]): string {
  const quotedNames = taskNames.map((taskName) => `“${taskName}”`);
  const namesText = quotedNames.length > 1 ? `${quotedNames.slice(0, -1).join(', ')} and ${quotedNames.at(-1)}` : quotedNames[0];
  return `Added ${namesText} to your saved tasks ✓`;
}

/** Reads a pasted code or file's text — a change template, or saved tasks — and saves it; returns what happened. */
function importSharedText(sharedText: string, library: TemplateLibrary): ImportOutcome {
  if (isCtaskTemplatesShareText(sharedText)) {
    const decodedTasks = decodeCtaskTemplatesShare(sharedText);
    return decodedTasks.isValid
      ? { kind: 'added', message: describeAddedTasks(library.importSharedTasks(decodedTasks.ctaskTemplates)) }
      : { kind: 'failed', message: decodedTasks.errorMessage };
  }
  const decoded = decodeTemplateShare(sharedText);
  if (!decoded.isValid) return { kind: 'failed', message: decoded.errorMessage };
  return { kind: 'added', message: `Added “${library.importShared(decoded.payload).templateName}” to your templates ✓` };
}

/** "Saved 1 Oct 2026 · 2 tasks" for one template. */
function describeTemplate(template: CrgTemplate): string {
  const savedDate = new Date(template.createdAt);
  const taskCount = template.ctaskTemplateIds?.length ?? 0;
  const savedText = Number.isNaN(savedDate.getTime()) ? '' : `Saved ${savedDate.toLocaleDateString()} · `;
  return `${savedText}${taskCount} task${taskCount === 1 ? '' : 's'}`;
}

/** The code to pass on, ready to copy. */
function SharePanel({ template, library }: { template: CrgTemplate; library: TemplateLibrary }) {
  const codeFieldId = useId();
  const shareCode = encodeTemplateShareCode(template, library.listLinkedTasks(template));
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={codeFieldId}>{`Template code for “${template.name}”`}</label>
      <textarea id={codeFieldId} className={styles.textArea} readOnly value={shareCode} />
      <p className={styles.hint}>Copy it and paste it into Teams or an email. The other person pastes it under “Add a template someone shared”.</p>
      <div className={styles.buttonRow}><CopyButton text={shareCode} label="Copy the code" fallbackTargetId={codeFieldId} /></div>
    </div>
  );
}

/** One template, with everything that can be done to it. */
type TemplateCardProps = { template: CrgTemplate } & Pick<TemplatesScreenProps, 'library' | 'onUseTemplate' | 'useLabel'>;

function TemplateCard({ template, library, onUseTemplate, useLabel = 'Open it in a new change' }: TemplateCardProps) {
  const [isSharing, setIsSharing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>{template.name}</h3>
      <p className={styles.hint}>{describeTemplate(template)}</p>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={() => onUseTemplate(template.id)}>{useLabel}</button>
        <button type="button" className={styles.secondaryButton} aria-expanded={isSharing} onClick={() => setIsSharing(!isSharing)}>Share</button>
        <button type="button" className={styles.secondaryButton} onClick={() => downloadTemplateFile(template, library)}>Download</button>
        <button type="button" className={styles.secondaryButton} onClick={() => setIsConfirmingDelete(true)}>Delete</button>
      </div>
      {isSharing ? <SharePanel template={template} library={library} /> : null}
      {isConfirmingDelete ? (
        <div className={styles.buttonRow} role="alertdialog" aria-label={`Delete ${template.name}?`}>
          <p className={styles.noticeText}>{`Delete “${template.name}”? This cannot be undone.`}</p>
          <button type="button" className={styles.actionButton} onClick={() => library.deleteTemplate(template.id)}>Yes, delete it</button>
          <button type="button" className={styles.secondaryButton} onClick={() => setIsConfirmingDelete(false)}>Keep it</button>
        </div>
      ) : null}
    </li>
  );
}

/** Reads a pasted code or a file's text and saves it as the user's own template. */
function useTemplateImport(library: TemplateLibrary) {
  const [outcome, setOutcome] = useState<ImportOutcome>({ kind: 'idle' });
  function importText(sharedText: string): boolean {
    const importOutcome = importSharedText(sharedText, library);
    setOutcome(importOutcome);
    return importOutcome.kind === 'added';
  }
  function importFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    const chosenFile = changeEvent.target.files?.[0];
    changeEvent.target.value = '';
    if (!chosenFile) return;
    chosenFile.text().then(importText, () => setOutcome({ kind: 'failed', message: 'That file could not be read. Try choosing it again.' }));
  }
  return { outcome, importText, importFile };
}

/** "Add something someone shared": paste a change template code or a task code, or choose either kind of file. */
function ImportPanel({ library }: { library: TemplateLibrary }) {
  const codeFieldId = useId();
  const fileFieldId = useId();
  const [pastedText, setPastedText] = useState('');
  const { outcome, importText, importFile } = useTemplateImport(library);
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Add something someone shared</h3>
      <p className={styles.hint}>A change template code, or a task code — including the one Toolbox copies with “Share all”.</p>
      <label className={styles.fieldLabel} htmlFor={codeFieldId}>Paste a template code</label>
      <textarea id={codeFieldId} className={styles.textArea} value={pastedText} placeholder="SNOWWIZ-TEMPLATE-1:… or SNOWWIZ-CTASKS-1:…" onChange={(changeEvent) => setPastedText(changeEvent.target.value)} />
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={() => { if (importText(pastedText)) setPastedText(''); }}>Add this template</button>
      </div>
      <label className={styles.fieldLabel} htmlFor={fileFieldId}>Or choose a template file</label>
      <input id={fileFieldId} type="file" accept=".json,application/json" onChange={importFile} />
      {outcome.kind === 'added' ? <p className={styles.successText} role="status">{outcome.message}</p> : null}
      {outcome.kind === 'failed' ? <p className={styles.errorText} role="alert">{outcome.message}</p> : null}
    </div>
  );
}

/** The "Your templates" screen. */
export default function TemplatesScreen({ library, onUseTemplate, onBack, useLabel }: TemplatesScreenProps) {
  return (
    <section aria-labelledby="templates-heading">
      <h2 id="templates-heading" className={shellStyles.cardTitle}>Your templates</h2>
      <p className={styles.stepIntro}>A template remembers a change’s details, plan, environments and tasks. Share one with your team by sending its code or file.</p>
      {library.templates.length === 0
        ? <p className={styles.hint}>You have no templates yet. Start from a change you’ve raised before, then press “Save as template”.</p>
        : null}
      <ul className={styles.itemList} aria-label="Saved templates">
        {library.templates.map((template) => <TemplateCard key={template.id} template={template} library={library} onUseTemplate={onUseTemplate} useLabel={useLabel} />)}
      </ul>
      <TaskTemplatesSection library={library} />
      <ImportPanel library={library} />
      <div className={styles.buttonRow}><button type="button" className={shellStyles.secondaryButton} onClick={onBack}>Back</button></div>
    </section>
  );
}
