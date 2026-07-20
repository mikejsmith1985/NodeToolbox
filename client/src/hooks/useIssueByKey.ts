// useIssueByKey.ts — Loads one full Jira issue by key with honest, distinguishable outcome states.
//
// Unlike the generic useJiraFetch (which collapses every failure into one error string), this hook
// tells "not found" apart from "no permission" apart from a generic error, so the Quick Issue
// Lookup popup can show the specific, honest message the spec requires. A null key leaves the hook
// idle so the popup can show recents instead of a lookup.
//
// Following the useJiraFetch precedent, idle/loading are DERIVED (never set synchronously in the
// effect); the effect only sets state from its async callbacks once a request settles.

import { useCallback, useEffect, useState } from 'react';

import { extractHttpStatus, fetchIssueByKey } from '../services/issueLookup.ts';
import type { JiraIssue } from '../types/jira.ts';

const REQUEST_KEY_SEPARATOR = '::';
const NOT_FOUND_STATUS = 404;
const NO_PERMISSION_STATUSES = [401, 403];
const DEFAULT_LOOKUP_ERROR = 'Something went wrong loading this issue.';

/** The distinguishable outcomes of a single-issue lookup, driving the popup's honest states. */
export type IssueLookupStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'not-found'
  | 'no-permission'
  | 'error';

/** The terminal states a settled request can carry (idle/loading are derived, never settled). */
type SettledStatus = Exclude<IssueLookupStatus, 'idle' | 'loading'>;

/** A settled lookup outcome tagged with the request that produced it (so stale results are ignored). */
interface SettledLookup {
  requestKey: string;
  issue: JiraIssue | null;
  status: SettledStatus;
  errorMessage: string | null;
}

/** Loading state, resolved issue, and a manual refetch for the Quick Issue Lookup view. */
export interface UseIssueByKeyResult {
  issue: JiraIssue | null;
  status: IssueLookupStatus;
  errorMessage: string | null;
  refetch: () => void;
}

/** Maps a fetch rejection to the honest terminal status by inspecting its HTTP status code. */
function mapErrorToStatus(error: unknown): SettledStatus {
  const httpStatus = extractHttpStatus(error);
  if (httpStatus === NOT_FOUND_STATUS) {
    return 'not-found';
  }
  if (httpStatus !== null && NO_PERMISSION_STATUSES.includes(httpStatus)) {
    return 'no-permission';
  }
  return 'error';
}

/**
 * Fetches the issue named by `issueKey`, re-running whenever the key changes or refetch is called.
 * Returns idle state (and no issue) when the key is null.
 */
export function useIssueByKey(issueKey: string | null): UseIssueByKeyResult {
  const [settled, setSettled] = useState<SettledLookup | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const requestKey = issueKey === null ? null : `${issueKey}${REQUEST_KEY_SEPARATOR}${refetchTrigger}`;

  useEffect(() => {
    if (issueKey === null || requestKey === null) {
      return;
    }
    let isCancelled = false;

    fetchIssueByKey(issueKey)
      .then((loadedIssue) => {
        if (!isCancelled) {
          setSettled({ requestKey, issue: loadedIssue, status: 'loaded', errorMessage: null });
        }
      })
      .catch((caughtError: unknown) => {
        if (isCancelled) return;
        const errorMessage = caughtError instanceof Error ? caughtError.message : DEFAULT_LOOKUP_ERROR;
        setSettled({ requestKey, issue: null, status: mapErrorToStatus(caughtError), errorMessage });
      });

    return () => {
      isCancelled = true;
    };
  }, [issueKey, requestKey]);

  const refetch = useCallback(() => setRefetchTrigger((previousTrigger) => previousTrigger + 1), []);

  // Derive the outward state: idle when no key, loading until the CURRENT request settles.
  const isSettledForCurrentRequest = settled !== null && settled.requestKey === requestKey;
  if (issueKey === null) {
    return { issue: null, status: 'idle', errorMessage: null, refetch };
  }
  if (!isSettledForCurrentRequest) {
    return { issue: null, status: 'loading', errorMessage: null, refetch };
  }
  return { issue: settled.issue, status: settled.status, errorMessage: settled.errorMessage, refetch };
}
