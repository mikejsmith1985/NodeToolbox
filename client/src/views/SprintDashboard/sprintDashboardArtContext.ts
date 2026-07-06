// sprintDashboardArtContext.ts — Shared Team Dashboard helpers for resolving the current ART team and PI context.

import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';

const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams';
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const EMPTY_PI_NAME = '';

interface StoredArtSettings {
  piName?: string;
}

function normalizeStoredArtTeam(team: Partial<ArtTeam>): ArtTeam | null {
  const teamName = typeof team.name === 'string' ? team.name.trim() : '';
  const teamBoardId = typeof team.boardId === 'string' ? team.boardId.trim() : '';
  if (teamName === '' || teamBoardId === '') {
    return null;
  }

  return {
    id: typeof team.id === 'string' && team.id.trim() !== '' ? team.id.trim() : `${teamBoardId}-${teamName}`,
    name: teamName,
    boardId: teamBoardId,
    boardName: typeof team.boardName === 'string' && team.boardName.trim() !== '' ? team.boardName.trim() : undefined,
    projectKey: typeof team.projectKey === 'string' && team.projectKey.trim() !== '' ? team.projectKey.trim() : undefined,
    piReviewPageUrl: typeof team.piReviewPageUrl === 'string' && team.piReviewPageUrl.trim() !== '' ? team.piReviewPageUrl.trim() : undefined,
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
}

/** Reads the locally stored ART team roster that Team Dashboard uses to match its current board to ART context. */
export function readStoredArtTeams(): ArtTeam[] {
  try {
    const storedTeams = localStorage.getItem(ART_TEAMS_STORAGE_KEY);
    if (!storedTeams) {
      return [];
    }

    const parsedTeams = JSON.parse(storedTeams) as unknown;
    if (!Array.isArray(parsedTeams)) {
      return [];
    }

    return parsedTeams
      .filter((team): team is Partial<ArtTeam> => typeof team === 'object' && team !== null)
      .map((team) => normalizeStoredArtTeam(team))
      .filter((team): team is ArtTeam => team !== null);
  } catch {
    return [];
  }
}

/** Reads the ART-level fallback PI name so Team Dashboard can stay aligned with the broader PI workspace. */
export function readFallbackSelectedPiName(): string {
  try {
    const storedSettings = JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as StoredArtSettings;
    return storedSettings.piName?.trim() || EMPTY_PI_NAME;
  } catch {
    return EMPTY_PI_NAME;
  }
}

/** Matches the current Team Dashboard board/project pair to the configured ART team record. */
export function findMatchingArtTeam(artTeams: ArtTeam[], boardId: number | null, projectKey: string, teamName = ''): ArtTeam | null {
  const normalizedBoardId = boardId === null ? '' : String(boardId);
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const normalizedTeamName = teamName.trim().toLowerCase();

  // Most specific: the team the user explicitly selected, matched by name. This prevents a DIFFERENT
  // team that merely shares the project key from being picked (the project-key fallback below) when
  // the active board doesn't line up exactly with a stored ART team's board.
  if (normalizedTeamName !== '') {
    const nameMatch = artTeams.find((team) => team.name.trim().toLowerCase() === normalizedTeamName);
    if (nameMatch) {
      return nameMatch;
    }
  }

  if (normalizedBoardId !== '' && normalizedProjectKey !== '') {
    const exactMatch = artTeams.find((team) =>
      team.boardId === normalizedBoardId
      && (team.projectKey?.trim().toUpperCase() ?? '') === normalizedProjectKey);
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (normalizedBoardId !== '') {
    const boardMatch = artTeams.find((team) => team.boardId === normalizedBoardId);
    if (boardMatch) {
      return boardMatch;
    }
  }

  if (normalizedProjectKey === '') {
    return null;
  }

  return artTeams.find((team) => (team.projectKey?.trim().toUpperCase() ?? '') === normalizedProjectKey) ?? null;
}
