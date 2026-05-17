// connectionStore.ts — Zustand state for backend connection health and relay bridge availability.

import { create } from 'zustand';

import type { ProxyStatusResponse } from '../types/config.ts';
import type { RelayBridgeStatus } from '../types/relay.ts';

const DEFAULT_CONNECTION_STATE = {
  isJiraReady: false,
  isSnowReady: false,
  isJiraVerified: false,
  isSnowVerified: false,
  isConfluenceReady: false,
  isGitHubReady: false,
  proxyStatus: null,
  relayBridgeStatus: null,
} as const;

interface ConnectionState {
  isJiraReady: boolean;
  isSnowReady: boolean;
  /** True only after a live probe to /jira-proxy/rest/api/2/myself returned 200. */
  isJiraVerified: boolean;
  /** True only after a live probe to /snow-proxy/api/now/table/sys_user returned 200. */
  isSnowVerified: boolean;
  /** True when Confluence base URL and credentials are configured. */
  isConfluenceReady: boolean;
  /** True when a GitHub PAT or GitHub App is configured. */
  isGitHubReady: boolean;
  proxyStatus: ProxyStatusResponse | null;
  relayBridgeStatus: RelayBridgeStatus | null;
  setProxyStatus: (status: ProxyStatusResponse) => void;
  setRelayBridgeStatus: (status: RelayBridgeStatus) => void;
  setJiraVerified: (isVerified: boolean) => void;
  setSnowVerified: (isVerified: boolean) => void;
  clearConnectionState: () => void;
}

/** Zustand store for globally shared proxy and relay connection status. */
export const useConnectionStore = create<ConnectionState>((setState) => ({
  ...DEFAULT_CONNECTION_STATE,
  setProxyStatus: (status) =>
    setState({
      proxyStatus: status,
      isJiraReady: status.jira.ready,
      isSnowReady: status.snow.ready,
      isConfluenceReady: status.confluence.ready,
      isGitHubReady: status.github.ready,
    }),
  setRelayBridgeStatus: (status) =>
    setState({
      relayBridgeStatus: status,
    }),
  setJiraVerified: (isVerified) =>
    setState({
      isJiraVerified: isVerified,
    }),
  setSnowVerified: (isVerified) =>
    setState({
      isSnowVerified: isVerified,
    }),
  clearConnectionState: () => setState(DEFAULT_CONNECTION_STATE),
}));
