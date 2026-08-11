// AddWorkDialog.tsx — Creates a new issue under a Feature, without leaving the board.
//
// Deliberately small. The value here is not a full create screen — Jira already has one — it is that
// the new issue arrives already carrying the Feature Link and the PI, so it shows up in the lane you
// created it from instead of vanishing into the gap this board spent two releases learning to detect.
//
// Anything more than type and summary belongs in the issue panel afterwards, where every field is
// already editable.

import { useState } from 'react';

import type { CreateMetaIssueType } from '../../../../types/jira.ts';
import styles from '../RollupBoardTab.module.css';

export interface AddWorkDialogProps {
  /** The Feature the new issue will roll up to, and the lane it will appear in. */
  featureKey: string;
  featureSummary: string;
  /** Issue types this project offers, sub-task types already removed by the caller. */
  issueTypes: readonly CreateMetaIssueType[];
  /** What the PI field will be set to, shown so it is never a surprise. Empty when not PI-scoped. */
  piValue: string;
  isSaving: boolean;
  /** Set when the last attempt failed, so the reason sits beside the button that caused it. */
  errorMessage: string | null;
  onCancel: () => void;
  onCreate: (issueTypeId: string, summary: string) => void;
}

/** The inline "add work to this Feature" form shown from a lane header. */
export function AddWorkDialog({
  featureKey,
  featureSummary,
  issueTypes,
  piValue,
  isSaving,
  errorMessage,
  onCancel,
  onCreate,
}: AddWorkDialogProps) {
  const [issueTypeId, setIssueTypeId] = useState(issueTypes[0]?.id ?? '');
  const [summary, setSummary] = useState('');

  const canCreate = !isSaving && issueTypeId !== '' && summary.trim() !== '';

  return (
    <div className={styles.panelCard} data-testid={`rollup-add-work-${featureKey}`}>
      <h4 className={styles.sectionTitle}>Add work to {featureKey}</h4>
      <p className={styles.fieldLabel}>{featureSummary}</p>

      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor={`add-work-type-${featureKey}`}>Type</label>
        <select
          className={styles.inputField}
          disabled={isSaving}
          id={`add-work-type-${featureKey}`}
          onChange={(changeEvent) => setIssueTypeId(changeEvent.target.value)}
          value={issueTypeId}
        >
          {issueTypes.map((issueType) => (
            <option key={issueType.id} value={issueType.id}>{issueType.name}</option>
          ))}
        </select>
      </div>

      <div className={styles.editorRow}>
        <label className={styles.fieldLabel} htmlFor={`add-work-summary-${featureKey}`}>Summary</label>
        <input
          className={styles.inputField}
          disabled={isSaving}
          id={`add-work-summary-${featureKey}`}
          onChange={(changeEvent) => setSummary(changeEvent.target.value)}
          placeholder="What needs doing?"
          value={summary}
        />
      </div>

      {/* Stated rather than assumed: these two fields are the reason the issue will be visible here. */}
      <p className={styles.fieldLabel}>
        Will be created with <strong>Feature Link {featureKey}</strong>
        {piValue ? <> and <strong>PI {piValue}</strong></> : null}, so it appears in this lane.
      </p>

      {errorMessage !== null && <p className={styles.editorError}>{errorMessage}</p>}

      <div className={styles.boardActions}>
        <button
          className={styles.actionButton}
          disabled={!canCreate}
          onClick={() => onCreate(issueTypeId, summary)}
          type="button"
        >
          {isSaving ? 'Creating…' : 'Create'}
        </button>
        <button className={styles.actionButton} disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
