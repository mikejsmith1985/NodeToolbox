// useCanvasFeatures.test.ts — Verifies the JQL-driven surfacing hook (no-team, default surface, error).

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindMatchingArtTeam, mockFetchByJql } = vi.hoisted(() => ({
  mockFindMatchingArtTeam: vi.fn(),
  mockFetchByJql: vi.fn(),
}));

vi.mock('../../SprintDashboard/sprintDashboardArtContext.ts', () => ({
  findMatchingArtTeam: mockFindMatchingArtTeam,
  readStoredArtTeams: () => [],
  readFallbackSelectedPiName: () => '',
}));
vi.mock('../../SprintDashboard/featureReview.ts', () => ({
  fetchFeatureReviewItemsByJql: mockFetchByJql,
}));
vi.mock('../../ArtView/artFeatureScopeSettings.ts', () => ({
  readArtFeatureScopeSettings: () => ({ piFieldId: 'customfield_10301', featureProjectKeys: [] }),
}));

import { useCanvasFeatures } from './useCanvasFeatures.ts';

const TEAM = { id: 'team-1', name: 'Alpha', boardId: '42', projectKey: 'DENP', sprintIssues: [], isLoading: false, loadError: null };

describe('useCanvasFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('reports the no-team state when no ART team matches the active board', () => {
    mockFindMatchingArtTeam.mockReturnValue(null);
    const { result } = renderHook(() => useCanvasFeatures());
    expect(result.current.status).toBe('no-team');
    expect(result.current.team).toBeNull();
    expect(result.current.items).toHaveLength(0);
  });

  it('surfaces the default query on mount and exposes the default JQL', async () => {
    mockFindMatchingArtTeam.mockReturnValue(TEAM);
    mockFetchByJql.mockResolvedValue([{ feature: { key: 'DENP-1' } }]);

    const { result } = renderHook(() => useCanvasFeatures());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.jql).toContain('issuetype in (Feature, Epic)');
    expect(mockFetchByJql).toHaveBeenCalledWith(result.current.defaultJql);
  });

  it('surfaces an error and no items when the query fails, leaving no partial state', async () => {
    mockFindMatchingArtTeam.mockReturnValue(TEAM);
    mockFetchByJql.mockRejectedValue(new Error('jql error 400'));

    const { result } = renderHook(() => useCanvasFeatures());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toMatch(/jql error/);
  });
});
