// useCanvasScope.test.ts — Verifies the active-profile scope resolution (project/PI/board, no fetch).

import { renderHook } from '@testing-library/react';
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
      sprintDashboardTeamProfiles: [profile('t1', 'CleanupCrew', 'ENCUC', '42', 'PI 26.3')],
      sprintDashboardActiveTeamProfileId: 't1',
    });
  });

  it('resolves the active profile project/PI/board and a default custom-query prefill', () => {
    const { result } = renderHook(() => useCanvasScope());
    expect(result.current.projectKey).toBe('ENCUC');
    expect(result.current.piName).toBe('PI 26.3');
    expect(result.current.boardId).toBe(42);
    expect(result.current.defaultJql).toContain('project = "ENCUC"');
    expect(result.current.defaultJql).toContain('cf[10301]');
  });

  it('falls back to an empty project + fallback PI when no profile is configured', () => {
    useSettingsStore.setState({ sprintDashboardTeamProfiles: [], sprintDashboardActiveTeamProfileId: '' });
    const { result } = renderHook(() => useCanvasScope());
    expect(result.current.projectKey).toBe('');
    expect(result.current.piName).toBe('PI 26.3');
    expect(result.current.boardId).toBeNull();
  });
});
