// poToolArtTeam.ts — Translates a saved dashboard team profile into the ArtTeam shape the shared PI Review
// editor expects, so the PO Tool can mount that editor using its OWN team selection.
//
// Why this exists: the PI Review editor is deliberately tool-agnostic — it asks for an ArtTeam rather than
// reaching into any one tool's state. The Team Dashboard performs the same translation from its active
// profile. The PO Tool does it from the profile the PO picked here, which is what keeps the two tools'
// selections independent (contracts/tab-reuse.md).

import type { ArtTeam } from '../ArtView/hooks/useArtData';
import type { SprintDashboardTeamProfile } from '../../store/settingsStore';

/**
 * Builds the ArtTeam the PI Review editor reads, sourced entirely from the given team profile.
 *
 * The profile is the single source of truth for a team's PI Review pages, so no other lookup is needed.
 * Sprint issues are intentionally empty: the PI Review editor never reads them (they exist only to satisfy
 * the ArtTeam shape), and the PO Tool is a planning surface with no sprint execution data to offer.
 */
export function buildArtTeamFromProfile(teamProfile: SprintDashboardTeamProfile): ArtTeam {
  return {
    id: teamProfile.id,
    name: teamProfile.name,
    boardId: teamProfile.boardId,
    // An empty project key must become undefined — the editor treats absent and blank differently.
    projectKey: teamProfile.projectKey.trim() || undefined,
    piReviewPages: teamProfile.piReviewPages ?? [],
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
}
