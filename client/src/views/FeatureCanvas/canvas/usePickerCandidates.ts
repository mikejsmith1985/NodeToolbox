// usePickerCandidates.ts — Fetches the Surface picker's candidate features for the active source.
//
// Two sources: the cross-project **blueprint** (the parent-walk for the active team + PI, grouped by
// Program Epic) and a **custom JQL** query. The hook returns the raw source data (program epics or
// feature-review items); the component maps them to selectable rows with the live on-canvas set. When
// no ART team is resolved, the blueprint source reports "no-team" so the picker can show guidance while
// the custom-JQL source still works as a fallback.

import { useEffect, useRef, useState } from 'react';

import { fetchBlueprintHierarchy, type BlueprintProgramEpicNode } from '../../ArtView/blueprintHierarchy.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import { fetchFeatureReviewItemsByJql, type FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';

/** Which candidate source the picker is showing. */
export type PickerSource = 'blueprint' | 'jql';

/** Inputs the picker feeds the candidates hook. */
export interface PickerCandidatesInput {
  source: PickerSource;
  team: ArtTeam | null;
  piName: string;
  jql: string;
  /** Bumped when the user runs the custom query, so JQL fetches only on demand (not per keystroke). */
  runToken: number;
}

/** Raw candidate data for the active source, plus lifecycle. */
export interface PickerCandidatesResult {
  status: 'no-team' | 'loading' | 'ready' | 'error';
  programEpics: BlueprintProgramEpicNode[];
  jqlItems: FeatureReviewItem[];
  error: string | null;
}

/** Fetches candidate features for the active picker source. */
export function usePickerCandidates(input: PickerCandidatesInput): PickerCandidatesResult {
  const { source, team, piName, runToken } = input;

  // The JQL text is read at fetch time (via a ref) so typing does not refetch — only runToken does.
  const jqlRef = useRef(input.jql);
  useEffect(() => {
    jqlRef.current = input.jql;
  }, [input.jql]);

  const [result, setResult] = useState<{ key: string; status: 'ready' | 'error'; programEpics: BlueprintProgramEpicNode[]; jqlItems: FeatureReviewItem[]; error: string | null }>(
    { key: '', status: 'ready', programEpics: [], jqlItems: [], error: null },
  );

  const requestKey = source === 'blueprint' ? `blueprint:${team?.id ?? ''}:${piName}` : `jql:${runToken}`;

  useEffect(() => {
    if (source === 'blueprint' && !team) {
      return undefined; // derived status below reports "no-team"
    }
    let isCancelled = false;
    const fetchPromise = source === 'blueprint'
      ? fetchBlueprintHierarchy([team as ArtTeam], piName).then((programEpics) => ({ programEpics, jqlItems: [] as FeatureReviewItem[] }))
      : fetchFeatureReviewItemsByJql(jqlRef.current).then((jqlItems) => ({ programEpics: [] as BlueprintProgramEpicNode[], jqlItems }));

    fetchPromise
      .then((data) => {
        if (!isCancelled) {
          setResult({ key: requestKey, status: 'ready', programEpics: data.programEpics, jqlItems: data.jqlItems, error: null });
        }
      })
      .catch((fetchError: unknown) => {
        if (!isCancelled) {
          setResult({ key: requestKey, status: 'error', programEpics: [], jqlItems: [], error: fetchError instanceof Error ? fetchError.message : 'Failed to load candidates.' });
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [source, team, piName, requestKey]);

  const isResultCurrent = result.key === requestKey;
  const status: PickerCandidatesResult['status'] = source === 'blueprint' && !team
    ? 'no-team'
    : isResultCurrent ? result.status : 'loading';
  return {
    status,
    programEpics: isResultCurrent ? result.programEpics : [],
    jqlItems: isResultCurrent ? result.jqlItems : [],
    error: isResultCurrent ? result.error : null,
  };
}
