// BulkCommentPanel.tsx — Sticky panel for posting the same comment to multiple issues.
//
// Appears at the bottom of the issue list when bulk mode is active.
// Shows how many issues are selected, a textarea for the comment text,
// and Post / Cancel actions. Calls onPostBulkComment with the trimmed text.

import { useState } from 'react';

import styles from './BulkCommentPanel.module.css';

// ── Props ──

export interface BulkCommentPanelProps {
  selectedCount: number;
  /** The issue keys that will receive the comment. */
  selectedKeys: string[];
  isBulkPostingComment: boolean;
  bulkCommentError: string | null;
  onPostBulkComment: (commentText: string) => void;
  onCancelBulk: () => void;
}

// ── Component ──

/**
 * Renders a sticky footer panel that lets the user type a comment and post it
 * to all currently bulk-selected Jira issues in a single action.
 */
export default function BulkCommentPanel({
  selectedCount,
  selectedKeys,
  isBulkPostingComment,
  bulkCommentError,
  onPostBulkComment,
  onCancelBulk,
}: BulkCommentPanelProps) {
  const [commentText, setCommentText] = useState('');

  const isTrimmedEmpty = commentText.trim().length === 0;

  function handleSubmit() {
    const trimmedText = commentText.trim();
    if (trimmedText.length === 0) return;
    onPostBulkComment(trimmedText);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.selectedCount}>{selectedCount} issues selected</span>
        {selectedKeys.length > 0 && (
          <span className={styles.selectedKeys}>{selectedKeys.slice(0, 5).join(', ')}{selectedKeys.length > 5 ? ` +${selectedKeys.length - 5} more` : ''}</span>
        )}
      </div>

      <textarea
        aria-label="Bulk comment text"
        className={styles.textarea}
        disabled={isBulkPostingComment}
        onChange={(changeEvent) => setCommentText(changeEvent.target.value)}
        placeholder="Type a comment to add to all selected issues…"
        value={commentText}
      />

      {bulkCommentError && (
        <div className={styles.errorMessage}>{bulkCommentError}</div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.submitButton}
          disabled={isTrimmedEmpty || isBulkPostingComment}
          onClick={handleSubmit}
          type="button"
        >
          {isBulkPostingComment && <span aria-hidden="true" className={styles.spinner} />}
          {isBulkPostingComment ? 'Posting…' : 'Post Comment'}
        </button>
        <button
          className={styles.cancelButton}
          disabled={isBulkPostingComment}
          onClick={onCancelBulk}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
