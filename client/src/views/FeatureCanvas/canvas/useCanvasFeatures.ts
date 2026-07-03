// useCanvasFeatures.ts — Loads the feature set the canvas surfaces (Stage 1 data source).
//
// Surfacing is driven by a user-supplied Jira query (pre-filled with a default from the active team
// + PI) and an explicit "Surface" action, rather than an automatic team+PI fetch. The query runs
// through the JQL-scoped Feature Review fetch, so features arrive with health, completion, child
// stories, hygiene flags, and issue links already resolved. A resolved team/project/PI is still kept
// for the overlay scope key and the commit step. A failed query surfaces an error and nothing else.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import { fetchFeatureReviewItemsByJql, type FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import {
  findMatchingArtTeam,
  readFallbackSelectedPiName,
  readStoredArtTeams,
} from '../../SprintDashboard/sprintDashboardArtContext.ts';
import { buildDefaultScopeJql } from './scopeQuery.ts';

/** The loading lifecycle of the canvas feature set. */
export type CanvasFeaturesStatus = 'no-team' | 'loading' | 'ready' | 'error';

/** The resolved feature set plus the scope-control state and actions. */
export interface CanvasFeaturesResult {
  status: CanvasFeaturesStatus;
  team: ArtTeam | null;
  projectKey: string;
  piName: string;
  boardId: number | null;
  items: FeatureReviewItem[];
  error: string | null;
  /** The query that will run on the next Surface (editable via setJql). */
  jql: string;
  /** The team+PI default query, for a "reset to default" affordance. */
  defaultJql: string;
  setJql: (nextJql: string) => void;
  /** Runs the current query and re-surfaces. */
  surface: () => void;
}

/** Resolves the active team/PI scope and the query-driven feature set the canvas surfaces. */
export function useCanvasFeatures(): CanvasFeaturesResult {
  const boardIdRaw = useSettingsStore((state) => state.sprintDashboardBoardId);
  const projectKey = useSettingsStore((state) => state.sprintDashboardProjectKey);
  const selectedPiValue = useSettingsStore((state) => state.sprintDashboardSelectedPiValue);

  const boardId = boardIdRaw.trim() === '' ? null : Number(boardIdRaw);
  const team = useMemo(() => findMatchingArtTeam(readStoredArtTeams(), boardId, projectKey), [boardId, projectKey]);
  const piName = selectedPiValue.trim() || readFallbackSelectedPiName();

  const defaultJql = useMemo(
    () => buildDefaultScopeJql({ projectKey, piName, piFieldId: readArtFeatureScopeSettings().piFieldId }),
    [projectKey, piName],
  );

  // The query the user will run; null until edited, in which case the default is used.
  const [editedJql, setEditedJql] = useState<string | null>(null);
  const jql = editedJql ?? defaultJql;
  const setJql = useCallback((nextJql: string) => setEditedJql(nextJql), []);

  // Surface trigger — bumped when the user presses Surface. Generation 0 drives the initial load.
  const [surfaceGeneration, setSurfaceGeneration] = useState(0);
  const surface = useCallback(() => setSurfaceGeneration((generation) => generation + 1), []);

  // Keep the latest query in a ref so the fetch effect reads it at surface time without refetching on
  // every keystroke — the effect depends on the surface trigger, not the query string.
  const jqlRef = useRef(jql);
  useEffect(() => {
    jqlRef.current = jql;
  }, [jql]);

  const requestKey = `${team?.id ?? ''}:${surfaceGeneration}`;
  const [result, setResult] = useState<{ key: string; status: 'ready' | 'error'; items: FeatureReviewItem[]; error: string | null }>(
    { key: '', status: 'ready', items: [], error: null },
  );

  useEffect(() => {
    if (!team) {
      return undefined;
    }
    let isCancelled = false;
    // setState happens only in the async callbacks, never synchronously in the effect body.
    fetchFeatureReviewItemsByJql(jqlRef.current)
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
  }, [team, requestKey]);

  const isResultCurrent = result.key === requestKey;
  const status: CanvasFeaturesStatus = !team ? 'no-team' : isResultCurrent ? result.status : 'loading';
  const items = isResultCurrent ? result.items : [];
  const error = isResultCurrent ? result.error : null;

  return { status, team, projectKey, piName, boardId, items, error, jql, defaultJql, setJql, surface };
}
