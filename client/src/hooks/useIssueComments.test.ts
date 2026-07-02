// useIssueComments.test.ts — Unit tests for the shared on-demand Jira comment-thread hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraComment } from '../types/jira.ts';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { useIssueComments } from './useIssueComments.ts';

// Deliberately out of chronological order so tests prove the hook sorts them.
const OLDEST: JiraComment = { id: '1', author: { displayName: 'Ada' }, body: 'first', created: '2025-01-01T00:00:00.000Z' };
const MIDDLE: JiraComment = { id: '2', author: { displayName: 'Ben' }, body: 'second', created: '2025-01-02T00:00:00.000Z' };
const NEWEST: JiraComment = { id: '3', author: { displayName: 'Cyd' }, body: 'third', created: '2025-01-03T00:00:00.000Z' };

describe('useIssueComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the full thread on demand from the comment endpoint', async () => {
    mockJiraGet.mockResolvedValue({ comments: [OLDEST, MIDDLE, NEWEST] });

    const { result } = renderHook(() => useIssueComments('TBX-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-1/comment');
    expect(result.current.comments).toHaveLength(3);
    expect(result.current.loadError).toBeNull();
  });

  it('returns comments ordered newest first regardless of response order', async () => {
    mockJiraGet.mockResolvedValue({ comments: [MIDDLE, OLDEST, NEWEST] });

    const { result } = renderHook(() => useIssueComments('TBX-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.comments.map((comment) => comment.id)).toEqual(['3', '2', '1']);
  });

  it('sets loadError and empties comments when the fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useIssueComments('TBX-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe('boom');
    expect(result.current.comments).toEqual([]);
  });

  it('re-fetches when refresh() is called', async () => {
    mockJiraGet.mockResolvedValue({ comments: [OLDEST] });

    const { result } = renderHook(() => useIssueComments('TBX-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callsAfterMount = mockJiraGet.mock.calls.length;
    act(() => result.current.refresh());

    await waitFor(() => expect(mockJiraGet.mock.calls.length).toBeGreaterThan(callsAfterMount));
  });

  it('fetches the new key when issueKey changes', async () => {
    mockJiraGet.mockResolvedValue({ comments: [OLDEST] });

    const { result, rerender } = renderHook(({ issueKey }) => useIssueComments(issueKey), {
      initialProps: { issueKey: 'TBX-1' },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ issueKey: 'TBX-2' });

    await waitFor(() => expect(mockJiraGet).toHaveBeenCalledWith('/rest/api/2/issue/TBX-2/comment'));
  });
});
