// IntakeSummaryTable.tsx — The table for the call: every work item once, with its owner, what happened, its Jira key
// and the sizes the notes stated. Copy puts a real table on the clipboard for email, Teams or Confluence (US5).

import { useState } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import type { EpicIntake, SummaryRow } from '../epicIntakeModel.ts';
import { buildSummaryRows, copySummaryTable, SUMMARY_ACTION_LABELS } from '../intakeSummary.ts';
import styles from '../EpicIntakeWorkspace.module.css';

/** How long "✓ Copied" stays on the button. */
const COPY_CONFIRMATION_VISIBLE_MS = 2000;

interface IntakeSummaryTableProps {
  intake: EpicIntake;
  jiraBaseUrl: string;
}

function SummaryRows({ rows }: { rows: readonly SummaryRow[] }) {
  return (
    <div className={styles.intakeTableScroller}>
      <table className={styles.intakeTable}>
        <thead>
          <tr><th>Item</th><th>Owner</th><th>Action</th><th>Jira key</th><th>Label</th><th>Stated sizes</th><th>Reason</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemId}>
              <td>{row.itemTitle}</td>
              <td>{row.owner ?? '—'}</td>
              <td>{SUMMARY_ACTION_LABELS[row.action]}</td>
              <td>{row.jiraKey && row.jiraUrl ? <a href={row.jiraUrl} target="_blank" rel="noreferrer">{row.jiraKey}</a> : '—'}</td>
              <td>{row.label ?? '—'}</td>
              <td>{row.statedSizes}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The summary of every item, with the non-work items collapsed underneath so nothing silently vanishes. */
export default function IntakeSummaryTable({ intake, jiraBaseUrl }: IntakeSummaryTableProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const { workRows, otherRows } = buildSummaryRows(intake, jiraBaseUrl);

  async function handleCopy(): Promise<void> {
    try {
      await copySummaryTable(workRows);
      setCopyMessage('✓ Copied');
    } catch {
      setCopyMessage('Copy was blocked by the browser — select the table and copy it instead.');
    }
    window.setTimeout(() => setCopyMessage(null), COPY_CONFIRMATION_VISIBLE_MS);
  }

  return (
    <section className={compositionStyles.panel} aria-label="Summary">
      <div className={styles.intakeActions}>
        <h3 className={compositionStyles.panelTitle}>Summary</h3>
        <button type="button" className={compositionStyles.secondaryButton} onClick={handleCopy}>📋 Copy table</button>
        {copyMessage ? <span className={styles.intakeCount}>{copyMessage}</span> : null}
      </div>
      <SummaryRows rows={workRows} />
      {otherRows.length > 0 ? (
        <details>
          <summary className={styles.intakeSummaryGroupTitle}>Also in the notes ({otherRows.length})</summary>
          <SummaryRows rows={otherRows} />
        </details>
      ) : null}
    </section>
  );
}
