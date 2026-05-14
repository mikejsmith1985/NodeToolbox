// useSnowChoiceOptions.test.ts — Tests for the SNow live-form dynamic dropdown hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import { useSnowChoiceOptions } from './useSnowChoiceOptions.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

// Mutable ref so individual tests can switch relay/token readiness without re-mocking.
const mockRelayRef = { isConnected: false, hasSessionToken: false };

vi.mock('../../../store/connectionStore.ts', () => ({
  useConnectionStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      relayBridgeStatus: {
        isConnected: mockRelayRef.isConnected,
        hasSessionToken: mockRelayRef.hasSessionToken,
      },
    }),
  ),
}));

/**
 * Re-applies the base `useConnectionStore` mock implementation using the current mockRelayRef value
 * or an explicit `isConnected` override. Uses `as never` to satisfy TypeScript without exporting
 * the private `ConnectionState` type from the store module.
 */
function setRelayConnected(isConnected: boolean, hasSessionToken: boolean = isConnected): void {
  vi.mocked(useConnectionStore).mockImplementation(
    (selector) => selector({ relayBridgeStatus: { isConnected, hasSessionToken } } as never),
  );
}

function makeSysChoiceResponse(records: Array<{ element: string; value: string; label: string }>) {
  return { result: records };
}

function makeUiFormResponse(fields: Record<string, { choices: Array<{ value: string; label: string }> }>) {
  return { result: { fields } };
}

