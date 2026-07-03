// useCanvasFeatures.ts — Loads the scoped feature set the canvas surfaces (Stage 1 data source).
//
// The canvas surfaces work at the active team's Program Increment scope, reusing the Feature
// Review fetch so features arrive with health, completion, child stories, and hygiene flags
// already computed. A companion fetch enriches each feature with its Jira issue links so the
// canvas can show blocker indicators (FR-6.4); missing links degrade to no indicators.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { useSettingsStore } from '../../../store/settingsStore.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import { fetchFeatureReviewItems, type FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import {
  findMatchingArtTeam,
  readFallbackSelectedPiName,
  readStoredArtTeams,
} from '../../SprintDashboard/sprintDashboardArtContext.ts';

/** The loading lifecycle of the canvas feature set. */
export type CanvasFeaturesStatus = 'no-team' | 'loading' | 'ready' | 'error';

/** The resolved feature set plus enough context to scope the overlay and containers. */
export interface CanvasFeaturesResult {
  status: CanvasFeaturesStatus;
  team: ArtTeam | null;
  projectKey: string;
  piName: string;
  boardId: number | null;
  items: FeatureReviewItem[];
  error: string | null;
  reload: () => void;
}

/** Shape of a Jira search response limited to the issue-links field. */
interface IssueLinkSearchResponse {
  issues?: Array<{ key: string; fields?: { issuelinks?: unknown } }>;
}

/** Fetches issue links for the given feature keys and merges them onto their feature issues. */
async function enrichWithIssueLinks(items: FeatureReviewItem[]): Promise<void> {
  const featureKeys = items.map((item) => item.feature.key).filter(Boolean);
  if (featureKeys.length === 0) {
    return;
  }
  const jql = encodeURIComponent(`key in (${featureKeys.join(',')})`);
  const response = await jiraGet<IssueLinkSearchResponse>(`/rest/api/2/search?jql=${jql}&fields=issuelinks&maxResults=${featureKeys.length}`);
  const linksByKey = new Map((response.issues ?? []).map((issue) => [issue.key, issue.fields?.issuelinks]));
  for (const item of items) {
    const links = linksByKey.get(item.feature.key);
    if (links !== undefined) {
      (item.featureIssue.fields as { issuelinks?: unknown }).issuelinks = links;
    }
  }
}

/** Resolves the active team, PI, and feature set the canvas should surface. */
export function useCanvasFeatures(): CanvasFeaturesResult {
  const boardIdRaw = useSettingsStore((state) => state.sprintDashboardBoardId);
  const projectKey = useSettingsStore((state) => state.sprintDashboardProjectKey);
  const selectedPiValue = useSettingsStore((state) => state.sprintDashboardSelectedPiValue);

  const [reloadToken, setReloadToken] = useState(0);

  const boardId = boardIdRaw.trim() === '' ? null : Number(boardIdRaw);
  const team = useMemo(() => findMatchingArtTeam(readStoredArtTeams(), boardId, projectKey), [boardId, projectKey]);
  const piName = selectedPiValue.trim() || readFallbackSelectedPiName();
  const requestKey = `${team?.id ?? ''}:${piName}:${reloadToken}`;

  // The async result is keyed by the request it belongs to. Until the in-flight request for the
  // current key resolves, the derived status below reports "loading" — so setState only ever
  // happens inside the async callbacks, never synchronously in the effect body.
  const [result, setResult] = useState<{ key: string; status: 'ready' | 'error'; items: FeatureReviewItem[]; error: string | null }>(
    { key: '', status: 'ready', items: [], error: null },
  );

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!team) {
      return undefined;
    }
    let isCancelled = false;
    fetchFeatureReviewItems(team, piName)
      .then(async (loadedItems) => {
        await enrichWithIssueLinks(loadedItems).catch(() => undefined);
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
  }, [team, piName, requestKey]);

  const isResultCurrent = result.key === requestKey;
  const status: CanvasFeaturesStatus = !team ? 'no-team' : isResultCurrent ? result.status : 'loading';
  const items = isResultCurrent ? result.items : [];
  const error = isResultCurrent ? result.error : null;

  return { status, team, projectKey, piName, boardId, items, error, reload };
}
