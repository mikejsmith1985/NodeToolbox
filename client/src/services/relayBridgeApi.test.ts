// relayBridgeApi.test.ts — Unit tests for relay bridge endpoint helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayBridgeStatus } from '../types/relay.ts';
import {
  fetchRelayStatus,
  pollRelay,
  registerRelay,
} from './relayBridgeApi.ts';

const RELAY_STATUS: RelayBridgeStatus = {
  system: 'snow',
  isConnected: true,
  lastPingAt: '2025-01-01T00:00:00.000Z',
  version: '1.0.0',
};
const RELAY_MESSAGES = [{ id: 'message-1' }];

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

  it('registerRelay posts the expected JSON payload', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(registerRelay('snow')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sys: 'snow' }),
    });
  });

  it('registerRelay throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(registerRelay('snow')).rejects.toThrow('Relay registration failed: 401');
  });

  it('pollRelay calls the poll endpoint and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(RELAY_MESSAGES),
    } as unknown as Response);

    await expect(pollRelay<{ id: string }>('snow')).resolves.toEqual(RELAY_MESSAGES);
    expect(fetch).toHaveBeenCalledWith('/api/relay-bridge/poll?sys=snow');
  });

  it('pollRelay throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(pollRelay('snow')).rejects.toThrow('Relay poll failed: 500');
  });
});
