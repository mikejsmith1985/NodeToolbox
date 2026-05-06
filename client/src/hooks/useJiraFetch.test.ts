// useJiraFetch.test.ts — Unit tests for the Jira data-fetching hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jiraGet } from '../services/jiraApi.ts';
import { useJiraFetch } from './useJiraFetch.ts';

vi.mock('../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

const JIRA_PATH = '/rest/api/3/issue/ABC-123';
const FIRST_RESPONSE = { key: 'ABC-123' };
const SECOND_RESPONSE = { key: 'ABC-456' };

describe('useJiraFetch', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts in a loading state and then returns data on success', async () => {
    vi.mocked(jiraGet).mockResolvedValue(FIRST_RESPONSE);

    const { result } = renderHook(() => useJiraFetch<typeof FIRST_RESPONSE>(JIRA_PATH));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual(FIRST_RESPONSE);
      expect(result.current.error).toBeNull();
    });
  });

  it('returns an error message when the request fails', async () => {
    vi.mocked(jiraGet).mockRejectedValue(new Error('Jira unavailable'));

    const { result } = renderHook(() => useJiraFetch(JIRA_PATH));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe('Jira unavailable');
      expect(result.current.data).toBeNull();
    });
  });

  it('refetch triggers the request again', async () => {
    vi.mocked(jiraGet).mockResolvedValueOnce(FIRST_RESPONSE).mockResolvedValueOnce(SECOND_RESPONSE);

    const { result } = renderHook(() => useJiraFetch<typeof FIRST_RESPONSE>(JIRA_PATH));

    await waitFor(() => {
      expect(result.current.data).toEqual(FIRST_RESPONSE);
    });

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(jiraGet).toHaveBeenCalledTimes(2);
      expect(result.current.data).toEqual(SECOND_RESPONSE);
    });
  });
});
