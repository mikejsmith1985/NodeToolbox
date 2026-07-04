// useCanvasScope.ts — Resolves the active ART team + PI scope for the canvas (no data fetch).
//
// Teams come from the Team-Dashboard profiles the user is SM for (not the full ART roster), so the
// canvas can scope to exactly one of *their* teams. A local team selector defaults to the active
// profile but lets the user switch scope on the canvas without disturbing the rest of the dashboard.
// Split from the working-set fetch so the view can build the overlay scope key before it has keys.

import { useMemo, useState } from 'react';

import { useSettingsStore, type SprintDashboardTeamProfile } from '../../../store/settingsStore.ts';
import { readArtFeatureScopeSettings } from '../../ArtView/artFeatureScopeSettings.ts';
import type { ArtTeam } from '../../ArtView/hooks/useArtData.ts';
import { readFallbackSelectedPiName } from '../../SprintDashboard/sprintDashboardArtContext.ts';
import { buildDefaultScopeJql } from './scopeQuery.ts';

/** A team the user can scope the canvas to (from their Team-Dashboard profiles). */
export interface CanvasScopeTeam {
  id: string;
  name: string;
}

/** The resolved canvas scope: the selectable teams, the chosen team, and its project/PI. */
export interface CanvasScope {
  /** The user's configured Team-Dashboard teams, for the scope dropdown. */
  teams: CanvasScopeTeam[];
  selectedTeamId: string;
  selectTeam: (teamId: string) => void;
  /** The chosen team as an ArtTeam, for the blueprint fetch (null when none is configured). */
  team: ArtTeam | null;
  projectKey: string;
  piName: string;
  boardId: number | null;
  /** The team+PI default query used to pre-fill the picker's Custom-JQL box. */
  defaultJql: string;
}

/** Builds the ArtTeam shape the blueprint fetch needs from a Team-Dashboard profile. */
function profileToArtTeam(profile: SprintDashboardTeamProfile): ArtTeam {
  return {
    id: profile.id,
    name: profile.name,
    boardId: profile.boardId,
    projectKey: profile.projectKey,
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
}

/** Resolves the active team + PI scope from the user's Team-Dashboard profiles (no fetch). */
export function useCanvasScope(): CanvasScope {
  const teamProfiles = useSettingsStore((state) => state.sprintDashboardTeamProfiles);
  const activeTeamProfileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);

  // Local scope selection: defaults to the dashboard's active team, overridable on the canvas.
  const [chosenTeamId, setChosenTeamId] = useState<string | null>(null);
  const selectedTeamId = chosenTeamId ?? activeTeamProfileId;

  const selectedProfile = useMemo(
    () => teamProfiles.find((profile) => profile.id === selectedTeamId) ?? teamProfiles[0] ?? null,
    [teamProfiles, selectedTeamId],
  );

  const teams = useMemo<CanvasScopeTeam[]>(
    () => teamProfiles.map((profile) => ({ id: profile.id, name: profile.name })),
    [teamProfiles],
  );

  const team = useMemo(() => (selectedProfile ? profileToArtTeam(selectedProfile) : null), [selectedProfile]);
  const projectKey = selectedProfile?.projectKey ?? '';
  const piName = (selectedProfile?.selectedPiValue ?? '').trim() || readFallbackSelectedPiName();
  const boardId = selectedProfile?.boardId && selectedProfile.boardId.trim() !== '' ? Number(selectedProfile.boardId) : null;

  const defaultJql = useMemo(
    () => buildDefaultScopeJql({ projectKey, piName, piFieldId: readArtFeatureScopeSettings().piFieldId }),
    [projectKey, piName],
  );

  return {
    teams,
    selectedTeamId: selectedProfile?.id ?? '',
    selectTeam: setChosenTeamId,
    team,
    projectKey,
    piName,
    boardId,
    defaultJql,
  };
}
