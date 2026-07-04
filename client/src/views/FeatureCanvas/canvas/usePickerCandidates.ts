// usePickerCandidates.ts — Fetches candidate features for the canvas's Custom-JQL "add more" path.
//
// The blueprint selection now lives in the reused BlueprintTab (step 1); this hook only serves the
// secondary Custom-JQL source on the board (step 2), so a user can pull in features the blueprint
// doesn't surface. A malformed query surfaces an error and adds nothing.

import { useEffect, useRef, useState } from 'react';

import { fetchFeatureReviewItemsByJql, type FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';

/** Inputs for the Custom-JQL candidate fetch. */
export interface PickerCandidatesInput {
  jql: string;
  /** Bumped when the user runs the query, so it fetches on demand (not per keystroke). */
  runToken: number;
}

/** Candidate items for the custom query, plus lifecycle. */
export interface PickerCandidatesResult {
  status: 'idle' | 'loading' | 'ready' | 'error';
  jqlItems: FeatureReviewItem[];
  error: string | null;
}

/** Fetches feature-review items for the user's custom JQL when they run it. */
export function usePickerCandidates(input: PickerCandidatesInput): PickerCandidatesResult {
  const { runToken } = input;

  // The JQL text is read at fetch time (via a ref) so typing does not refetch — only runToken does.
  const jqlRef = useRef(input.jql);
  useEffect(() => {
    jqlRef.current = input.jql;
  }, [input.jql]);

  const [result, setResult] = useState<{ token: number; status: 'ready' | 'error'; jqlItems: FeatureReviewItem[]; error: string | null }>(
    { token: -1, status: 'ready', jqlItems: [], error: null },
  );

  useEffect(() => {
    if (runToken === 0) {
      return undefined; // nothing run yet
    }
    let isCancelled = false;
    fetchFeatureReviewItemsByJql(jqlRef.current)
      .then((jqlItems) => {
        if (!isCancelled) {
          setResult({ token: runToken, status: 'ready', jqlItems, error: null });
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setResult({ token: runToken, status: 'error', jqlItems: [], error: fetchError instanceof Error ? fetchError.message : 'Failed to load candidates.' });
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [runToken]);

  if (runToken === 0) {
    return { status: 'idle', jqlItems: [], error: null };
  }
  const isResultCurrent = result.token === runToken;
  return {
    status: isResultCurrent ? result.status : 'loading',
    jqlItems: isResultCurrent ? result.jqlItems : [],
    error: isResultCurrent ? result.error : null,
  };
}
