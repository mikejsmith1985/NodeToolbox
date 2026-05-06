// relay.ts — Types describing relay bridge connectivity between the bookmarklet and React app.

/** External systems currently supported by the relay bridge. */
export type RelaySystem = 'snow';

/** Current connection status for a relay bridge channel. */
export interface RelayBridgeStatus {
  system: RelaySystem;
  isConnected: boolean;
  lastPingAt: string | null;
  version: string | null;
}

/** Relay channel registration metadata returned by the backend. */
export interface RelayChannel {
  channelId: string;
  system: RelaySystem;
  isRegistered: boolean;
}
