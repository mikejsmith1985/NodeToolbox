// useRelayBridge.test.ts — Unit tests for the relay bridge polling hook.

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayBridgeStatus } from '../types/relay.ts';
import { useConnectionStore } from '../store/connectionStore.ts';
import { fetchRelayStatus } from '../services/relayBridgeApi.ts';
import { useRelayBridge } from './useRelayBridge.ts';

vi.mock('../services/relayBridgeApi.ts', () => ({
  fetchRelayStatus: vi.fn(),
}));

const MOCK_RELAY_STATUS: RelayBridgeStatus = {
  system: 'snow',
  isConnected: true,
  lastPingAt: '2025-01-01T00:00:00.000Z',
  version: '1.0.0',
};

describe('useRelayBridge', () => {
  beforeEach(() => {
    useConnectionStore.setState(useConnectionStore.getInitialState());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('probes relay status on mount and updates the store on success', async () => {
    vi.mocked(fetchRelayStatus).mockResolvedValue(MOCK_RELAY_STATUS);

    renderHook(() => useRelayBridge('snow'));

    await waitFor(() => {
      expect(fetchRelayStatus).toHaveBeenCalledWith('snow');
      expect(useConnectionStore.getState().relayBridgeStatus).toEqual(MOCK_RELAY_STATUS);
    });
  });

  it('clears the probe interval on unmount', () => {
    vi.useFakeTimers();
    vi.mocked(fetchRelayStatus).mockResolvedValue(MOCK_RELAY_STATUS);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    const { unmount } = renderHook(() => useRelayBridge('snow'));
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
