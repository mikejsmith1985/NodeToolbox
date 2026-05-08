// useProxyStatus.test.ts — Unit tests for the proxy-status polling hook.

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectionProbeResult, ProxyStatusResponse } from '../types/config.ts';
import { useConnectionStore } from '../store/connectionStore.ts';
import { fetchProxyStatus, probeJiraConnection, probeSnowConnection } from '../services/proxyApi.ts';
import { useProxyStatus } from './useProxyStatus.ts';

vi.mock('../services/proxyApi.ts', () => ({
  fetchProxyStatus: vi.fn(),
  probeJiraConnection: vi.fn(),
  probeSnowConnection: vi.fn(),
}));

const MOCK_PROXY_STATUS: ProxyStatusResponse = {
  version: '1.0.0',
  sslVerify: true,
  jira: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://jira.example.com' },
  snow: { configured: false, hasCredentials: false, ready: false, sessionMode: false, sessionExpiresAt: null, baseUrl: null },
  github: { configured: false, hasCredentials: false, ready: false },
  confluence: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://confluence.example.com' },
};

const MOCK_PROBE_SUCCESS: ConnectionProbeResult = {
  isOk: true,
  statusCode: 200,
  message: 'Connection verified.',
};

const MOCK_PROBE_FAILURE: ConnectionProbeResult = {
  isOk: false,
  statusCode: 401,
  message: 'Unauthorized — check credentials.',
};

describe('useProxyStatus', () => {
  beforeEach(() => {
    useConnectionStore.setState(useConnectionStore.getInitialState());
    vi.mocked(probeJiraConnection).mockResolvedValue(MOCK_PROBE_SUCCESS);
    vi.mocked(probeSnowConnection).mockResolvedValue(MOCK_PROBE_FAILURE);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('calls fetchProxyStatus on mount and writes the result to the store', async () => {
    vi.mocked(fetchProxyStatus).mockResolvedValue(MOCK_PROXY_STATUS);

    renderHook(() => useProxyStatus());

    await waitFor(() => {
      expect(fetchProxyStatus).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().proxyStatus).toEqual(MOCK_PROXY_STATUS);
    });
  });

  it('probes Jira after status fetch when Jira is configured and sets isJiraVerified', async () => {
    vi.mocked(fetchProxyStatus).mockResolvedValue(MOCK_PROXY_STATUS);

    renderHook(() => useProxyStatus());

    await waitFor(() => {
      expect(probeJiraConnection).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().isJiraVerified).toBe(true);
    });
  });

  it('sets isJiraVerified=false when the Jira probe fails', async () => {
    vi.mocked(fetchProxyStatus).mockResolvedValue(MOCK_PROXY_STATUS);
    vi.mocked(probeJiraConnection).mockResolvedValue(MOCK_PROBE_FAILURE);

    renderHook(() => useProxyStatus());

    await waitFor(() => {
      expect(useConnectionStore.getState().isJiraVerified).toBe(false);
    });
  });

  it('does not probe Jira when Jira is not configured', async () => {
    vi.mocked(fetchProxyStatus).mockResolvedValue({
      ...MOCK_PROXY_STATUS,
      jira: { ...MOCK_PROXY_STATUS.jira, configured: false, ready: false },
    });

    renderHook(() => useProxyStatus());

    await waitFor(() => {
      expect(fetchProxyStatus).toHaveBeenCalledTimes(1);
    });

    expect(probeJiraConnection).not.toHaveBeenCalled();
  });

  it('clears the polling interval on unmount', () => {
    vi.useFakeTimers();
    vi.mocked(fetchProxyStatus).mockResolvedValue(MOCK_PROXY_STATUS);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

    const { unmount } = renderHook(() => useProxyStatus());
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when fetchProxyStatus rejects', async () => {
    vi.mocked(fetchProxyStatus).mockRejectedValue(new Error('offline'));

    expect(() => renderHook(() => useProxyStatus())).not.toThrow();

    await waitFor(() => {
      expect(fetchProxyStatus).toHaveBeenCalledTimes(1);
      expect(useConnectionStore.getState().proxyStatus).toBeNull();
    });
  });
});
