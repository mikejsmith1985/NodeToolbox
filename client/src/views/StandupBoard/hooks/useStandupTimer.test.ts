// useStandupTimer.test.ts — Fake-timer coverage for the Standup Board facilitation timer.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STANDUP_TIMER_TOTAL_SECONDS, useStandupTimer } from './useStandupTimer.ts';

const ONE_SECOND = 1000;

describe('useStandupTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at fifteen minutes while paused', () => {
    const { result } = renderHook(() => useStandupTimer());

    expect(result.current.remainingSeconds).toBe(STANDUP_TIMER_TOTAL_SECONDS);
    expect(result.current.isRunning).toBe(false);
  });

  it('starts running and decrements every second', () => {
    const { result } = renderHook(() => useStandupTimer());

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(ONE_SECOND * 3));

    expect(result.current.isRunning).toBe(true);
    expect(result.current.remainingSeconds).toBe(STANDUP_TIMER_TOTAL_SECONDS - 3);
  });

  it('pause stops further decrementing', () => {
    const { result } = renderHook(() => useStandupTimer());

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(ONE_SECOND));
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(ONE_SECOND * 5));

    expect(result.current.isRunning).toBe(false);
    expect(result.current.remainingSeconds).toBe(STANDUP_TIMER_TOTAL_SECONDS - 1);
  });

  it('reset returns to fifteen minutes and stops the timer', () => {
    const { result } = renderHook(() => useStandupTimer());

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(ONE_SECOND * 5));
    act(() => result.current.reset());

    expect(result.current.remainingSeconds).toBe(STANDUP_TIMER_TOTAL_SECONDS);
    expect(result.current.isRunning).toBe(false);
  });

  it('stops at zero without decrementing past done', () => {
    const { result } = renderHook(() => useStandupTimer());

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(ONE_SECOND * (STANDUP_TIMER_TOTAL_SECONDS + 5)));

    expect(result.current.remainingSeconds).toBe(0);
    expect(result.current.isRunning).toBe(false);
  });

  it('cleans up the interval when unmounted', () => {
    const { result, unmount } = renderHook(() => useStandupTimer());

    act(() => result.current.start());
    unmount();
    act(() => vi.advanceTimersByTime(ONE_SECOND * 5));

    expect(vi.getTimerCount()).toBe(0);
  });
});
