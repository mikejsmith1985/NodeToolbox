// IssueComments.tsx — Connected comment window: loads a thread on demand and renders it.
//
// This is the one-line way for any view to show an issue's full, newest-first comment history:
// it wires the shared useIssueComments hook to the shared CommentThread presentation. Views render
// it only when they have an issue key, so the hook mounts/unmounts with the surrounding card.

import { useIssueComments } from '../../hooks/useIssueComments.ts';
import CommentThread from './CommentThread.tsx';

export interface IssueCommentsProps {
  /** The Jira issue key whose comment thread should be shown. */
  issueKey: string;
  /** Optional override for the empty-state text; kept consistent by default. */
  emptyLabel?: string;
}

/** Loads and renders one issue's full comment thread (newest-first, scrollable). */
export default function IssueComments({ issueKey, emptyLabel }: IssueCommentsProps) {
  const { comments, isLoading, loadError } = useIssueComments(issueKey);
  return (
    <CommentThread
      comments={comments}
      isLoading={isLoading}
      loadError={loadError}
      emptyLabel={emptyLabel}
    />
  );
}
