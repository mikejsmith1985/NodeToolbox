// Tests for the client AI Assist exchange hook (dispatch + poll).

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistExchange } from './useAiAssistExchange.ts';

const FAST_OPTIONS = { pollIntervalMs: 0, maxAttempts: 5, generateCorrelationId: () => 'fixed-id' };

// Builds a fetch mock that returns each queued JSON body in order.
function queueFetch(bodies: unknown[]) {
  const fetchMock = vi.fn();
  bodies.forEach((body) => fetchMock.mockResolvedValueOnce({ json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('useAiAssistExchange', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dispatches the prompt then returns the response once ready', async () => {
    const fetchMock = queueFetch([
      { ok: true },                                   // dispatch
      { ok: true, ready: false },                     // poll 1
      { ok: true, ready: true, response: 'SHORT_DESCRIPTION: x' }, // poll 2
    ]);

    const { result } = renderHook(() => useAiAssistExchange(FAST_OPTIONS));
    let exchange;
    await act(async () => { exchange = await result.current.runAiAssistExchange('my prompt'); });

    expect(exchange).toMatchObject({ ok: true, response: 'SHORT_DESCRIPTION: x' });
    // First call is the dispatch with the correlationId + prompt.
    const dispatchBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(dispatchBody).toEqual({ correlationId: 'fixed-id', prompt: 'my prompt' });
    // Poll calls carry the correlationId.
    expect(fetchMock.mock.calls[1][0]).toContain('correlationId=fixed-id');
  });

  it('returns a failure when the dispatch is rejected', async () => {
    queueFetch([{ ok: false, message: 'AI Assist automation webhook is not configured.' }]);
    const { result } = renderHook(() => useAiAssistExchange(FAST_OPTIONS));
    let exchange;
    await act(async () => { exchange = await result.current.runAiAssistExchange('p'); });
    expect(exchange).toMatchObject({ ok: false });
    expect(exchange!.message).toMatch(/not configured/);
  });

  it('surfaces a result-read error', async () => {
    queueFetch([{ ok: true }, { ok: false, message: 'Failed to read AI Assist result: timeout' }]);
    const { result } = renderHook(() => useAiAssistExchange(FAST_OPTIONS));
    let exchange;
    await act(async () => { exchange = await result.current.runAiAssistExchange('p'); });
    expect(exchange).toMatchObject({ ok: false });
    expect(exchange!.message).toMatch(/Failed to read/);
  });

  it('times out when the result never becomes ready', async () => {
    queueFetch([
      { ok: true },
      { ok: true, ready: false },
      { ok: true, ready: false },
    ]);
    const { result } = renderHook(() => useAiAssistExchange({ pollIntervalMs: 0, maxAttempts: 2, generateCorrelationId: () => 'fixed-id' }));
    let exchange;
    await act(async () => { exchange = await result.current.runAiAssistExchange('p'); });
    expect(exchange).toMatchObject({ ok: false });
    expect(exchange!.message).toMatch(/Timed out/);
  });
});
