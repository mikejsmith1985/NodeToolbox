// TemplateLibraryExport.tsx — "Export all templates for the SNow Wizard": every CHG template and every CTASK template
// in one code or one file, because the Wizard runs inside ServiceNow's site and cannot read this browser storage.

import { useState } from 'react';

import { prepareTemplateLibraryExport } from '../../../snowWizard/change/templateLibraryShare.ts';
import { downloadShareFile } from '../ctaskTemplateShare.ts';
import type { CrgTemplate, CtaskTemplate } from '../hooks/useCrgState.ts';
import styles from '../tabs/CreateChgTab.module.css';

/** Everything saved here: the CHG templates and the CTASK templates they link to (and the ones they don't). */
export interface TemplateLibraryExportProps {
  templates: readonly CrgTemplate[];
  ctaskTemplates: readonly CtaskTemplate[];
}

/** What the last press did: copied, downloaded, or the code shown for copying by hand when the clipboard refused. */
type ExportOutcome = { kind: 'copied' } | { kind: 'downloaded' } | { kind: 'manual'; code: string } | null;

const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Two buttons, and a plain line saying what went and where to put it. */
export function TemplateLibraryExport({ templates, ctaskTemplates }: TemplateLibraryExportProps) {
  const [outcome, setOutcome] = useState<ExportOutcome>(null);
  if (templates.length === 0 && ctaskTemplates.length === 0) return null;
  const exported = prepareTemplateLibraryExport(templates, ctaskTemplates);
  const whatWent = `${countOf(exported.templateCount, 'CHG template')} and ${countOf(exported.taskCount, 'CTASK template')}`;

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(exported.code);
      setOutcome({ kind: 'copied' });
    } catch {
      setOutcome({ kind: 'manual', code: exported.code });
    }
  }

  return (
    <div className={styles.linkedCtaskSection}>
      <h5 className={styles.panelSectionTitle}>Export all templates for the SNow Wizard</h5>
      <p className={styles.panelHint}>
        {`Takes all ${whatWent}, links included, to the SNow Wizard. In the Wizard open “Your templates” and choose the file `
          + '(or paste the code). Templates it already has by name are left as they are.'}
      </p>
      <div className={styles.buttonRow}>
        <button className={styles.secondaryButton} onClick={() => { downloadShareFile(exported.file); setOutcome({ kind: 'downloaded' }); }} type="button">
          Download all templates
        </button>
        <button className={styles.secondaryButton} onClick={() => void copyCode()} type="button">Copy all as a code</button>
      </div>
      {outcome?.kind === 'downloaded' ? <p className={styles.successText} role="status">{`Downloaded ${exported.file.fileName} with ${whatWent}. Choose it in the SNow Wizard under “Your templates”.`}</p> : null}
      {outcome?.kind === 'copied' ? <p className={styles.successText} role="status">{`Code for ${whatWent} copied. Paste it in the SNow Wizard under “Your templates”.`}</p> : null}
      {outcome?.kind === 'manual' ? (
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Copy this code (the clipboard was not available)</span>
          <textarea className={styles.textArea} readOnly value={outcome.code} />
        </label>
      ) : null}
      {exported.leftOutNames.length > 0 ? (
        <p className={styles.panelHint} role="alert">{`Left out because they are damaged: ${exported.leftOutNames.join(', ')}. Re-save them, then export again.`}</p>
      ) : null}
    </div>
  );
}
