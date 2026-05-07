// useDsuDailyState.test.ts — Hook tests for DSU Daily draft, Jira, clipboard, and persistence behavior.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
  jiraPost: vi.fn(),
}));

import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import { useDsuDailyState } from './useDsuDailyState.ts';

const mockJiraGet = vi.mocked(jiraGet);
const mockJiraPost = vi.mocked(jiraPost);
const STORAGE_KEY = 'tbxDsuDraft';
const CURRENT_USER_PATH = '/rest/api/2/myself';
const SEARCH_PATH =
  '/rest/api/2/search?jql=assignee = currentUser() AND updated >= -7d&fields=summary,status,updated&maxResults=100';

function buildSearchIssue(issueKey: string, summary: string, updated: string, statusCategoryKey: string) {
  return {
    key: issueKey,
    fields: {
      summary,
      updated,
      status: { statusCategory: { key: statusCategoryKey } },
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mockJiraGet.mockReset();
  mockJiraPost.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDsuDailyState', () => {
  it('starts with an empty draft and no loading state', () => {
    const { result } = renderHook(() => useDsuDailyState());

    expect(result.current.draft).toEqual({ yesterday: '', today: '', blockers: '' });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });

  it('refreshes current user and search activity before populating draft bullets', async () => {
    mockJiraGet
      .mockResolvedValueOnce({ accountId: 'abc-123', displayName: 'Alex Smith' })
      .mockResolvedValueOnce({
        issues: [
          buildSearchIssue('TBX-1', 'Updated yesterday', '2026-05-06T15:30:00.000Z', 'done'),
          buildSearchIssue('TBX-2', 'Continue implementation', '2026-05-07T09:00:00.000Z', 'indeterminate'),
        ],
      });
    const { result } = renderHook(() => useDsuDailyState());

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockJiraGet).toHaveBeenNthCalledWith(1, CURRENT_USER_PATH);
    expect(mockJiraGet).toHaveBeenNthCalledWith(2, SEARCH_PATH);
    expect(result.current.draft.yesterday).toBe('• TBX-1 - Updated yesterday');
    expect(result.current.draft.today).toBe('• TBX-2 - Continue implementation');
  });

  it('uses legacy fallback bullets when refresh finds no matching issues', async () => {
    mockJiraGet.mockResolvedValueOnce({ accountId: 'abc-123', displayName: 'Alex Smith' }).mockResolvedValueOnce({ issues: [] });
    const { result } = renderHook(() => useDsuDailyState());

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.draft.yesterday).toBe('• (nothing updated yesterday)');
    expect(result.current.draft.today).toBe('• (no active issues assigned)');
  });

  it('editing yesterday persists the draft to localStorage', () => {
    const { result } = renderHook(() => useDsuDailyState());

    act(() => {
      result.current.setYesterday('• TBX-7 - Fixed startup');
    });

    expect(result.current.draft.yesterday).toBe('• TBX-7 - Fixed startup');
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('Fixed startup');
  });

  it('editing today and blockers persists the full draft', () => {
    const { result } = renderHook(() => useDsuDailyState());

    act(() => {
      result.current.setToday('• TBX-8 - Write tests');
    });
    act(() => {
      result.current.setBlockers('Waiting on access');
    });

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      yesterday: '',
      today: '• TBX-8 - Write tests',
      blockers: 'Waiting on access',
    });
  });

  it('preserves draft fields when multiple edits happen before rerender', () => {
    const { result } = renderHook(() => useDsuDailyState());

    act(() => {
      result.current.setYesterday('Yesterday value');
      result.current.setToday('Today value');
      result.current.setBlockers('Blocker value');
    });

    expect(result.current.draft).toEqual({
      yesterday: 'Yesterday value',
      today: 'Today value',
      blockers: 'Blocker value',
    });
  });

  it('loads a persisted draft without calling Jira', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ yesterday: 'Persisted yesterday', today: 'Persisted today', blockers: 'Persisted blocker' }),
    );

    const { result } = renderHook(() => useDsuDailyState());

    expect(result.current.draft.yesterday).toBe('Persisted yesterday');
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('copy writes formatted text to the clipboard and returns true', async () => {
    const { result } = renderHook(() => useDsuDailyState());
    act(() => {
      result.current.setYesterday('Did work');
    });

    let didCopy = false;
    await act(async () => {
      didCopy = await result.current.copy();
    });

    expect(didCopy).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('*Yesterday*\nDid work\n\n*Today*\n\n\n*Blockers*\nNone');
  });

  it('copy returns false when clipboard permissions fail', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    const { result } = renderHook(() => useDsuDailyState());

    let didCopy = true;
    await act(async () => {
      didCopy = await result.current.copy();
    });

    expect(didCopy).toBe(false);
  });

  it('postComment validates that an issue key is present', async () => {
    const { result } = renderHook(() => useDsuDailyState());

    await act(async () => {
      await result.current.postComment();
    });

    expect(mockJiraPost).not.toHaveBeenCalled();
    expect(result.current.postStatus).toBe('error');
    expect(result.current.postError).toBe('Enter an issue key before posting.');
  });

  it('postComment posts the formatted text to Jira and reports success', async () => {
    mockJiraPost.mockResolvedValueOnce({});
    const { result } = renderHook(() => useDsuDailyState());
    act(() => {
      result.current.setYesterday('Finished thing');
      result.current.setPostKey('tbx-99');
    });

    await act(async () => {
      await result.current.postComment();
    });

    expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/TBX-99/comment', {
      body: '*Yesterday*\nFinished thing\n\n*Today*\n\n\n*Blockers*\nNone',
    });
    expect(result.current.postStatus).toBe('success');
  });

  it('postComment reports Jira failures clearly', async () => {
    mockJiraPost.mockRejectedValueOnce(new Error('Jira unavailable'));
    const { result } = renderHook(() => useDsuDailyState());
    act(() => {
      result.current.setPostKey('TBX-100');
    });

    await act(async () => {
      await result.current.postComment();
    });

    expect(result.current.postStatus).toBe('error');
    expect(result.current.postError).toBe('Jira unavailable');
  });

  it('surfaces a clear error message when refresh fails', async () => {
    mockJiraGet.mockRejectedValueOnce(new Error('No Jira connection'));
    const { result } = renderHook(() => useDsuDailyState());

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.errorMessage).toBe('Could not refresh DSU Daily activity. No Jira connection');
  });
});
