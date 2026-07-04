// useCanvasScope.test.ts — Verifies scope resolution (team match, PI, default query) with no fetch.

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindMatchingArtTeam } = vi.hoisted(() => ({ mockFindMatchingArtTeam: vi.fn() }));

vi.mock('../../SprintDashboard/sprintDashboardArtContext.ts', () => ({
  findMatchingArtTeam: mockFindMatchingArtTeam,
  readStoredArtTeams: () => [],
  readFallbackSelectedPiName: () => 'PI 26.3',
}));
vi.mock('../../ArtView/artFeatureScopeSettings.ts', () => ({
  readArtFeatureScopeSettings: () => ({ piFieldId: 'customfield_10301', featureProjectKeys: [] }),
}));

import { useCanvasScope } from './useCanvasScope.ts';

const TEAM = { id: 'team-1', name: 'Alpha', boardId: '42', projectKey: 'DENP', sprintIssues: [], isLoading: false, loadError: null };

describe('useCanvasScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('resolves the matched team, PI, and a default custom-query prefill', () => {
    mockFindMatchingArtTeam.mockReturnValue(TEAM);
    const { result } = renderHook(() => useCanvasScope());
    expect(result.current.team).toBe(TEAM);
    expect(result.current.piName).toBe('PI 26.3');
    expect(result.current.defaultJql).toContain('cf[10301]');
  });

  it('returns a null team when no ART team matches', () => {
    mockFindMatchingArtTeam.mockReturnValue(null);
    const { result } = renderHook(() => useCanvasScope());
    expect(result.current.team).toBeNull();
  });
});
