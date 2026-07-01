// IntakeQueue.tsx — Renders the parsed submissions newest-first with the full captured detail
// (summary + description + acceptance criteria, issue type, priority, team), the submitter,
// timestamp, per-row state badge, created Jira key, and any blocking reason. See FR-2.1/2.4.

import styles from '../JiraIntake.module.css';
import type { QueueEntry, QueueEntryState } from '../lib/intakeTypes.ts';
import type { IntakeQueueCounts } from '../hooks/useIntakeQueue.ts';

interface IntakeQueueProps {
  entries: QueueEntry[];
  counts: IntakeQueueCounts;
  /** In review-and-pick mode, each new row shows Create / Dismiss actions. */
  isReviewMode?: boolean;
  onCreate?: (entry: QueueEntry) => void;
  onDismiss?: (entry: QueueEntry) => void;
}

const STATE_LABEL: Record<QueueEntryState, string> = {
  new: 'New',
  invalid: 'Invalid',
  creating: 'Creating…',
  imported: 'Imported',
  failed: 'Failed',
  skipped: 'Skipped',
};

const STATE_BADGE_CLASS: Record<QueueEntryState, string> = {
  new: styles.badgeNew,
  invalid: styles.badgeInvalid,
  creating: styles.badgeNew,
  imported: styles.badgeImported,
  failed: styles.badgeFailed,
  skipped: styles.badgeSkipped,
};

/** The newest-first queue table showing every captured field. Empty until a file is imported. */
export default function IntakeQueue({ entries, counts, isReviewMode = false, onCreate, onDismiss }: IntakeQueueProps) {
  if (entries.length === 0) {
    return <p className={styles.emptyState}>No submissions yet. Import an exported file to get started.</p>;
  }

  return (
    <div>
      <div className={styles.countsBar} data-testid="queue-counts">
        <span>{counts.total} total</span>
        <span>{counts.newCount} new</span>
        <span>{counts.imported} imported</span>
        <span>{counts.invalid} invalid</span>
      </div>
      <table className={styles.queueTable}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Summary &amp; details</th>
            <th>Type</th>
            <th>Priority</th>
            <th>Team</th>
            <th>Submitter</th>
            <th>Submitted</th>
            <th>Jira key</th>
            {isReviewMode && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.submission.id || entry.submission.rowIndex} data-testid="queue-row">
              <td>
                <span className={`${styles.badge} ${STATE_BADGE_CLASS[entry.state]}`}>
                  {STATE_LABEL[entry.state]}
                </span>
                {entry.blockingReasons.length > 0 && (
                  <div className={styles.reason}>{entry.blockingReasons.join('; ')}</div>
                )}
              </td>
              <td>
                <div className={styles.summaryText}>{entry.submission.fields.summary || <em>(no summary)</em>}</div>
                {entry.submission.fields.description && (
                  <div className={styles.detailText}>{entry.submission.fields.description}</div>
                )}
                {entry.submission.fields.acceptanceCriteria && (
                  <div className={styles.detailText}>
                    <span className={styles.detailLabel}>AC:</span> {entry.submission.fields.acceptanceCriteria}
                  </div>
                )}
              </td>
              <td>{entry.submission.fields.issueType || '—'}</td>
              <td>{entry.submission.fields.priority || '—'}</td>
              <td>{entry.submission.fields.project || '—'}</td>
              <td>{entry.submission.submitter.displayName || entry.submission.submitter.email || '—'}</td>
              <td>{entry.submission.submittedAt || '—'}</td>
              <td>{entry.jiraKey ?? '—'}</td>
              {isReviewMode && (
                <td>
                  {entry.state === 'new' && (
                    <>
                      <button className={styles.secondaryButton} onClick={() => onCreate?.(entry)} type="button">Create</button>
                      {' '}
                      <button className={styles.secondaryButton} onClick={() => onDismiss?.(entry)} type="button">Dismiss</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
