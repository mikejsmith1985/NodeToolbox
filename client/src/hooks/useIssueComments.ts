// useIssueComments.ts — Shared hook that loads an issue's full Jira comment thread on demand.
//
// Every comment-display location in the app uses this so "all comments" is guaranteed regardless of
// thread size: it always fetches the dedicated comment endpoint (which returns the complete thread)
// rather than trusting the possibly-truncated comments carried in a list/issue payload. Comments are
// returned newest-first so the most recent is what the user sees first, matching Jira's own ordering.

import { useCallback, useEffect, useState } from 'react';

import { jiraGet } from '../services/jiraApi.ts';
import type { JiraComment } from '../types/jira.ts';

const COMMENT_LOAD_ERROR_MESSAGE = 'Failed to load comments';

/** State returned to a comment-display location: the ordered thread plus load status and a refresh. */
export interface CommentThreadState {
  /** The complete thread, ordered newest → oldest. */
  comments: JiraComment[];
  isLoading: boolean;
  loadError: string | null;
  /** Re-fetches the thread (e.g. after the user posts a new comment). */
  refresh: () => void;
}

/** Sorts comments newest-first by their `created` timestamp without mutating the input array. */
function sortNewestFirst(comments: JiraComment[]): JiraComment[] {
  return [...comments].sort((first, second) => {
    const firstTime = first.created ? Date.parse(first.created) : 0;
    const secondTime = second.created ? Date.parse(second.created) : 0;
    return secondTime - firstTime;
  });
}

/**
 * Fetches the full comment thread for one issue on demand and keeps it newest-first.
 * Re-runs whenever the issue key changes or the caller invokes `refresh()`.
 */
export function useIssueComments(issueKey: string): CommentThreadState {
  const [comments, setComments] = useState<JiraComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumping this token re-runs the fetch effect so a freshly posted comment appears.
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((currentToken) => currentToken + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadComments() {
      // Show the loading state each time we (re)fetch — on mount, key change, or refresh().
      setIsLoading(true);
      try {
        const response = await jiraGet<{ comments: JiraComment[] }>(`/rest/api/2/issue/${issueKey}/comment`);
        if (!isMounted) {
          return;
        }
        setComments(sortNewestFirst(response.comments ?? []));
        setLoadError(null);
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        const errorMessage = caughtError instanceof Error ? caughtError.message : COMMENT_LOAD_ERROR_MESSAGE;
        setComments([]);
        setLoadError(errorMessage);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadComments();

    // The mounted guard drops a late response from a superseded issue key or after unmount,
    // so stale results never overwrite the current thread.
    return () => {
      isMounted = false;
    };
  }, [issueKey, refreshToken]);

  return { comments, isLoading, loadError, refresh };
}
