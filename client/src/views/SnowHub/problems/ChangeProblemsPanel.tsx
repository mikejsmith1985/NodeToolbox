// ChangeProblemsPanel.tsx — Finds the PRBs a change's Jira issues mention and links them to the change (Modify).
//
// The scan runs only when asked — saving a change must not reach out to Jira and ServiceNow on its own. Each PRB is
// shown with the issues that mention it and the change it is linked to now; linking points every unlinked PRB at
// this change. A PRB already linked to another change is left alone: a problem holds one change.

import { useState } from 'react';

import { linkProblemToChange, scanIssuesForProblems, type ChangeProblemRow } from './changeProblems.ts';
import styles from '../tabs/CreateChgTab.module.css';

interface ChangeProblemsPanelProps {
  changeSysId: string;
  changeNumber: string;
  /** The Jira issues the change names — the ones scanned for PRB numbers. */
  issueKeys: readonly string[];
}

/** Where one PRB is linked now, in words. */
function describeLink(row: ChangeProblemRow, changeSysId: string): string {
  if (!row.problem) return 'not found in ServiceNow';
  const linkedChange = row.problem.linkedChange;
  if (linkedChange.sysId === '') return 'not linked';
  return linkedChange.sysId === changeSysId ? 'linked to this change' : `linked to ${linkedChange.displayName || 'another change'}`;
}

/** True for a PRB this change can take: in ServiceNow and linked to no change yet. */
function isLinkable(row: ChangeProblemRow): boolean {
  return row.problem !== null && row.problem.linkedChange.sysId === '';
}

/** The PRB scan and link panel for one change. */
export function ChangeProblemsPanel({ changeSysId, changeNumber, issueKeys }: ChangeProblemsPanelProps) {
  const [rows, setRows] = useState<ChangeProblemRow[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const linkableRows = (rows ?? []).filter((row) => isLinkable(row));

  const handleScan = async () => {
    setIsWorking(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      setRows(await scanIssuesForProblems(issueKeys));
    } catch (scanError) {
      setErrorMessage(scanError instanceof Error ? `The scan failed: ${scanError.message}` : 'The scan failed.');
    }
    setIsWorking(false);
  };

  const handleLink = async () => {
    setIsWorking(true);
    const refusals: string[] = [];
    const linkedNumbers: string[] = [];
    for (const row of linkableRows) {
      try {
        await linkProblemToChange((row.problem as NonNullable<ChangeProblemRow['problem']>).sysId, changeSysId);
        linkedNumbers.push(row.prbNumber);
      } catch (linkError) {
        refusals.push(`${row.prbNumber}: ${linkError instanceof Error ? linkError.message : 'ServiceNow refused the link'}`);
      }
    }
    setStatusMessage(linkedNumbers.length > 0 ? `Linked ${linkedNumbers.join(', ')} to ${changeNumber}.` : '');
    setErrorMessage(refusals.length > 0 ? `Not linked — ${refusals.join('; ')}` : '');
    setRows((currentRows) => (currentRows ?? []).map((row) => (linkedNumbers.includes(row.prbNumber) && row.problem
      ? { ...row, problem: { ...row.problem, linkedChange: { sysId: changeSysId, displayName: changeNumber } } }
      : row)));
    setIsWorking(false);
  };

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>Problems (PRBs)</h4>
      <p className={styles.panelHint}>
        Finds PRB numbers in this change&apos;s Jira issues — summary, description, comments and the ServiceNow
        reference — and links each problem to this change through its Change request field.
      </p>
      {issueKeys.length === 0 ? (
        <p className={styles.panelHint}>This change names no Jira issues to scan — add them to its description first.</p>
      ) : (
        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} disabled={isWorking} onClick={() => void handleScan()} type="button">
            Scan Jira issues for PRBs
          </button>
        </div>
      )}
      {rows !== null && rows.length === 0 ? <p className={styles.panelHint}>{`No PRB number found in ${issueKeys.join(', ')}.`}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <>
          <ul className={styles.riskFindingList}>
            {rows.map((row) => (
              <li className={styles.riskFindingItem} key={row.prbNumber}>
                {`${row.prbNumber} · ${row.problem?.shortDescription ?? '—'} · ${row.problem?.stateLabel ?? '—'} — `
                  + `mentioned in ${row.issueKeys.join(', ')} — ${describeLink(row, changeSysId)}`}
              </li>
            ))}
          </ul>
          {linkableRows.length > 0 ? (
            <button className={styles.primaryButton} disabled={isWorking} onClick={() => void handleLink()} type="button">
              {`Link ${linkableRows.length} ${linkableRows.length === 1 ? 'PRB' : 'PRBs'} to ${changeNumber}`}
            </button>
          ) : null}
        </>
      ) : null}
      {statusMessage ? <p className={styles.successText} role="status">{statusMessage}</p> : null}
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
    </div>
  );
}
