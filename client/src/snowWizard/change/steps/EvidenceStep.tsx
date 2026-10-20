// EvidenceStep.tsx — Step "Add proof": tick the files already on the change's Jira issues, and optionally add files from this computer.
//
// Jira ticks are remembered in the job. Local files stay in this window only (a browser cannot keep them across a
// reload), so a resumed job asks for them again. A set too big for ServiceNow is refused here, with the limit stated,
// before anything is uploaded.

import { useId, useState } from 'react';

import { formatByteSize } from '../../../views/SnowHub/testEvidence/evidenceBundle.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { checkEvidenceSize } from '../evidenceUpload.ts';
import { sumJiraEvidenceBytes } from '../jiraEvidence.ts';
import { useTickedJiraEvidence } from '../jiraEvidenceChoiceStore.ts';
import JiraEvidencePicker from './JiraEvidencePicker.tsx';

/** Evidence also needs the job (for its remembered Jira ticks) and the local files chosen in this window. */
export interface EvidenceStepProps extends ChangeStepProps {
  jobId: string;
  evidenceFiles: readonly File[];
  onEvidenceFilesChange: (files: File[]) => void;
}

/** The change's Jira issue keys, in a steady order. */
function readIssueKeys(selectedIssueKeys: ReadonlySet<string>): string[] {
  return [...selectedIssueKeys].sort();
}

/** The evidence step: Jira files first, then local files. */
export default function EvidenceStep({ jobId, crg, session, updateSession, evidenceFiles, onEvidenceFilesChange }: EvidenceStepProps) {
  const fileInputId = useId();
  const [sizeProblem, setSizeProblem] = useState('');
  const tickedJiraEvidence = useTickedJiraEvidence(jobId, crg.state.selectedIssueKeys);
  const hasLostFiles = evidenceFiles.length === 0 && session.evidenceFileNames.length > 0;
  const localBytes = evidenceFiles.reduce((runningTotal, file) => runningTotal + file.size, 0);

  function applyFiles(nextFiles: File[]) {
    const problem = checkEvidenceSize(nextFiles, sumJiraEvidenceBytes(tickedJiraEvidence));
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
      <JiraEvidencePicker jobId={jobId} issueKeys={readIssueKeys(crg.state.selectedIssueKeys)} localBytes={localBytes} />
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Files from this computer</h3>
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
    </div>
  );
}
