// useJiraFetch.ts — Hook for loading typed data from the Jira proxy with declarative loading state.

import { useEffect, useState } from 'react';

import { jiraGet } from '../services/jiraApi.ts';

const REQUEST_KEY_SEPARATOR = '::';
const DEFAULT_JIRA_FETCH_ERROR = 'Jira fetch failed';

/** Result state returned by the Jira fetching hook. */
export interface JiraFetchResult<ResponseBody> {
  data: ResponseBody | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches typed data from the Jira proxy and exposes loading, data, and error state.
 * The request re-runs whenever the path changes or refetch is called.
 */
export function useJiraFetch<ResponseBody>(path: string): JiraFetchResult<ResponseBody> {
  const [data, setData] = useState<ResponseBody | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [lastSettledRequestKey, setLastSettledRequestKey] = useState<string | null>(null);
  const requestKey = `${path}${REQUEST_KEY_SEPARATOR}${fetchTrigger}`;
  const isLoading = lastSettledRequestKey !== requestKey;
  const error = lastSettledRequestKey === requestKey ? errorMessage : null;

  useEffect(() => {
    let isCancelled = false;

    jiraGet<ResponseBody>(path)
      .then((result) => {
        if (!isCancelled) {
          setData(result);
          setErrorMessage(null);
          setLastSettledRequestKey(requestKey);
        }
      })
      .catch((caughtError: unknown) => {
        if (!isCancelled) {
          setErrorMessage(
            caughtError instanceof Error ? caughtError.message : DEFAULT_JIRA_FETCH_ERROR,
          );
          setLastSettledRequestKey(requestKey);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [path, requestKey]);

  return {
    data,
    isLoading,
    error,
    refetch: () => setFetchTrigger((previousTrigger) => previousTrigger + 1),
  };
}
