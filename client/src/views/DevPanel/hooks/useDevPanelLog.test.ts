// useDevPanelLog.test.ts — Verifies the Dev Panel event listener keeps API activity accurate.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDevPanelLog } from './useDevPanelLog.ts';

const API_EVENT_NAME = 'toolbox:api';
const MAX_LOG_ENTRIES = 500;

interface TestApiEventDetail {
  method?: string;
  url?: string;
  status?: number | null;
  durationMs?: number;
  errorMessage?: string | null;
}

function dispatchApiEvent(apiEventDetail: TestApiEventDetail): void {
  act(() => {
    window.dispatchEvent(new CustomEvent(API_EVENT_NAME, { detail: apiEventDetail }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDevPanelLog', () => {
  it('listens to toolbox API events and appends entries', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/search', status: 200, durationMs: 42 });

    expect(hookState.current.entries).toHaveLength(1);
    expect(hookState.current.entries[0]).toMatchObject({
      method: 'GET',
      url: '/rest/api/3/search',
      status: 200,
      durationMs: 42,
      errorMessage: null,
    });
  });

  it('creates a unique id and ISO timestamp for each entry', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    dispatchApiEvent({ method: 'POST', url: '/rest/api/3/issue', status: 201, durationMs: 13 });

    expect(hookState.current.entries[0].id).toEqual(expect.any(String));
    expect(Date.parse(hookState.current.entries[0].timestamp)).not.toBeNaN();
  });

  it('ignores events while paused instead of queueing them', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    act(() => hookState.current.setPaused(true));
    dispatchApiEvent({ method: 'GET', url: '/ignored', status: 200, durationMs: 1 });
    act(() => hookState.current.setPaused(false));
    dispatchApiEvent({ method: 'GET', url: '/recorded', status: 200, durationMs: 2 });

    expect(hookState.current.entries).toHaveLength(1);
    expect(hookState.current.entries[0].url).toBe('/recorded');
  });

  it('keeps only the newest 500 entries', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    for (let i = 0; i < MAX_LOG_ENTRIES + 1; i++) {
      dispatchApiEvent({ method: 'GET', url: `/request-${i}`, status: 200, durationMs: i });
    }

    expect(hookState.current.entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(hookState.current.entries[0].url).toBe('/request-1');
    expect(hookState.current.entries.at(-1)?.url).toBe('/request-500');
  });

  it('clears all entries', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    dispatchApiEvent({ method: 'GET', url: '/before-clear', status: 200, durationMs: 5 });
    act(() => hookState.current.clear());

    expect(hookState.current.entries).toHaveLength(0);
  });

  it('recalculates total call count as entries change', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    dispatchApiEvent({ method: 'GET', url: '/one', status: 200, durationMs: 10 });
    dispatchApiEvent({ method: 'PUT', url: '/two', status: 204, durationMs: 20 });

    expect(hookState.current.totalCalls).toBe(2);
  });

  it('counts HTTP and network errors', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    dispatchApiEvent({ method: 'GET', url: '/ok', status: 200, durationMs: 10 });
    dispatchApiEvent({ method: 'GET', url: '/client-error', status: 404, durationMs: 20 });
    dispatchApiEvent({ method: 'GET', url: '/network-error', status: null, durationMs: 30, errorMessage: 'offline' });

    expect(hookState.current.errorCount).toBe(2);
  });

  it('rounds average duration across retained entries', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    dispatchApiEvent({ method: 'GET', url: '/slow', status: 200, durationMs: 10 });
    dispatchApiEvent({ method: 'GET', url: '/slower', status: 200, durationMs: 21 });

    expect(hookState.current.averageDurationMs).toBe(16);
  });

  it('returns zero average duration when the log is empty', () => {
    const { result: hookState } = renderHook(() => useDevPanelLog());

    expect(hookState.current.averageDurationMs).toBe(0);
  });

  it('cleans up the window event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useDevPanelLog());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(API_EVENT_NAME, expect.any(Function));
  });
});
