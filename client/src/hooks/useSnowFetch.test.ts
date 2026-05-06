// useSnowFetch.test.ts — Unit tests for the ServiceNow data-fetching hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../services/snowApi.ts';
import { useSnowFetch } from './useSnowFetch.ts';

vi.mock('../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

const SNOW_PATH = '/api/now/table/change_request';
const FIRST_RESPONSE = { result: ['CHG0001'] };
const SECOND_RESPONSE = { result: ['CHG0002'] };

describe('useSnowFetch', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts in a loading state and then returns data on success', async () => {
    vi.mocked(snowFetch).mockResolvedValue(FIRST_RESPONSE);

    const { result } = renderHook(() => useSnowFetch<typeof FIRST_RESPONSE>(SNOW_PATH));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual(FIRST_RESPONSE);
      expect(result.current.error).toBeNull();
    });
  });

  it('returns an error message when the request fails', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('SNow unavailable'));

    const { result } = renderHook(() => useSnowFetch(SNOW_PATH));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe('SNow unavailable');
      expect(result.current.data).toBeNull();
    });
  });

  it('refetch triggers the request again', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce(FIRST_RESPONSE).mockResolvedValueOnce(SECOND_RESPONSE);

    const { result } = renderHook(() => useSnowFetch<typeof FIRST_RESPONSE>(SNOW_PATH));

    await waitFor(() => {
      expect(result.current.data).toEqual(FIRST_RESPONSE);
    });

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(snowFetch).toHaveBeenCalledTimes(2);
      expect(result.current.data).toEqual(SECOND_RESPONSE);
    });
  });
});
