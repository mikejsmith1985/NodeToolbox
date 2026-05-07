// useWorkLogState.test.ts — Tests for the Work Log state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn(),
  jiraPost: vi.fn(),
}));

import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import {
  computeElapsedSecondsFor,
  formatDurationFromSeconds,
  parseFreeFormTimeText,
  useWorkLogState,
  MINIMUM_WORKLOG_SECONDS,
} from './useWorkLogState.ts';

const mockJiraGet = vi.mocked(jiraGet);
const mockJiraPost = vi.mocked(jiraPost);

beforeEach(() => {
  window.localStorage.clear();
  mockJiraGet.mockReset();
  mockJiraPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatDurationFromSeconds', () => {
  it('returns hours and minutes for durations >= 1 hour', () => {
    expect(formatDurationFromSeconds(3 * 3600 + 25 * 60)).toBe('3h 25m');
  });

  it('returns minutes and seconds for sub-hour durations', () => {
    expect(formatDurationFromSeconds(125)).toBe('2m 5s');
  });

  it('returns just seconds for sub-minute durations', () => {
    expect(formatDurationFromSeconds(42)).toBe('42s');
  });

  it('clamps negative input to zero', () => {
    expect(formatDurationFromSeconds(-9)).toBe('0s');
  });
});

describe('parseFreeFormTimeText', () => {
  it('parses combined "1h 30m" syntax', () => {
    expect(parseFreeFormTimeText('1h 30m')).toBe(5400);
  });

  it('parses minutes alone', () => {
    expect(parseFreeFormTimeText('45m')).toBe(2700);
  });

  it('treats bare numbers as minutes', () => {
    expect(parseFreeFormTimeText('15')).toBe(900);
  });

  it('returns zero for empty input', () => {
    expect(parseFreeFormTimeText('  ')).toBe(0);
  });
});

describe('computeElapsedSecondsFor', () => {
  it('returns floor of accumulated when paused', () => {
    expect(
      computeElapsedSecondsFor({
        issueKey: 'A-1',
        summary: '',
        status: '',
        issueType: '',
        isRunning: false,
        startedAtMs: null,
        accumulatedMilliseconds: 12_500,
      }),
    ).toBe(12);
  });

  it('adds in-progress run when timer is running', () => {
    const fixedNow = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    expect(
      computeElapsedSecondsFor({
        issueKey: 'A-1',
        summary: '',
        status: '',
        issueType: '',
        isRunning: true,
        startedAtMs: fixedNow - 5000,
        accumulatedMilliseconds: 7000,
      }),
    ).toBe(12);
    vi.restoreAllMocks();
  });
});

describe('useWorkLogState', () => {
  it('adds a timer for the searched issue key', async () => {
    mockJiraGet.mockResolvedValueOnce({
      key: 'TBX-9',
      fields: {
        summary: 'Hello world',
        status: { name: 'In Progress' },
        issuetype: { name: 'Story' },
      },
    });
    const { result } = renderHook(() => useWorkLogState());

    act(() => {
      result.current.setSearchKey('tbx-9');
    });
    await act(async () => {
      await result.current.addTimerByIssueKey();
    });

    expect(result.current.timers).toHaveLength(1);
    expect(result.current.timers[0].issueKey).toBe('TBX-9');
    expect(result.current.timers[0].summary).toBe('Hello world');
  });

  it('starts and pauses a timer and accumulates milliseconds', async () => {
    let nowMs = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    mockJiraGet.mockResolvedValueOnce({
      key: 'SEED-1',
      fields: { summary: 'Seed', status: { name: '' }, issuetype: { name: '' } },
    });
    const { result } = renderHook(() => useWorkLogState());

    act(() => {
      result.current.setSearchKey('SEED-1');
    });
    await act(async () => {
      await result.current.addTimerByIssueKey();
    });
    expect(result.current.timers).toHaveLength(1);

    act(() => {
      result.current.startTimer('SEED-1');
    });
    nowMs += 4000;
    act(() => {
      result.current.pauseTimer('SEED-1');
    });

    const updatedTimer = result.current.timers.find((existing) => existing.issueKey === 'SEED-1');
    expect(updatedTimer?.accumulatedMilliseconds).toBeGreaterThanOrEqual(4000);
    expect(updatedTimer?.isRunning).toBe(false);
    vi.restoreAllMocks();
  });

  it('removes a timer by issue key', async () => {
    mockJiraGet.mockResolvedValueOnce({
      key: 'X-1',
      fields: { summary: 'X', status: { name: '' }, issuetype: { name: '' } },
    });
    const { result } = renderHook(() => useWorkLogState());
    act(() => result.current.setSearchKey('X-1'));
    await act(async () => {
      await result.current.addTimerByIssueKey();
    });
    expect(result.current.timers).toHaveLength(1);

    act(() => result.current.removeTimer('X-1'));
    expect(result.current.timers).toHaveLength(0);
  });

  it('rejects worklog post below the minimum and reports an error', async () => {
    const { result } = renderHook(() => useWorkLogState());
    await act(async () => {
      await result.current.postWorkLog('Y-1', MINIMUM_WORKLOG_SECONDS - 1, '');
    });
    expect(mockJiraPost).not.toHaveBeenCalled();
    expect(result.current.postError).toMatch(/Minimum work log/);
  });

  it('posts a worklog and adds a history entry on success', async () => {
    mockJiraGet.mockResolvedValueOnce({
      key: 'Z-1',
      fields: { summary: 'Posted', status: { name: '' }, issuetype: { name: '' } },
    });
    mockJiraPost.mockResolvedValueOnce({});
    const { result } = renderHook(() => useWorkLogState());

    act(() => result.current.setSearchKey('Z-1'));
    await act(async () => {
      await result.current.addTimerByIssueKey();
    });
    await act(async () => {
      await result.current.postWorkLog('Z-1', 120, 'Did stuff');
    });

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1);
    });
    expect(mockJiraPost).toHaveBeenCalledWith('/rest/api/2/issue/Z-1/worklog', {
      timeSpentSeconds: 120,
      comment: 'Did stuff',
    });
    expect(result.current.history[0].issueKey).toBe('Z-1');
  });

  it('persists timers and history to localStorage', async () => {
    mockJiraGet.mockResolvedValueOnce({
      key: 'P-1',
      fields: { summary: 'Persist', status: { name: '' }, issuetype: { name: '' } },
    });
    const { result, unmount } = renderHook(() => useWorkLogState());
    act(() => result.current.setSearchKey('P-1'));
    await act(async () => {
      await result.current.addTimerByIssueKey();
    });
    unmount();

    const remountedHook = renderHook(() => useWorkLogState());
    expect(remountedHook.result.current.timers).toHaveLength(1);
    expect(remountedHook.result.current.timers[0].issueKey).toBe('P-1');
  });
});
