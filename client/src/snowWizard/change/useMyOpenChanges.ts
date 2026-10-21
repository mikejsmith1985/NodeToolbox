// useMyOpenChanges.ts — The signed-in user's open changes, read once on request, for the "pick one of my changes" lists.

import { useCallback, useState } from 'react';

import { fetchMyOpenChanges, type MyOpenChange } from '../../views/SnowHub/myOpenChanges.ts';

/** Where the read stands. */
export type MyOpenChangesLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; changes: MyOpenChange[] }
  | { kind: 'failed'; message: string };

/** The user's open changes, read when asked, and the way to ask. */
export function useMyOpenChanges(): { loadState: MyOpenChangesLoadState; load: () => Promise<void> } {
  const [loadState, setLoadState] = useState<MyOpenChangesLoadState>({ kind: 'idle' });
  const load = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    try {
      setLoadState({ kind: 'loaded', changes: await fetchMyOpenChanges() });
    } catch (loadError) {
      setLoadState({ kind: 'failed', message: loadError instanceof Error ? loadError.message : String(loadError) });
    }
  }, []);
  return { loadState, load };
}