describe('useSnowChoiceOptions', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Reset relay state between tests so they don't bleed into each other.
    mockRelayRef.isConnected = false;
    mockRelayRef.hasSessionToken = false;
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
    expect(result.current.hasRelaySessionToken).toBe(false);
  });

  it('fetches choices when relay is connected on mount', async () => {
    mockRelayRef.isConnected = true;
    mockRelayRef.hasSessionToken = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeUiFormResponse({
        impact: { choices: [{ value: '1', label: 'High' }] },
      }) as never,
    );

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(3);
    expect(result.current.isRelayConnected).toBe(true);
    expect(result.current.hasRelaySessionToken).toBe(true);
  });

  it('waits for the SNow session token before fetching choices', () => {
    mockRelayRef.isConnected = true;
    mockRelayRef.hasSessionToken = false;
    setRelayConnected(true, false);

    const { result } = renderHook(() => useSnowChoiceOptions());

    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();
    expect(result.current.isRelayConnected).toBe(true);
    expect(result.current.hasRelaySessionToken).toBe(false);
  });

  it('auto-retries when the relay session token becomes ready', async () => {
    mockRelayRef.isConnected = true;
    mockRelayRef.hasSessionToken = false;
    setRelayConnected(true, false);
    vi.mocked(snowFetch).mockResolvedValue(makeUiFormResponse({
      impact: { choices: [{ value: '1', label: 'High' }] },
    }) as never);

    const { result, rerender } = renderHook(() => useSnowChoiceOptions());

    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();

    mockRelayRef.hasSessionToken = true;
    setRelayConnected(true, true);
    await act(async () => { rerender(); });

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(3);
  });

  it('auto-retries when relay transitions from disconnected to connected', async () => {
    // Start disconnected.
    mockRelayRef.isConnected = false;

    vi.mocked(snowFetch).mockResolvedValue(makeUiFormResponse({
      impact: { choices: [{ value: '3', label: 'Low' }] },
    }) as never);

    const { result, rerender } = renderHook(() => useSnowChoiceOptions());

    // No fetch while disconnected.
    expect(vi.mocked(snowFetch)).not.toHaveBeenCalled();

    // Relay connects — update the mock and re-render so the selector returns true.
    mockRelayRef.isConnected = true;
    mockRelayRef.hasSessionToken = true;
    setRelayConnected(true);

    await act(async () => { rerender(); });

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(3);
  });

  it('populates choiceOptions with live SNow choices after a successful fetch', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeUiFormResponse({
        impact: {
          choices: [
            { value: '1', label: 'High' },
            { value: '2', label: 'Medium' },
            { value: '3', label: 'Low' },
          ],
        },
      }) as never,
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
    vi.mocked(snowFetch)
      .mockRejectedValueOnce(new Error('Session expired') as never)
      .mockRejectedValueOnce(new Error('UI metadata denied') as never)
      .mockRejectedValueOnce(new Error('sys_choice denied') as never);

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
    vi.mocked(snowFetch)
      .mockRejectedValueOnce(new Error('SNow relay fetch failed: 401') as never)
      .mockRejectedValueOnce(new Error('UI metadata denied') as never)
      .mockRejectedValueOnce(new Error('sys_choice denied') as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(result.current.isFetchFailed).toBe(true);
    });

    // The exact error message must be surfaced so the user can diagnose root cause.
    expect(result.current.fetchErrorMessage).toContain('SNow relay fetch failed: 401');
  });

  it('retryFetch resets failure state and triggers a new request', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    // First call fails, second succeeds.
    vi.mocked(snowFetch)
      .mockRejectedValueOnce(new Error('Timeout') as never)
      .mockRejectedValueOnce(new Error('UI metadata denied') as never)
      .mockRejectedValueOnce(new Error('sys_choice denied') as never)
      .mockResolvedValueOnce(makeUiFormResponse({
        category: { choices: [{ value: 'software', label: 'Software' }] },
      }) as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.isFetchFailed).toBe(true));

    // User clicks Retry.
    await act(async () => { result.current.retryFetch(); });

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));
    expect(result.current.isFetchFailed).toBe(false);
    expect(result.current.fetchErrorMessage).toBeNull();
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(6);
  });

  it('calls snowFetch with the SNow UI Form API before any fallback', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch).mockResolvedValueOnce(makeUiFormResponse({
      category:                { choices: [{ value: 'software', label: 'Software' }] },
      type:                    { choices: [{ value: 'normal', label: 'Normal' }] },
      u_environment:           { choices: [{ value: 'prod', label: 'Production' }] },
      impact:                  { choices: [{ value: '1', label: 'High' }] },
      u_availability_impact:   { choices: [{ value: 'none', label: 'None' }] },
      u_change_tested:         { choices: [{ value: 'yes', label: 'Yes' }] },
      u_impacted_persons_aware:{ choices: [{ value: 'yes', label: 'Yes' }] },
      u_performed_previously:  { choices: [{ value: 'no', label: 'No' }] },
      u_success_probability:   { choices: [{ value: '100', label: '100%' }] },
      u_can_be_backed_out:     { choices: [{ value: 'yes', label: 'Yes' }] },
    }) as never);

    renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
    });

    const calledPath = vi.mocked(snowFetch).mock.calls[0][0] as string;
    expect(calledPath).toContain('/api/now/ui/form/change_request/-1');
    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
  });

  it('merges UI Form and UI Meta choices so later planning fields are not skipped', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(makeUiFormResponse({
        category: { choices: [{ value: 'software', label: 'Software' }] },
      }) as never)
      .mockResolvedValueOnce({ result: { columns: {
        impact: { choices: [{ value: '1', label: 'High' }] },
      } } } as never)
      .mockResolvedValueOnce(makeSysChoiceResponse([]) as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    expect(result.current.choiceOptions.category[1]).toEqual({ value: 'software', label: 'Software' });
    expect(result.current.choiceOptions.impact[1]).toEqual({ value: '1', label: 'High' });
  });

  it('falls back to UI Meta when the UI Form API returns no choice metadata', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: { fields: {} } } as never)
      .mockResolvedValueOnce({ result: { columns: {
        impact: { choices: [{ value: '1', label: 'High' }] },
      } } } as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    const uiMetaPath = vi.mocked(snowFetch).mock.calls[1][0] as string;
    expect(uiMetaPath).toContain('/api/now/ui/meta/change_request');
    expect(result.current.choiceOptions.impact[1]).toEqual({ value: '1', label: 'High' });
  });

  it('falls back to UI Meta when the UI Form API returns a direct ServiceNow error', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch)
      .mockRejectedValueOnce(new Error('SNow relay fetch /api/now/ui/form/change_request/-1 failed: 403') as never)
      .mockResolvedValueOnce({ result: { columns: {
        category: { choices: [{ value: 'software', label: 'Software' }] },
      } } } as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(3);
    expect(result.current.choiceOptions.category[1]).toEqual({ value: 'software', label: 'Software' });
  });

  it('uses sys_choice only after both UI metadata endpoints return no choices', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({ result: { fields: {} } } as never)
      .mockResolvedValueOnce({ result: { columns: {} } } as never)
      .mockResolvedValueOnce(makeSysChoiceResponse([
        { element: 'impact', value: '1', label: 'High' },
      ]) as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    const sysChoicePath = vi.mocked(snowFetch).mock.calls[2][0] as string;
    expect(sysChoicePath).toContain('/api/now/table/sys_choice');
  });

  it('only includes the choices returned by SNow — no values are injected for unreturned fields', async () => {
    mockRelayRef.isConnected = true;
    setRelayConnected(true);
    // Only return choices for 'impact' — other fields should have no entries.
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeUiFormResponse({
        impact: { choices: [{ value: '1', label: 'High' }] },
      }) as never,
    );

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    // 'category' was not returned — it must be absent, not filled with guessed values.
    expect(result.current.choiceOptions['category']).toBeUndefined();
  });
});
