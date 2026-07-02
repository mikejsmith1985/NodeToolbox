// CommentThread.tsx — Shared, read-only scrollable Jira comment history used everywhere comments show.
//
// This is the single presentation for an issue's comments across the whole app, so the layout,
// ordering, and empty/loading/error states are identical wherever it is used. Comments arrive
// already ordered newest-first (see useIssueComments); this component only renders them.

import type { JiraComment } from '../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import styles from './CommentThread.module.css';

const COMMENTS_LOADING_LABEL = 'Loading comments…';
const NO_COMMENTS_LABEL = 'No comments yet.';
const UNKNOWN_AUTHOR_LABEL = 'Unknown';
// Jira `created` is an ISO-8601 string; the first 10 characters are the YYYY-MM-DD date.
const ISO_DATE_LENGTH = 10;

export interface CommentThreadProps {
  /** The full thread, ordered newest → oldest by the caller (typically useIssueComments). */
  comments: JiraComment[];
  isLoading: boolean;
  loadError: string | null;
  /** Overrides the default empty-state text; kept consistent by default. */
  emptyLabel?: string;
}

/**
 * Renders an issue's comments in a bounded, scrollable window — each with author, date, and
 * normalized plain-text body — plus shared loading, error, and empty states.
 */
export default function CommentThread({
  comments,
  isLoading,
  loadError,
  emptyLabel = NO_COMMENTS_LABEL,
}: CommentThreadProps) {
  if (isLoading) {
    return <p className={styles.commentEmpty}>{COMMENTS_LOADING_LABEL}</p>;
  }
  if (loadError) {
    return <p className={styles.commentError}>{loadError}</p>;
  }
  if (comments.length === 0) {
    return <p className={styles.commentEmpty}>{emptyLabel}</p>;
  }

  return (
    <ul className={styles.commentList}>
      {comments.map((comment) => (
        <li className={styles.commentItem} key={comment.id}>
          <div className={styles.commentMeta}>
            <span className={styles.commentAuthor}>{comment.author?.displayName ?? UNKNOWN_AUTHOR_LABEL}</span>
            <span className={styles.commentDate}>{comment.created?.slice(0, ISO_DATE_LENGTH) ?? ''}</span>
          </div>
          <p className={styles.commentBody}>{normalizeRichTextToPlainText(comment.body)}</p>
        </li>
      ))}
    </ul>
  );
}
