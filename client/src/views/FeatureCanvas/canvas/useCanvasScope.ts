// useCanvasScope.ts — Resolves the active canvas scope (project/PI/board) for overlay + commit (no fetch).
//
// This drives the overlay scope key (which project+PI this canvas belongs to), the commit target, and
// the Custom-JQL default prefill. The blueprint *selection* step is fed the full ART roster separately
// (its By-Team buckets need all teams to attribute features correctly), so this only resolves the
// single active Team-Dashboard profile's scope.

import { useMemo } from 'react';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts';
import { readFallbackSelectedPiName } from '../../SprintDashboard/sprintDashboardArtContext.ts';
import { buildDefaultScopeJql } from './scopeQuery.ts';

/** The resolved canvas scope for overlay keying, commit, and the Custom-JQL default. */
export interface CanvasScope {
  projectKey: string;
  piName: string;
  boardId: number | null;
  defaultJql: string;
}

/**
 * Resolves the active Team-Dashboard profile's project + PI scope (no fetch). An optional
 * `piOverride` lets the canvas run the exercise against a different PI than the profile's default
 * (chosen in step 1); a non-empty override wins over the profile/fallback PI for the scope key,
 * commit target, and Custom-JQL default alike.
 */
export function useCanvasScope(piOverride?: string | null): CanvasScope {
  const teamProfiles = useSettingsStore((state) => state.sprintDashboardTeamProfiles);
  const activeTeamProfileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);

  const activeProfile = useMemo(
    () => teamProfiles.find((profile) => profile.id === activeTeamProfileId) ?? teamProfiles[0] ?? null,
    [teamProfiles, activeTeamProfileId],
  );

  const projectKey = activeProfile?.projectKey ?? '';
  const trimmedOverride = (piOverride ?? '').trim();
  const piName = trimmedOverride || (activeProfile?.selectedPiValue ?? '').trim() || readFallbackSelectedPiName();
  const boardId = activeProfile?.boardId && activeProfile.boardId.trim() !== '' ? Number(activeProfile.boardId) : null;

  const defaultJql = useMemo(
    () => buildDefaultScopeJql({ projectKey, piName, piFieldId: readArtFeatureScopeSettings().piFieldId }),
    [projectKey, piName],
  );

  return { projectKey, piName, boardId, defaultJql };
}
