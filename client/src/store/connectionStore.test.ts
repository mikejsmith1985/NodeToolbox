// connectionStore.test.ts — Unit tests for the global connection status Zustand store.

import { beforeEach, describe, expect, it } from 'vitest';

import type { ProxyStatusResponse } from '../types/config.ts';
import type { RelayBridgeStatus } from '../types/relay.ts';
import { useConnectionStore } from './connectionStore.ts';

const MOCK_PROXY_STATUS: ProxyStatusResponse = {
  version: '1.0.0',
  sslVerify: true,
  jira: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://jira.example.com' },
  snow: { configured: false, hasCredentials: false, ready: false, sessionMode: false, sessionExpiresAt: null, baseUrl: null },
  github: { configured: false, hasCredentials: false, ready: false },
  confluence: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://confluence.example.com' },
};

const MOCK_RELAY_STATUS: RelayBridgeStatus = {
  system: 'snow',
  isConnected: true,
  lastPingAt: '2025-01-01T00:00:00.000Z',
  version: '1.0.0',
};

beforeEach(() => {
  useConnectionStore.setState(useConnectionStore.getInitialState());
});

describe('useConnectionStore', () => {
  it('starts with falsy connection values', () => {
    const initialState = useConnectionStore.getState();

    expect(initialState.isJiraReady).toBe(false);
    expect(initialState.isSnowReady).toBe(false);
    expect(initialState.isJiraVerified).toBe(false);
    expect(initialState.isSnowVerified).toBe(false);
    expect(initialState.isConfluenceReady).toBe(false);
    expect(initialState.isGitHubReady).toBe(false);
    expect(initialState.proxyStatus).toBeNull();
    expect(initialState.relayBridgeStatus).toBeNull();
  });

  it('sets jira readiness from proxy status', () => {
    useConnectionStore.getState().setProxyStatus(MOCK_PROXY_STATUS);

    expect(useConnectionStore.getState().isJiraReady).toBe(true);
    expect(useConnectionStore.getState().proxyStatus).toEqual(MOCK_PROXY_STATUS);
  });

  it('sets confluence and github readiness from proxy status', () => {
    useConnectionStore.getState().setProxyStatus(MOCK_PROXY_STATUS);

    expect(useConnectionStore.getState().isConfluenceReady).toBe(true);
    expect(useConnectionStore.getState().isGitHubReady).toBe(false);
  });

  it('sets isJiraVerified when setJiraVerified is called', () => {
    useConnectionStore.getState().setJiraVerified(true);

    expect(useConnectionStore.getState().isJiraVerified).toBe(true);
  });

  it('sets isSnowVerified when setSnowVerified is called', () => {
    useConnectionStore.getState().setSnowVerified(true);

    expect(useConnectionStore.getState().isSnowVerified).toBe(true);
  });

  it('clears all connection state back to defaults', () => {
    useConnectionStore.getState().setProxyStatus(MOCK_PROXY_STATUS);
    useConnectionStore.getState().setRelayBridgeStatus(MOCK_RELAY_STATUS);
    useConnectionStore.getState().setJiraVerified(true);
    useConnectionStore.getState().setSnowVerified(true);

    useConnectionStore.getState().clearConnectionState();

    expect(useConnectionStore.getState().isJiraReady).toBe(false);
    expect(useConnectionStore.getState().isSnowReady).toBe(false);
    expect(useConnectionStore.getState().isJiraVerified).toBe(false);
    expect(useConnectionStore.getState().isSnowVerified).toBe(false);
    expect(useConnectionStore.getState().isConfluenceReady).toBe(false);
    expect(useConnectionStore.getState().isGitHubReady).toBe(false);
    expect(useConnectionStore.getState().proxyStatus).toBeNull();
    expect(useConnectionStore.getState().relayBridgeStatus).toBeNull();
  });
});
