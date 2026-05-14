// useSnowChoiceOptions.test.ts — Tests for the SNow sys_choice dynamic dropdown hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { useSnowChoiceOptions } from './useSnowChoiceOptions.ts';

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

function makeSysChoiceResponse(records: Array<{ element: string; value: string; label: string }>) {
  return { result: records };
}

describe('useSnowChoiceOptions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns hardcoded fallback options immediately before the SNow fetch resolves', () => {
    // Never-resolving promise simulates in-flight request.
    vi.mocked(snowFetch).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSnowChoiceOptions());

    // Fallback options should be present immediately.
    expect(result.current.choiceOptions['category']).toBeDefined();
    expect(result.current.choiceOptions['impact']).toBeDefined();
    expect(result.current.isLoadingChoices).toBe(true);
    expect(result.current.areChoicesFromSnow).toBe(false);
  });

  it('replaces fallback options with live SNow choices after a successful fetch', async () => {
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
  });

  it('keeps hardcoded fallbacks and sets isLoadingChoices false when snowFetch rejects', async () => {
    vi.mocked(snowFetch).mockRejectedValueOnce(new Error('Relay not connected') as never);

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(result.current.isLoadingChoices).toBe(false);
    });

    // Fallbacks still present, not flagged as SNow data.
    expect(result.current.areChoicesFromSnow).toBe(false);
    expect(result.current.choiceOptions['category']).toBeDefined();
  });

  it('calls snowFetch with a sys_choice query targeting change_request fields', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce(makeSysChoiceResponse([]) as never);

    renderHook(() => useSnowChoiceOptions());

    await waitFor(() => {
      expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
    });

    const calledPath = vi.mocked(snowFetch).mock.calls[0][0] as string;
    expect(calledPath).toContain('/api/now/table/sys_choice');
    expect(calledPath).toContain('name%3Dchange_request');
  });

  it('merges live choices on top of fallbacks so unresolved fields keep their defaults', async () => {
    // Only return choices for 'impact' — other fields should retain fallback options.
    vi.mocked(snowFetch).mockResolvedValueOnce(
      makeSysChoiceResponse([
        { element: 'impact', value: '1', label: 'High' },
      ]) as never,
    );

    const { result } = renderHook(() => useSnowChoiceOptions());

    await waitFor(() => expect(result.current.areChoicesFromSnow).toBe(true));

    // Fallback for category still present.
    const categoryOptions = result.current.choiceOptions['category'];
    expect(categoryOptions.some((opt) => opt.label === 'Software')).toBe(true);
  });

  it('fires the SNow fetch only once on mount (no effect on re-render)', async () => {
    vi.mocked(snowFetch).mockResolvedValue(makeSysChoiceResponse([]) as never);

    const { rerender } = renderHook(() => useSnowChoiceOptions());

    await act(async () => { rerender(); rerender(); });

    await waitFor(() => {
      expect(vi.mocked(snowFetch)).toHaveBeenCalledTimes(1);
    });
  });
});
