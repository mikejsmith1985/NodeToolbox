// useCanvasFeatures.test.ts — Verifies the key-driven working-set fetch (empty set, fetch, error, batching).

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchByJql } = vi.hoisted(() => ({ mockFetchByJql: vi.fn() }));
vi.mock('../../SprintDashboard/featureReview.ts', () => ({ fetchFeatureReviewItemsByJql: mockFetchByJql }));

import { useCanvasFeatures } from './useCanvasFeatures.ts';

describe('useCanvasFeatures (working-set fetch)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches nothing and stays ready for an empty working set', () => {
    const { result } = renderHook(() => useCanvasFeatures([]));
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(0);
    expect(mockFetchByJql).not.toHaveBeenCalled();
  });

  it('fetches live data for the working-set keys via an issuekey query', async () => {
    mockFetchByJql.mockResolvedValue([{ feature: { key: 'DENP-1' } }, { feature: { key: 'DENP-2' } }]);
    const { result } = renderHook(() => useCanvasFeatures(['DENP-1', 'DENP-2'], 'customfield_10236'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(2);
    // The configured story-points field is threaded through so child points read the right field.
    expect(mockFetchByJql).toHaveBeenCalledWith('issuekey in (DENP-1,DENP-2)', undefined, 'customfield_10236');
  });

  it('surfaces an error and no items when the fetch fails', async () => {
    mockFetchByJql.mockRejectedValue(new Error('jql error 400'));
    const { result } = renderHook(() => useCanvasFeatures(['DENP-9']));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.error).toMatch(/jql error/);
  });

  it('batches a working set larger than 200 keys and merges the results', async () => {
    const keys = Array.from({ length: 250 }, (_unused, index) => `K-${index}`);
    mockFetchByJql.mockResolvedValue([{ feature: { key: 'X' } }]);
    const { result } = renderHook(() => useCanvasFeatures(keys));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    // 250 keys → two batches (200 + 50), so two fetch calls and two merged items.
    expect(mockFetchByJql).toHaveBeenCalledTimes(2);
    expect(result.current.items).toHaveLength(2);
  });
});
