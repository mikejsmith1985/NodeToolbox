// EvidenceSweepCard.tsx — "Sweep Jira and attach the test evidence": one button that finds every file, zips it, attaches
// the zip, and then says plainly how many issues were swept, how many files were found and zipped, and where it went on.
//
// Used wherever evidence is missing: the last step's "not on CHG… yet" card and the modify short cut, so attaching the
// evidence never needs files picked by hand (owner, GH #475).

import { useState } from 'react';

import { formatByteSize } from '../../../views/SnowHub/testEvidence/evidenceBundle.ts';
import styles from '../ChangeWizard.module.css';
import { describeFilesByIssue, listAttachedChanges, runEvidenceSweep, type EvidenceSweepReport } from '../evidenceSweep.ts';

/** What the card needs: the changes to attach to and the Jira issues to start from. */
export interface EvidenceSweepCardProps {
  changeNumbers: readonly string[];
  issueKeys: readonly string[];
  /** Told once a sweep finishes, so the job can record each change's result. */
  onSwept?: (report: EvidenceSweepReport) => void;
}

type SweepState =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'done'; report: EvidenceSweepReport }
  | { kind: 'failed'; message: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The confirmation: swept, found, zipped, attached — each a line of its own. */
function SweepSummary({ report }: { report: EvidenceSweepReport }) {
  const attachedChanges = listAttachedChanges(report);
  const failedChanges = Object.entries(report.results).filter(([changeNumber]) => !attachedChanges.includes(changeNumber));
  const issueCount = new Set(report.foundFiles.map((evidence) => evidence.issueKey)).size;
  return (
    <div role="status" aria-label="Evidence sweep result">
      <p className={styles.hint}>{`🔎 Swept ${plural(report.sweptIssueKeys.length, 'Jira issue')}: ${report.sweptIssueKeys.join(', ') || 'none'}`
        + `${report.wereLinksSkipped ? ' (the issues and their sub-tasks; Jira would not search linked issues)' : ' (the change\'s issues, their sub-tasks and linked issues)'}.`}</p>
      <p className={styles.hint}>{`📄 Found ${plural(report.foundFiles.length, 'file')} on ${plural(issueCount, 'issue')}.`}</p>
      {describeFilesByIssue(report).length > 0 ? (
        <ul className={styles.itemList} aria-label="Files found">{describeFilesByIssue(report).map((line) => <li key={line}>{line}</li>)}</ul>
      ) : null}
      {report.zippedFileCount > 0 ? <p className={styles.hint}>{`🗜️ Zipped ${plural(report.zippedFileCount, 'file')} (${formatByteSize(report.archiveByteSize)}).`}</p> : null}
      {attachedChanges.map((changeNumber) => (
        <p key={changeNumber} className={styles.successText}>{`✅ Attached ${report.attachedFileNames[changeNumber] ?? 'the zip'} to ${changeNumber} — ServiceNow confirmed it.`}</p>
      ))}
      {failedChanges.map(([changeNumber, reason]) => <p key={changeNumber} className={styles.errorText}>{`❌ Not attached to ${changeNumber}: ${reason}`}</p>)}
      {report.foundFiles.length === 0 ? <p className={styles.errorText}>No test evidence files are on any of these issues yet. Attach the results in Jira, then sweep again.</p> : null}
      {report.leftOutForSize.length > 0 ? <p className={styles.errorText}>{`Left out because the zip would be too big for ServiceNow: ${report.leftOutForSize.join(', ')}.`}</p> : null}
      {report.problems.map((problem) => <p key={problem} className={styles.errorText}>{problem}</p>)}
    </div>
  );
}

/** The sweep button and what it found. */
export default function EvidenceSweepCard({ changeNumbers, issueKeys, onSwept }: EvidenceSweepCardProps) {
  const [sweepState, setSweepState] = useState<SweepState>({ kind: 'idle' });
  const hasIssues = issueKeys.length > 0;

  async function sweep() {
    setSweepState({ kind: 'working', message: 'Sweeping Jira…' });
    try {
      const report = await runEvidenceSweep(issueKeys, changeNumbers, (message) => setSweepState({ kind: 'working', message }));
      setSweepState({ kind: 'done', report });
      onSwept?.(report);
    } catch (sweepError) {
      setSweepState({ kind: 'failed', message: `Jira could not be searched: ${sweepError instanceof Error ? sweepError.message : String(sweepError)}` });
    }
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{`📎 Test evidence for ${changeNumbers.join(', ')}`}</h3>
      <p className={styles.hint}>
        One press finds every file on this change&apos;s Jira issues, their sub-tasks and linked issues, zips them, and
        attaches the zip to the change.
      </p>
      {hasIssues ? null : <p className={styles.errorText}>This change names no Jira issues, so there is nowhere to look. Choose them on “What&apos;s in this change?”.</p>}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={!hasIssues || sweepState.kind === 'working'} onClick={() => { void sweep(); }}>
          {sweepState.kind === 'done' ? 'Sweep Jira again' : 'Sweep Jira and attach the test evidence'}
        </button>
      </div>
      {sweepState.kind === 'working' ? <p className={styles.hint} role="status">{sweepState.message}</p> : null}
      {sweepState.kind === 'failed' ? <p className={styles.errorText} role="alert">{sweepState.message}</p> : null}
      {sweepState.kind === 'done' ? <SweepSummary report={sweepState.report} /> : null}
    </div>
  );
}
