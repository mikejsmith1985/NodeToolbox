// IntakeReviewTable.tsx — The one table the PO reviews in an Epic Intake: every item with its kind, owner, DENP Epic,
// label and draft already filled in. The PO changes only what they disagree with, then clicks Create (GH #387).
//
// Rows that need a look come first. Items that are not work sit in a collapsed "Also in the notes" group, where the
// Kind choice can still turn one back into work — nothing from the notes is ever hidden.

import type { EpicIntake } from '../epicIntakeModel.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import {
  ReviewDraftCell,
  ReviewEpicCell,
  ReviewItemCell,
  ReviewKindCell,
  ReviewLabelCell,
  ReviewOutcomeCell,
  ReviewOwnerCell,
} from './IntakeReviewCells.tsx';
import { SET_ASIDE_REASON_LABELS } from './intakeLabels.ts';
import { buildReviewRows, countReviewBuckets, formatReviewCounts, type ReviewRow } from './intakeReviewRows.ts';

interface IntakeReviewTableProps {
  intake: EpicIntake;
  isAiUnlocked: boolean;
  jiraBaseUrl: string;
  onChange: (intake: EpicIntake) => void;
  nowIso: () => string;
}

interface ReviewRowsTableProps extends Omit<IntakeReviewTableProps, 'isAiUnlocked' | 'jiraBaseUrl'> {
  rows: readonly ReviewRow[];
  accessibleName: string;
}

/** One table of rows, with the same columns for the work group and the "Also in the notes" group. */
function ReviewRowsTable({ rows, accessibleName, intake, onChange, nowIso }: ReviewRowsTableProps) {
  return (
    <div className={styles.intakeTableScroller}>
      <table className={styles.intakeTable} aria-label={accessibleName}>
        <thead>
          <tr>
            <th>Item</th><th>Kind</th><th>Owner</th><th>{intake.targetProjectKey} Epic</th><th>Label</th><th>Draft</th><th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cellProps = { intake, item: row.item, onChange, nowIso };
            return (
              <tr key={row.item.id} className={row.needsAttention ? styles.intakeReviewRowAttention : undefined}>
                <ReviewItemCell intake={intake} row={row} />
                <ReviewKindCell {...cellProps} />
                <ReviewOwnerCell {...cellProps} />
                <ReviewEpicCell {...cellProps} />
                <ReviewLabelCell {...cellProps} />
                <ReviewDraftCell {...cellProps} />
                <ReviewOutcomeCell row={row} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The lines deliberately left out of every item, each with its reason, collapsed. */
function SetAsideLines({ intake }: { intake: EpicIntake }) {
  if (intake.setAsideLines.length === 0) {
    return null;
  }
  return (
    <details>
      <summary className={styles.intakeSummaryGroupTitle}>{intake.setAsideLines.length} line(s) set aside</summary>
      <ul className={styles.intakeLineList}>
        {intake.setAsideLines.map((setAside) => (
          <li key={setAside.lineNumber}>
            [{setAside.lineNumber}] {intake.lines.find((line) => line.lineNumber === setAside.lineNumber)?.text} — {SET_ASIDE_REASON_LABELS[setAside.reason]}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The review table: the count line, the work rows, the "Also in the notes" group and the lines set aside. */
export default function IntakeReviewTable({ intake, isAiUnlocked, jiraBaseUrl, onChange, nowIso }: IntakeReviewTableProps) {
  const { workRows, otherRows } = buildReviewRows(intake, isAiUnlocked, jiraBaseUrl);
  const tableProps = { intake, onChange, nowIso };
  return (
    <section className={styles.intakeReviewSection} aria-label="Review the items">
      <p className={styles.intakeReviewCounts}>{formatReviewCounts(countReviewBuckets(workRows))}</p>
      <ReviewRowsTable {...tableProps} rows={workRows} accessibleName="Work items" />
      {otherRows.length > 0 ? (
        <details>
          <summary className={styles.intakeSummaryGroupTitle}>Also in the notes ({otherRows.length})</summary>
          <ReviewRowsTable {...tableProps} rows={otherRows} accessibleName="Also in the notes" />
        </details>
      ) : null}
      <SetAsideLines intake={intake} />
    </section>
  );
}
