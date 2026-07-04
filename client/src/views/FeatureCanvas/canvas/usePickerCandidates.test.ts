// usePickerCandidates.test.ts — Verifies the picker's blueprint + custom-JQL sources and no-team fallback.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchBlueprint, mockFetchByJql } = vi.hoisted(() => ({
  mockFetchBlueprint: vi.fn(),
  mockFetchByJql: vi.fn(),
}));

vi.mock('../../ArtView/blueprintHierarchy.ts', () => ({ fetchBlueprintHierarchy: mockFetchBlueprint }));
vi.mock('../../SprintDashboard/featureReview.ts', () => ({ fetchFeatureReviewItemsByJql: mockFetchByJql }));

import { usePickerCandidates } from './usePickerCandidates.ts';

const TEAM = { id: 'team-1', name: 'Alpha', boardId: '42', projectKey: 'ENFCT', sprintIssues: [], isLoading: false, loadError: null } as never;

describe('usePickerCandidates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blueprint source returns the program-epic hierarchy for the team + PI', async () => {
    mockFetchBlueprint.mockResolvedValue([{ type: 'pe', key: 'PE-1', summary: 'Onboarding', status: null, health: 'yellow', completionPercent: 0, features: [] }]);
    const { result } = renderHook(() => usePickerCandidates({ source: 'blueprint', team: TEAM, piName: 'PI 26.3', jql: '', runToken: 0 }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.programEpics.map((programEpic) => programEpic.key)).toEqual(['PE-1']);
    expect(mockFetchBlueprint).toHaveBeenCalledWith([TEAM], 'PI 26.3');
  });

  it('reports no-team for the blueprint source when no team is resolved (custom-JQL still available)', () => {
    const { result } = renderHook(() => usePickerCandidates({ source: 'blueprint', team: null, piName: '', jql: '', runToken: 0 }));
    expect(result.current.status).toBe('no-team');
    expect(mockFetchBlueprint).not.toHaveBeenCalled();
  });

  it('custom-JQL source returns feature-review items and works with no team', async () => {
    mockFetchByJql.mockResolvedValue([{ feature: { key: 'C-1' } }]);
    const { result } = renderHook(() => usePickerCandidates({ source: 'jql', team: null, piName: '', jql: 'project = X', runToken: 1 }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.jqlItems).toHaveLength(1);
    expect(mockFetchByJql).toHaveBeenCalledWith('project = X');
  });

  it('surfaces an error when the custom query fails', async () => {
    mockFetchByJql.mockRejectedValue(new Error('jql error 400'));
    const { result } = renderHook(() => usePickerCandidates({ source: 'jql', team: null, piName: '', jql: 'bad', runToken: 1 }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/jql error/);
    expect(result.current.jqlItems).toHaveLength(0);
  });
});
