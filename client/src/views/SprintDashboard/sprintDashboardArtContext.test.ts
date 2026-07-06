// sprintDashboardArtContext.test.ts — Verifies ART team resolution, esp. name disambiguation so a
// team that merely shares a project key isn't picked (the "Transformers showed Cleanup Crew" bug).

import { describe, expect, it } from 'vitest';

import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import { findMatchingArtTeam } from './sprintDashboardArtContext.ts';

function buildTeam(overrides: Partial<ArtTeam>): ArtTeam {
  return { id: overrides.name ?? 'team', name: '', boardId: '', sprintIssues: [], ...overrides } as ArtTeam;
}

describe('findMatchingArtTeam', () => {
  const teams = [
    buildTeam({ name: 'Cleanup Crew', boardId: '10', projectKey: 'ENCUC' }),
    buildTeam({ name: 'Transformers', boardId: '20', projectKey: 'ENCUC' }),
  ];

  it('disambiguates by team name when several teams share a project key', () => {
    // Board matches nothing → without a name it would fall to the FIRST project match (Cleanup Crew).
    expect(findMatchingArtTeam(teams, 999, 'ENCUC', 'Transformers')?.name).toBe('Transformers');
  });

  it('matches by name case-insensitively, regardless of board', () => {
    expect(findMatchingArtTeam(teams, null, 'ENCUC', 'transformers')?.name).toBe('Transformers');
  });

  it('still matches by board + project when no name is provided', () => {
    expect(findMatchingArtTeam(teams, 20, 'ENCUC')?.name).toBe('Transformers');
  });

  it('falls back to the first project match only when board AND name miss', () => {
    expect(findMatchingArtTeam(teams, 999, 'ENCUC')?.name).toBe('Cleanup Crew');
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingArtTeam(teams, 999, 'NOPE', 'Ghost')).toBeNull();
  });
});
