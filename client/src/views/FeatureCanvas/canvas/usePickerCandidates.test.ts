// usePickerCandidates.test.ts — Verifies the Custom-JQL candidate fetch (idle, run, error).

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchByJql } = vi.hoisted(() => ({ mockFetchByJql: vi.fn() }));
vi.mock('../../SprintDashboard/featureReview.ts', () => ({ fetchFeatureReviewItemsByJql: mockFetchByJql }));

import { usePickerCandidates } from './usePickerCandidates.ts';

describe('usePickerCandidates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idle and fetches nothing before the query is run', () => {
    const { result } = renderHook(() => usePickerCandidates({ jql: 'project = X', runToken: 0 }));
    expect(result.current.status).toBe('idle');
    expect(mockFetchByJql).not.toHaveBeenCalled();
  });

  it('fetches items when the query is run', async () => {
    mockFetchByJql.mockResolvedValue([{ feature: { key: 'C-1' } }]);
    const { result } = renderHook(() => usePickerCandidates({ jql: 'project = X', runToken: 1 }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.jqlItems).toHaveLength(1);
    expect(mockFetchByJql).toHaveBeenCalledWith('project = X');
  });

  it('surfaces an error when the query fails', async () => {
    mockFetchByJql.mockRejectedValue(new Error('jql error 400'));
    const { result } = renderHook(() => usePickerCandidates({ jql: 'bad', runToken: 1 }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/jql error/);
    expect(result.current.jqlItems).toHaveLength(0);
  });
});
