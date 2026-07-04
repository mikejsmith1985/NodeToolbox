// useCanvasScope.ts — Resolves the active ART team + PI scope for the canvas (no data fetch).
//
// Split out from the working-set fetch so the view can build the overlay scope key BEFORE it has any
// node keys (the overlay's key depends on project + PI, and the working-set fetch depends on the
// overlay's keys — resolving scope first breaks that cycle). This reads only settings + stored ART
// context; it performs no Jira request.

import { useMemo } from 'react';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import {
  findMatchingArtTeam,
  readFallbackSelectedPiName,
  readStoredArtTeams,
} from '../../SprintDashboard/sprintDashboardArtContext.ts';
import { buildDefaultScopeJql } from './scopeQuery.ts';

/** The resolved canvas scope: the matched ART team, its project/PI, and a default custom-query prefill. */
export interface CanvasScope {
  team: ArtTeam | null;
  projectKey: string;
  piName: string;
  boardId: number | null;
  /** The team+PI default query used to pre-fill the picker's Custom-JQL box. */
  defaultJql: string;
}

/** Resolves the active team + PI scope from settings and stored ART context (no fetch). */
export function useCanvasScope(): CanvasScope {
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

  return { team, projectKey, piName, boardId, defaultJql };
}
