// settingsStore.teamProfiles.test.ts — Verifies the draft/saved separation for Team Dashboard profiles.
//
// The regression these tests lock down: live selection changes (project, board, scope) must NOT
// silently overwrite the saved team profile. A profile only changes on an explicit save. This is
// what stops one team's board from being clobbered by another team's transient load state.

import { beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore, type SprintDashboardTeamProfile } from './settingsStore.ts';

const TRANSFORMERS: SprintDashboardTeamProfile = {
  id: 'team-transformers',
  name: 'Transformers',
  projectKey: 'TRANS',
  boardId: '101',
  boardName: 'Transformers Board',
  boardType: 'scrum',
  scopeMode: 'sprint',
  selectedSprintId: '900',
  selectedFixVersion: '',
  selectedPiValue: '',
};

const CLEANUP_CREW: SprintDashboardTeamProfile = {
  id: 'team-cleanup',
  name: 'Cleanup Crew',
  projectKey: 'CLEAN',
  boardId: '202',
  boardName: 'Cleanup Board',
  boardType: 'scrum',
  scopeMode: 'sprint',
  selectedSprintId: '800',
  selectedFixVersion: '',
  selectedPiValue: '',
};

function readActiveProfile(): SprintDashboardTeamProfile | undefined {
  const currentState = useSettingsStore.getState();
  return currentState.sprintDashboardTeamProfiles.find(
    (teamProfile) => teamProfile.id === currentState.sprintDashboardActiveTeamProfileId,
  );
}

describe('settingsStore Team Dashboard draft/saved separation', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      sprintDashboardTeamProfiles: [TRANSFORMERS, CLEANUP_CREW],
      sprintDashboardActiveTeamProfileId: TRANSFORMERS.id,
      sprintDashboardProjectKey: TRANSFORMERS.projectKey,
      sprintDashboardBoardId: TRANSFORMERS.boardId,
      sprintDashboardScopeMode: TRANSFORMERS.scopeMode,
      sprintDashboardSelectedSprintId: TRANSFORMERS.selectedSprintId,
      sprintDashboardSelectedFixVersion: TRANSFORMERS.selectedFixVersion,
      sprintDashboardSelectedPiValue: TRANSFORMERS.selectedPiValue,
    });
  });

  it('changing the board draft does NOT mutate the active saved profile', () => {
    useSettingsStore.getState().setSprintDashboardBoardId('202');

    // The draft (global key) reflects the change...
    expect(useSettingsStore.getState().sprintDashboardBoardId).toBe('202');
    // ...but the saved Transformers profile is untouched — this is the corruption guard.
    expect(readActiveProfile()?.boardId).toBe('101');
  });

  it('changing the project draft does NOT mutate the active saved profile', () => {
    useSettingsStore.getState().setSprintDashboardProjectKey('OTHER');

    expect(useSettingsStore.getState().sprintDashboardProjectKey).toBe('OTHER');
    expect(readActiveProfile()?.projectKey).toBe('TRANS');
  });

  it('an explicit updateActive save DOES persist selections into the profile', () => {
    useSettingsStore.getState().setSprintDashboardBoardId('303');
    useSettingsStore.getState().updateActiveSprintDashboardTeamProfile({ boardId: '303' });

    expect(readActiveProfile()?.boardId).toBe('303');
  });

  it('switching the active team hydrates the draft from the target profile', () => {
    useSettingsStore.getState().setSprintDashboardActiveTeamProfileId(CLEANUP_CREW.id);

    const currentState = useSettingsStore.getState();
    expect(currentState.sprintDashboardActiveTeamProfileId).toBe(CLEANUP_CREW.id);
    expect(currentState.sprintDashboardProjectKey).toBe('CLEAN');
    expect(currentState.sprintDashboardBoardId).toBe('202');
  });

  it('revert restores the draft from the saved profile and bumps the hydration nonce', () => {
    const startingNonce = useSettingsStore.getState().sprintDashboardHydrationNonce;
    // Simulate unsaved edits to the draft.
    useSettingsStore.getState().setSprintDashboardBoardId('999');
    useSettingsStore.getState().setSprintDashboardProjectKey('DIRTY');

    useSettingsStore.getState().revertActiveSprintDashboardTeamProfile();

    const currentState = useSettingsStore.getState();
    expect(currentState.sprintDashboardBoardId).toBe('101');
    expect(currentState.sprintDashboardProjectKey).toBe('TRANS');
    expect(currentState.sprintDashboardHydrationNonce).toBe(startingNonce + 1);
  });

  it('persists a team profile PI Review page list via an explicit updateActive save', () => {
    useSettingsStore.getState().updateActiveSprintDashboardTeamProfile({
      piReviewPages: [
        { piName: 'PI 26.3', pageUrl: 'https://example.atlassian.net/wiki/pages/111/Transformers-263' },
        { piName: 'PI 26.4', pageUrl: 'https://example.atlassian.net/wiki/pages/222/Transformers-264' },
      ],
    });

    expect(readActiveProfile()?.piReviewPages).toEqual([
      { piName: 'PI 26.3', pageUrl: 'https://example.atlassian.net/wiki/pages/111/Transformers-263' },
      { piName: 'PI 26.4', pageUrl: 'https://example.atlassian.net/wiki/pages/222/Transformers-264' },
    ]);
    // Persisted to the same localStorage key the profiles live under.
    expect(localStorage.getItem('tbxSprintDashboardTeams')).toContain('Transformers-264');
  });
});
