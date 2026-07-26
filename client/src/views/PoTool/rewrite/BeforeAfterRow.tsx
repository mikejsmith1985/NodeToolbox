// BeforeAfterRow.tsx — One issue's before/after in the review grid (spec 030, US2).
//
// The captured "before" is read-only (it is a record of what the ticket said when the batch started).
// The proposed "after" is fully editable: the reviewing PO — or the operator — can rewrite any word, and
// an edit re-opens an already-approved item for a fresh look so nothing is submitted that was silently
// changed after approval (FR-023). Nothing here reaches Jira; edits live in the batch until submit.

import type { ItemState, RewriteItem } from './rewriteBatchModel';
import styles from './rewrite.module.css';

interface BeforeAfterRowProps {
  item: RewriteItem;
  /** Hands the caller a fully-updated item to persist. */
  onChange: (nextItem: RewriteItem) => void;
}

/** The states a reviewer can set by hand from this row. */
const REVIEW_ACTIONS: { state: ItemState; label: string }[] = [
  { state: 'approved', label: 'Approve' },
  { state: 'rejected', label: 'Reject' },
  { state: 'reviewing', label: 'Reviewing' },
];

/** A friendly label for the current state chip. */
const STATE_LABELS: Record<ItemState, string> = {
  captured: 'Captured',
  proposed: 'Proposed',
  reviewing: 'Reviewing',
  approved: 'Approved',
  rejected: 'Rejected',
  changed: 'Changed in Jira',
  submitted: 'Submitted',
  failed: 'Failed',
};

export default function BeforeAfterRow({ item, onChange }: BeforeAfterRowProps) {
  /** Applies a proposal edit; any edit re-opens an approved item for review (FR-023). */
  function editProposal(patch: { description?: string; acceptanceCriteria?: string }): void {
    if (!item.proposed) {
      return;
    }
    const nextState: ItemState = item.state === 'approved' ? 'reviewing' : item.state;
    onChange({
      ...item,
      state: nextState,
      proposed: { ...item.proposed, ...patch, isEdited: true },
    });
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.rowKey}>{item.jiraKey}</span>
        <div className={styles.rowStateControls}>
          <span className={styles.stateChip}>{STATE_LABELS[item.state]}</span>
          {item.proposed?.isEdited ? <span className={styles.editedTag}>Edited</span> : null}
          {REVIEW_ACTIONS.map((action) => (
            <button
              key={action.state}
              type="button"
              className={styles.secondaryButton}
              disabled={!item.proposed}
              onClick={() => onChange({ ...item, state: action.state })}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {item.captureError ? (
        <p className={styles.errorBanner}>Could not capture this issue: {item.captureError}</p>
      ) : null}

      <div className={styles.cols}>
        <div>
          <p className={styles.colLabel}>Before (captured)</p>
          <div className={styles.beforeText}>
            <strong>{item.original.summary}</strong>
            {'\n\n'}
            {item.original.description}
            {'\n\n'}
            Acceptance Criteria:
            {'\n'}
            {item.original.acceptanceCriteria}
          </div>
        </div>

        <div>
          <p className={styles.colLabel}>After (proposed description + acceptance criteria)</p>
          {item.proposed ? (
            <>
              <label className={styles.fieldLabel} htmlFor={`after-desc-${item.jiraKey}`}>
                Proposed description
              </label>
              <textarea
                id={`after-desc-${item.jiraKey}`}
                className={styles.textAreaTall}
                value={item.proposed.description}
                onChange={(changeEvent) => editProposal({ description: changeEvent.target.value })}
              />
              <label className={styles.fieldLabel} htmlFor={`after-ac-${item.jiraKey}`}>
                Proposed acceptance criteria
              </label>
              <textarea
                id={`after-ac-${item.jiraKey}`}
                className={styles.textArea}
                value={item.proposed.acceptanceCriteria}
                onChange={(changeEvent) => editProposal({ acceptanceCriteria: changeEvent.target.value })}
              />
            </>
          ) : (
            <p className={styles.helpText}>Not yet re-written — generate the re-write above.</p>
          )}
        </div>
      </div>
    </div>
  );
}
