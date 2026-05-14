// useSnowChoiceOptions.test.ts — Tests for the SNow sys_choice dynamic dropdown hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import { useSnowChoiceOptions } from './useSnowChoiceOptions.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

// Mutable ref so individual tests can switch the relay on or off without re-mocking.
const mockRelayRef = { isConnected: false };

vi.mock('../../../store/connectionStore.ts', () => ({
  useConnectionStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ relayBridgeStatus: { isConnected: mockRelayRef.isConnected } }),
  ),
}));

/**
 * Re-applies the base `useConnectionStore` mock implementation using the current mockRelayRef value
 * or an explicit `isConnected` override. Uses `as never` to satisfy TypeScript without exporting
 * the private `ConnectionState` type from the store module.
 */
function setRelayConnected(isConnected: boolean): void {
  vi.mocked(useConnectionStore).mockImplementation(
    (selector) => selector({ relayBridgeStatus: { isConnected } } as never),
  );
}

function makeSysChoiceResponse(records: Array<{ element: string; value: string; label: string }>) {
  return { result: records };
}

describe('useSnowChoiceOptions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Reset relay state between tests so they don't bleed into each other.
    mockRelayRef.isConnected = false;
    // Restore the base implementation so tests that override mockImplementation don't bleed.
    setRelayConnected(false);
  });

  it('does not attempt a fetch when relay is not connected', () => {
    mockRelayRef.isConnected = false;

    renderHook(() => useSnowChoiceOptions());

    // Hook should not call snowFetch at all while relay is disconnected.
    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
  });

  it('returns empty options, isRelayConnected false, and no loading indicator when relay is off', () => {
    mockRelayRef.isConnected = false;

    const { result } = renderHook(() => useSnowChoiceOptions());

    expect(result.current.choiceOptions).toEqual({});
    expect(result.current.isLoadingChoices).toBe(false);
    expect(result.current.areChoicesFromSnow).toBe(false);
    expect(result.current.isFetchFailed).toBe(false);
    expect(result.current.fetchErrorMessage).toBeNull();
    expect(result.current.isRelayConnected).toBe(false);
  });

  it('fetches choices when relay is connected on mount', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSysChoiceResponse([
        { element: 'impact', value: '1', label: 'High' },
      ]) as never,
    );

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
    expect(result.current.isRelayConnected).toBe(true);
  });

  it('auto-retries when relay transitions from disconnected to connected', async () => {
    // Start disconnected.
    mockRelayRef.isConnected = false;

    vi.mocked(snowFetch).mockResolvedValue(makeSysChoiceResponse([
      { element: 'impact', value: '3', label: 'Low' },
    ]) as never);

    const { result, rerender } = renderHook(() => useSnowChoiceOptions());

    // No fetch while disconnected.
    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();

    // Relay connects — update the mock and re-render so the selector returns true.
    mockRelayRef.isConnected = true;
    setRelayConnected(true);

    await act(async () => { rerender(); });

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
  });

  it('populates choiceOptions with live SNow choices after a successful fetch', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSysChoiceResponse([
        { element: 'impact', value: '1', label: 'High' },
        { element: 'impact', value: '2', label: 'Medium' },
        { element: 'impact', value: '3', label: 'Low' },
      ]) as never,
    );

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(result.current.areChoicesFromSnow).toBe(true);
    });

    const impactOptions = result.current.choiceOptions['impact'];
    // Empty blank first + 3 live values.
    expect(impactOptions).toHaveLength(4);
    expect(impactOptions[1]).toEqual({ value: '1', label: 'High' });
    expect(result.current.isLoadingChoices).toBe(false);
    expect(result.current.isFetchFailed).toBe(false);
    expect(result.current.fetchErrorMessage).toBeNull();
  });

  it('sets isFetchFailed true and leaves choiceOptions empty when snowFetch rejects', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockRejectedValueOnce(new Error('Session expired') as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(result.current.isLoadingChoices).toBe(false);
    });

    // No fallback values — the UI must show a "fetch failed" warning with a Retry button.
    expect(result.current.isFetchFailed).toBe(true);
    expect(result.current.areChoicesFromSnow).toBe(false);
    expect(result.current.choiceOptions).toEqual({});
  });

  it('captures the error message from the thrown error as fetchErrorMessage', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockRejectedValueOnce(new Error('SNow relay fetch failed: 401') as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(result.current.isFetchFailed).toBe(true);
    });

    // The exact error message must be surfaced so the user can diagnose root cause.
    expect(result.current.fetchErrorMessage).toBe('SNow relay fetch failed: 401');
  });

  it('retryFetch resets failure state and triggers a new request', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    // First call fails, second succeeds.
    vi.mocked(snowFetch)
      .mockRejectedValueOnce(new Error('Timeout') as never)
      .mockResolvedValueOnce(makeSysChoiceResponse([
        { element: 'category', value: 'software', label: 'Software' },
      ]) as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.isFetchFailed).toBe(true));

    // User clicks Retry.
    await act(async () => { result.current.retryFetch(); });

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(result.current.isFetchFailed).toBe(false);
    expect(result.current.fetchErrorMessage).toBeNull();
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(2);
  });

  it('calls snowFetch with a sys_choice query targeting change_request fields', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockResolvedValueOnce(makeSysChoiceResponse([]) as never);

    renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
    });

    const calledPath = vi.mocked(snowFetch).mock.calls[0][0] as string;
    expect(calledPath).toContain('/api/now/table/sys_choice');
    expect(calledPath).toContain('name%3Dchange_request');
  });

  it('only includes the choices returned by SNow — no values are injected for unreturned fields', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    // Only return choices for 'impact' — other fields should have no entries.
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSysChoiceResponse([
        { element: 'impact', value: '1', label: 'High' },
      ]) as never,
    );

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    // 'category' was not returned — it must be absent, not filled with guessed values.
    expect(result.current.choiceOptions['category']).toBeUndefined();
  });
});
