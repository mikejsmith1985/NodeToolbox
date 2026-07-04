// useCanvasScope.test.ts — Verifies scope from Team-Dashboard profiles + local team selection (no fetch).

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../SprintDashboard/sprintDashboardArtContext.ts', () => ({
  readFallbackSelectedPiName: () => 'PI 26.3',
}));
vi.mock('../../ArtView/artFeatureScopeSettings.ts', () => ({
  readArtFeatureScopeSettings: () => ({ piFieldId: 'customfield_10301', featureProjectKeys: [] }),
}));

import { useSettingsStore } from '../../../store/settingsStore.ts';
import { useCanvasScope } from './useCanvasScope.ts';

function profile(id: string, name: string, projectKey: string, boardId: string, pi = '') {
  return { id, name, projectKey, boardId, boardName: '', boardType: '', scopeMode: 'sprint', selectedSprintId: '', selectedFixVersion: '', selectedPiValue: pi };
}

describe('useCanvasScope', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      sprintDashboardTeamProfiles: [
        profile('t1', 'CleanupCrew', 'ENCUC', '42', 'PI 26.3'),
        profile('t2', 'Transformers', 'ENFCT', '43', 'PI 26.3'),
      ],
      sprintDashboardActiveTeamProfileId: 't1',
    });
  });

  it('lists the Team-Dashboard teams and defaults to the active one', () => {
    const { result } = renderHook(() => useCanvasScope());
    expect(result.current.teams.map((team) => team.name)).toEqual(['CleanupCrew', 'Transformers']);
    expect(result.current.selectedTeamId).toBe('t1');
    expect(result.current.team?.name).toBe('CleanupCrew');
    expect(result.current.projectKey).toBe('ENCUC');
    expect(result.current.defaultJql).toContain('project = "ENCUC"');
  });

  it('switches scope to another team without touching the dashboard active team', () => {
    const { result } = renderHook(() => useCanvasScope());
    act(() => result.current.selectTeam('t2'));
    expect(result.current.selectedTeamId).toBe('t2');
    expect(result.current.team?.name).toBe('Transformers');
    expect(result.current.projectKey).toBe('ENFCT');
    // The global active profile is unchanged — the switch is canvas-local.
    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('t1');
  });

  it('returns a null team when no profiles are configured', () => {
    useSettingsStore.setState({ sprintDashboardTeamProfiles: [], sprintDashboardActiveTeamProfileId: '' });
    const { result } = renderHook(() => useCanvasScope());
    expect(result.current.team).toBeNull();
    expect(result.current.teams).toHaveLength(0);
  });
});
