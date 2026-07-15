// usePoToolState.test.ts — Proves the PO Tool owns its OWN team/PI selection and never writes the
// app-wide active team profile id (INV-T3, FR-005a). This is the guarantee that the PO Tool and the
// Team Dashboard can be used on different teams without fighting over one value.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '../../../store/settingsStore';
import { PO_TOOL_SELECTION_STORAGE_KEY, usePoToolState } from './usePoToolState';

/** A saved team profile — the PO Tool reads these as a read-only catalog. */
function buildTeamProfile(id: string, name: string, piValue: string) {
  return {
    id,
    name,
    projectKey: name.slice(0, 5).toUpperCase(),
    boardId: '42',
    boardName: `${name} Board`,
    boardType: 'scrum',
    scopeMode: 'pi',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: piValue,
    piReviewPages: [],
  };
}

const TEAM_PROFILES = [
  buildTeamProfile('profile-alpha', 'Alpha', 'PI 2026.3'),
  buildTeamProfile('profile-beta', 'Beta', 'PI 2026.4'),
];

beforeEach(() => {
  window.localStorage.clear();
  useSettingsStore.setState({
    sprintDashboardTeamProfiles: TEAM_PROFILES,
    sprintDashboardActiveTeamProfileId: 'profile-alpha',
  });
});

describe('usePoToolState — tab selection', () => {
  it('opens on Feature Review so the PO lands on a familiar surface', () => {
    const { result } = renderHook(() => usePoToolState());

    expect(result.current.activeTab).toBe('featurereview');
  });

  it('switches to any of the four PO Tool tabs', () => {
    const { result } = renderHook(() => usePoToolState());

    act(() => result.current.setActiveTab('splitter'));
    expect(result.current.activeTab).toBe('splitter');

    act(() => result.current.setActiveTab('composition'));
    expect(result.current.activeTab).toBe('composition');

    act(() => result.current.setActiveTab('pireview'));
    expect(result.current.activeTab).toBe('pireview');
  });
});

describe('usePoToolState — independent team selection (INV-T3)', () => {
  it('defaults to the app-wide active team as a convenience starting point', () => {
    const { result } = renderHook(() => usePoToolState());

    expect(result.current.selectedTeamProfileId).toBe('profile-alpha');
  });

  it('NEVER writes the app-wide active team profile id when the PO Tool team changes', () => {
    // The core guarantee: changing the PO Tool's team must not move the Team Dashboard's selection.
    const { result } = renderHook(() => usePoToolState());

    act(() => result.current.setSelectedTeamProfileId('profile-beta'));

    expect(result.current.selectedTeamProfileId).toBe('profile-beta');
    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('profile-alpha');
  });

  it('resolves the selected profile from the shared catalog without mutating it', () => {
    const { result } = renderHook(() => usePoToolState());

    act(() => result.current.setSelectedTeamProfileId('profile-beta'));

    expect(result.current.selectedTeamProfile?.name).toBe('Beta');
    expect(useSettingsStore.getState().sprintDashboardTeamProfiles).toEqual(TEAM_PROFILES);
  });

  it('derives the PI from the selected profile so PI Review targets the right pages', () => {
    const { result } = renderHook(() => usePoToolState());

    act(() => result.current.setSelectedTeamProfileId('profile-beta'));

    expect(result.current.selectedPiName).toBe('PI 2026.4');
  });

  it('lets the PO override the PI independently of the profile default', () => {
    const { result } = renderHook(() => usePoToolState());

    act(() => result.current.setSelectedPiName('PI 2027.1'));

    expect(result.current.selectedPiName).toBe('PI 2027.1');
  });
});

describe('usePoToolState — persistence', () => {
  it('persists the PO Tool selection to its own storage key', () => {
    const { result } = renderHook(() => usePoToolState());

    act(() => result.current.setSelectedTeamProfileId('profile-beta'));
    act(() => result.current.setSelectedPiName('PI 2027.1'));

    const storedSelection = JSON.parse(
      window.localStorage.getItem(PO_TOOL_SELECTION_STORAGE_KEY) ?? '{}',
    );
    expect(storedSelection.selectedTeamProfileId).toBe('profile-beta');
    expect(storedSelection.selectedPiName).toBe('PI 2027.1');
  });

  it('restores a previous selection so the PO returns to where they left off', () => {
    window.localStorage.setItem(
      PO_TOOL_SELECTION_STORAGE_KEY,
      JSON.stringify({ selectedTeamProfileId: 'profile-beta', selectedPiName: 'PI 2027.1' }),
    );

    const { result } = renderHook(() => usePoToolState());

    expect(result.current.selectedTeamProfileId).toBe('profile-beta');
    expect(result.current.selectedPiName).toBe('PI 2027.1');
  });

  it('falls back to the active team when the stored profile no longer exists', () => {
    // A deleted team must not strand the PO Tool on a dangling id.
    window.localStorage.setItem(
      PO_TOOL_SELECTION_STORAGE_KEY,
      JSON.stringify({ selectedTeamProfileId: 'profile-deleted', selectedPiName: '' }),
    );

    const { result } = renderHook(() => usePoToolState());

    expect(result.current.selectedTeamProfileId).toBe('profile-alpha');
  });

  it('survives an unreadable stored selection rather than throwing', () => {
    window.localStorage.setItem(PO_TOOL_SELECTION_STORAGE_KEY, '{not json');

    const { result } = renderHook(() => usePoToolState());

    expect(result.current.selectedTeamProfileId).toBe('profile-alpha');
  });
});
