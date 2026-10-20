// EvidenceStep.tsx — Step 6 "Add proof": choose the test evidence files to attach once the changes exist.
//
// Files stay in this window only (a browser cannot keep them across a reload), so a resumed job asks for them again.
// A set too big for ServiceNow is refused here, with the limit stated, before anything is uploaded.

import { useId, useState } from 'react';

import { formatByteSize } from '../../../views/SnowHub/testEvidence/evidenceBundle.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { checkEvidenceSize } from '../evidenceUpload.ts';

/** Evidence also needs the files chosen in this window. */
export interface EvidenceStepProps extends ChangeStepProps {
  evidenceFiles: readonly File[];
  onEvidenceFilesChange: (files: File[]) => void;
}

/** Step 6: the evidence files. */
export default function EvidenceStep({ session, updateSession, evidenceFiles, onEvidenceFilesChange }: EvidenceStepProps) {
  const fileInputId = useId();
  const [sizeProblem, setSizeProblem] = useState('');
  const hasLostFiles = evidenceFiles.length === 0 && session.evidenceFileNames.length > 0;

  function applyFiles(nextFiles: File[]) {
    const problem = checkEvidenceSize(nextFiles);
    setSizeProblem(problem ?? '');
    if (problem) return;
    onEvidenceFilesChange(nextFiles);
    updateSession({ evidenceFileNames: nextFiles.map((file) => file.name) });
  }

  return (
    <div>
      <p className={styles.stepIntro}>
        Add the files that show this change was tested (optional). They are put on each change as soon as it is created.
      </p>
      {hasLostFiles ? <p className={styles.noticeText}>{`Choose the files again (${session.evidenceFileNames.join(', ')}) — files are not kept when the window closes.`}</p> : null}
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor={fileInputId}>Choose evidence files</label>
        <input id={fileInputId} type="file" multiple onChange={(changeEvent) => {
          applyFiles([...evidenceFiles, ...Array.from(changeEvent.target.files ?? [])]);
          changeEvent.target.value = '';
        }} />
      </div>
      {sizeProblem ? <p className={styles.errorText}>{sizeProblem}</p> : null}
      <ul className={styles.itemList} aria-label="Chosen files">
        {evidenceFiles.map((file, fileIndex) => (
          <li key={`${file.name}-${fileIndex}`} className={styles.checkboxRow}>
            {`${file.name} (${formatByteSize(file.size)})`}
            <button type="button" className={styles.secondaryButton} onClick={() => applyFiles(evidenceFiles.filter((_, keptIndex) => keptIndex !== fileIndex))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
