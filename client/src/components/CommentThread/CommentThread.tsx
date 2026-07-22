// CommentThread.tsx — Shared, read-only scrollable Jira comment history used everywhere comments show.
//
// This is the single presentation for an issue's comments across the whole app, so the layout,
// ordering, and empty/loading/error states are identical wherever it is used. Comments arrive
// already ordered newest-first (see useIssueComments); this component only renders them.

import { useEffect } from 'react';

import { useCurrentUserMentionKeys } from '../../hooks/useCurrentUserMentionKeys.ts';
import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import type { JiraComment } from '../../types/jira.ts';
import { parseCommentMentions, readMentionDirectoryKey } from '../../utils/jiraMentionFormat.ts';
import CommentBody from './CommentBody.tsx';
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

/** Reads the prefixed directory identifier for a comment author, or null when Jira sent none. */
function readAuthorDirectoryKey(author: JiraComment['author']): string | null {
  if (author?.accountId?.trim()) {
    return `accountId:${author.accountId.trim()}`;
  }
  if (author?.name?.trim()) {
    return `name:${author.name.trim()}`;
  }
  if (author?.key?.trim()) {
    return `key:${author.key.trim()}`;
  }
  return null;
}

/**
 * Makes every person mentioned in the thread resolvable to a name.
 *
 * Comment authors come with their display names already attached, so recording them costs nothing —
 * and because the people mentioned in a thread are usually also the people commenting in it, that
 * alone covers most mentions. Only the remainder is actually looked up.
 */
function useResolveThreadMentions(comments: JiraComment[]): void {
  const seedFromUsers = useMentionDirectoryStore((state) => state.seedFromUsers);
  const resolveMissing = useMentionDirectoryStore((state) => state.resolveMissing);

  useEffect(() => {
    const seedableAuthors = comments
      .map((comment) => ({
        userIdentifier: readAuthorDirectoryKey(comment.author) ?? '',
        displayName: comment.author?.displayName ?? '',
      }))
      .filter((author) => author.userIdentifier !== '' && author.displayName !== '');
    seedFromUsers(seedableAuthors);

    const mentionedKeys = comments.flatMap((comment) =>
      parseCommentMentions(comment.body)
        .filter((run) => run.kind === 'mention')
        .map((run) => readMentionDirectoryKey(run.token)));
    if (mentionedKeys.length > 0) {
      void resolveMissing(mentionedKeys);
    }
  }, [comments, resolveMissing, seedFromUsers]);
}

/**
 * Renders an issue's comments in a bounded, scrollable window — each with author, date, and body
 * (with @-mentions shown as people's names) — plus shared loading, error, and empty states.
 */
export default function CommentThread({
  comments,
  isLoading,
  loadError,
  emptyLabel = NO_COMMENTS_LABEL,
}: CommentThreadProps) {
  useResolveThreadMentions(comments);
  const currentUserDirectoryKeys = useCurrentUserMentionKeys();

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
          <CommentBody body={comment.body} currentUserDirectoryKeys={currentUserDirectoryKeys} />
        </li>
      ))}
    </ul>
  );
}
