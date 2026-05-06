// connectionStore.ts — Zustand state for backend connection health and relay bridge availability.

import { create } from 'zustand';

import type { ProxyStatusResponse } from '../types/config.ts';
import type { RelayBridgeStatus } from '../types/relay.ts';

const DEFAULT_CONNECTION_STATE = {
  isJiraReady: false,
  isSnowReady: false,
  proxyStatus: null,
  relayBridgeStatus: null,
} as const;

interface ConnectionState {
  isJiraReady: boolean;
  isSnowReady: boolean;
  proxyStatus: ProxyStatusResponse | null;
  relayBridgeStatus: RelayBridgeStatus | null;
  setProxyStatus: (status: ProxyStatusResponse) => void;
  setRelayBridgeStatus: (status: RelayBridgeStatus) => void;
  clearConnectionState: () => void;
}

/** Zustand store for globally shared proxy and relay connection status. */
export const useConnectionStore = create<ConnectionState>((setState) => ({
  ...DEFAULT_CONNECTION_STATE,
  setProxyStatus: (status) =>
    setState({
      proxyStatus: status,
      isJiraReady: status.jiraConfigured,
      isSnowReady: status.snowConfigured,
    }),
  setRelayBridgeStatus: (status) =>
    setState({
      relayBridgeStatus: status,
    }),
  clearConnectionState: () => setState(DEFAULT_CONNECTION_STATE),
}));
