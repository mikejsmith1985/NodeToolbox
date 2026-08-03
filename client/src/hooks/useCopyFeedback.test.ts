// useCopyFeedback.test.ts — The shared "✓ Copied!" confirmation state for copy buttons.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCopyFeedback } from './useCopyFeedback.ts';

describe('useCopyFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the text and raises the confirmation flag', () => {
    const writeText = vi.fn();
    const { result } = renderHook(() => useCopyFeedback(writeText));

    act(() => result.current.confirmCopy('hello'));

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(result.current.hasCopied).toBe(true);
  });

  it('clears the confirmation after the visibility window', () => {
    const { result } = renderHook(() => useCopyFeedback(vi.fn()));

    act(() => result.current.confirmCopy('hello'));
    act(() => vi.advanceTimersByTime(2000));

    expect(result.current.hasCopied).toBe(false);
  });

  it('restarts the visibility window when copied again mid-window', () => {
    const { result } = renderHook(() => useCopyFeedback(vi.fn()));

    act(() => result.current.confirmCopy('first'));
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.confirmCopy('second'));
    act(() => vi.advanceTimersByTime(1500));

    // 3s after the first copy but only 1.5s after the second — still confirmed.
    expect(result.current.hasCopied).toBe(true);

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.hasCopied).toBe(false);
  });
});
