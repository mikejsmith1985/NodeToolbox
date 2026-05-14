// relayBridgeApi.test.ts — Unit tests for relay bridge endpoint helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayBridgeStatus } from '../types/relay.ts';
import {
  fetchRelayStatus,
  pollRelay,
  postRelayRequest,
  registerRelay,
  waitForRelayResult,
} from './relayBridgeApi.ts';

const RELAY_STATUS: RelayBridgeStatus = {
  system: 'snow',
  isConnected: true,
  lastPingAt: '2025-01-01T00:00:00.000Z',
  version: '1.0.0',
};
const RELAY_POLL_RESPONSE = { request: { id: 'message-1' } };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('relayBridgeApi', () => {
  it('fetchRelayStatus calls the status endpoint and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(RELAY_STATUS),
    } as unknown as Response);

    await expect(fetchRelayStatus('snow')).resolves.toEqual(RELAY_STATUS);
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/status?sys=snow');
  });

  it('fetchRelayStatus throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(fetchRelayStatus('snow')).rejects.toThrow('Relay status check failed: 503');
  });

  it('registerRelay sends the target system as a query parameter', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(registerRelay('snow')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/register?sys=snow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  });

  it('registerRelay throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(registerRelay('snow')).rejects.toThrow('Relay registration failed: 401');
  });

  it('pollRelay calls the poll endpoint and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(RELAY_POLL_RESPONSE),
    } as unknown as Response);

    await expect(pollRelay<{ id: string }>('snow')).resolves.toEqual(RELAY_POLL_RESPONSE);
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/poll?sys=snow');
  });

  it('pollRelay throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(pollRelay('snow')).rejects.toThrow('Relay poll failed: 500');
  });
});

// ── postRelayRequest ──────────────────────────────────────────────────────────

describe('postRelayRequest', () => {
  it('posts the request envelope to the relay request endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    const relayRequest = {
      sys: 'snow' as const,
      id: 'req-001',
      method: 'GET',
      path: '/api/now/table/incident',
    };

    await expect(postRelayRequest(relayRequest)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(relayRequest),
    });
  });

  it('throws on an error response from the enqueue endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(
      postRelayRequest({ sys: 'snow', id: 'req-001', method: 'GET', path: '/api/now/table/incident' }),
    ).rejects.toThrow('Relay request enqueue failed: 400');
  });
});

// ── waitForRelayResult ────────────────────────────────────────────────────────

describe('waitForRelayResult', () => {
  it('returns the unwrapped result from the envelope', async () => {
    const mockResult = {
      id: 'req-001',
      ok: true,
      status: 200,
      data: '{"result":[]}',
      error: null,
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ result: mockResult }),
    } as unknown as Response);

    await expect(waitForRelayResult('req-001', 'snow')).resolves.toEqual(mockResult);
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/result/req-001?sys=snow');
  });

  it('throws a descriptive timeout error on HTTP 408', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 408 } as Response);

    await expect(waitForRelayResult('req-001', 'snow')).rejects.toThrow(
      'Relay bridge timed out (30 seconds)',
    );
  });

  it('throws the server-provided disconnect message when the relay session ends', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({
        error: 'Relay bridge disconnected. Reopen ServiceNow and click the relay bookmarklet again.',
      }),
    } as unknown as Response);

    await expect(waitForRelayResult('req-001', 'snow')).rejects.toThrow(
      'Relay bridge disconnected. Reopen ServiceNow and click the relay bookmarklet again.',
    );
  });

  it('throws on non-408 error responses', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(waitForRelayResult('req-001', 'snow')).rejects.toThrow(
      'Relay result collection failed: 500',
    );
  });
});
