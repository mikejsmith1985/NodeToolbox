// poToolArtTeam.test.ts — Proves the PO Tool builds the ArtTeam shape the shared PI Review editor expects
// from its OWN selected team profile, without touching Team Dashboard state (contracts/tab-reuse.md).

import { describe, expect, it } from 'vitest';

import type { SprintDashboardTeamProfile } from '../../store/settingsStore';
import { buildArtTeamFromProfile } from './poToolArtTeam';

/** A saved team profile with every field the PI Review editor reads. */
function buildTeamProfile(
  overrides: Partial<SprintDashboardTeamProfile> = {},
): SprintDashboardTeamProfile {
  return {
    id: 'profile-alpha',
    name: 'Transformers',
    projectKey: 'ALPHA',
    boardId: '42',
    boardName: 'Alpha Board',
    boardType: 'scrum',
    scopeMode: 'pi',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: 'PI 2026.3',
    piReviewPages: [{ piName: 'PI 2026.3', pageUrl: 'https://confluence/pages/12345/PI' }],
    ...overrides,
  };
}

describe('buildArtTeamFromProfile', () => {
  it('maps the identifying fields the PI Review editor reads from the profile', () => {
    const artTeam = buildArtTeamFromProfile(buildTeamProfile());

    expect(artTeam.id).toBe('profile-alpha');
    expect(artTeam.name).toBe('Transformers');
    expect(artTeam.boardId).toBe('42');
    expect(artTeam.projectKey).toBe('ALPHA');
  });

  it('carries the profile PI Review pages through, since they drive the editor target', () => {
    const artTeam = buildArtTeamFromProfile(buildTeamProfile());

    expect(artTeam.piReviewPages).toEqual([
      { piName: 'PI 2026.3', pageUrl: 'https://confluence/pages/12345/PI' },
    ]);
  });

  it('passes an empty sprint issue list, which the PI Review editor never reads', () => {
    // research R1: PiReviewTab never reads team.sprintIssues — it exists only to satisfy ArtTeam.
    // The PO Tool is not an execution surface, so it has no sprint issues to supply.
    const artTeam = buildArtTeamFromProfile(buildTeamProfile());

    expect(artTeam.sprintIssues).toEqual([]);
  });

  it('reports a settled, error-free load state so the editor renders immediately', () => {
    const artTeam = buildArtTeamFromProfile(buildTeamProfile());

    expect(artTeam.isLoading).toBe(false);
    expect(artTeam.loadError).toBeNull();
  });

  it('omits a blank project key rather than passing an empty string', () => {
    // An empty projectKey would defeat the editor's off-train detection; undefined is the documented absent value.
    const artTeam = buildArtTeamFromProfile(buildTeamProfile({ projectKey: '' }));

    expect(artTeam.projectKey).toBeUndefined();
  });

  it('tolerates a profile saved before PI Review pages existed', () => {
    const artTeam = buildArtTeamFromProfile(buildTeamProfile({ piReviewPages: undefined }));

    expect(artTeam.piReviewPages).toEqual([]);
  });
});
