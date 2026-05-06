// useSnowFetch.ts — Hook for loading typed data from the ServiceNow proxy with declarative loading state.

import { useEffect, useState } from 'react';

import { snowFetch } from '../services/snowApi.ts';

const REQUEST_KEY_SEPARATOR = '::';
const DEFAULT_SNOW_FETCH_ERROR = 'SNow fetch failed';

/** Result state returned by the ServiceNow fetching hook. */
export interface SnowFetchResult<ResponseBody> {
  data: ResponseBody | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches typed data from the ServiceNow proxy and exposes loading, data, and error state.
 * Relay-awareness lives inside snowFetch, so this hook stays view-focused.
 */
export function useSnowFetch<ResponseBody>(path: string): SnowFetchResult<ResponseBody> {
  const [data, setData] = useState<ResponseBody | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [lastSettledRequestKey, setLastSettledRequestKey] = useState<string | null>(null);
  const requestKey = `${path}${REQUEST_KEY_SEPARATOR}${fetchTrigger}`;
  const isLoading = lastSettledRequestKey !== requestKey;
  const error = lastSettledRequestKey === requestKey ? errorMessage : null;

  useEffect(() => {
    let isCancelled = false;

    snowFetch<ResponseBody>(path)
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
            caughtError instanceof Error ? caughtError.message : DEFAULT_SNOW_FETCH_ERROR,
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
