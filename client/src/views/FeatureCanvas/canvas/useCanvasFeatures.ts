// useCanvasFeatures.ts — Loads live data for the canvas's curated working set (the overlay's keys).
//
// The canvas renders the persisted working set — the features the user has chosen and kept — not a
// free-form query result. This hook takes those keys (from the overlay) and fetches their live health,
// completion, child stories, hygiene flags, and issue links via the JQL-scoped Feature Review fetch,
// batching so a large set never silently truncates. Adding/removing keys re-fetches; an empty set
// means an empty canvas. Scope resolution lives in useCanvasScope so the overlay key can be built first.

import { useEffect, useMemo, useState } from 'react';

import { fetchFeatureReviewItemsByJql, type FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';

/** The loading lifecycle of the working-set fetch. */
export type CanvasFeaturesStatus = 'ready' | 'loading' | 'error';

/** The live feature data for the current working set. */
export interface CanvasFeaturesResult {
  status: CanvasFeaturesStatus;
  items: FeatureReviewItem[];
  error: string | null;
}

// The JQL-scoped fetch caps at maxResults=200, so a working set beyond that must be fetched in
// batches and merged — never silently truncated.
const WORKING_SET_FETCH_BATCH_SIZE = 200;

/** Fetches feature-review items for the given keys, batching to respect the 200-result fetch cap. */
async function fetchWorkingSetItems(keys: readonly string[]): Promise<FeatureReviewItem[]> {
  const mergedItems: FeatureReviewItem[] = [];
  for (let batchStart = 0; batchStart < keys.length; batchStart += WORKING_SET_FETCH_BATCH_SIZE) {
    const keyBatch = keys.slice(batchStart, batchStart + WORKING_SET_FETCH_BATCH_SIZE);
    const batchItems = await fetchFeatureReviewItemsByJql(`issuekey in (${keyBatch.join(',')})`);
    mergedItems.push(...batchItems);
  }
  return mergedItems;
}

/** Loads live feature data for the working set identified by the given overlay node keys. */
export function useCanvasFeatures(workingSetKeys: readonly string[]): CanvasFeaturesResult {
  // Sort so the request identity is stable regardless of key insertion order.
  const requestKey = useMemo(() => [...workingSetKeys].sort().join(','), [workingSetKeys]);

  const [result, setResult] = useState<{ key: string; status: 'ready' | 'error'; items: FeatureReviewItem[]; error: string | null }>(
    { key: '__initial__', status: 'ready', items: [], error: null },
  );

  useEffect(() => {
    if (requestKey === '') {
      return undefined; // empty working set — nothing to fetch; derived status below is ready/[]
    }
    let isCancelled = false;
    // setState happens only in the async callbacks, never synchronously in the effect body.
    fetchWorkingSetItems(requestKey.split(','))
      .then((loadedItems) => {
        if (!isCancelled) {
          setResult({ key: requestKey, status: 'ready', items: loadedItems, error: null });
        }
      })
      .catch((loadError: unknown) => {
        if (!isCancelled) {
          setResult({ key: requestKey, status: 'error', items: [], error: loadError instanceof Error ? loadError.message : 'Failed to load features.' });
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [requestKey]);

  if (requestKey === '') {
    return { status: 'ready', items: [], error: null };
  }
  const isResultCurrent = result.key === requestKey;
  return {
    status: isResultCurrent ? result.status : 'loading',
    items: isResultCurrent ? result.items : [],
    error: isResultCurrent ? result.error : null,
  };
}
