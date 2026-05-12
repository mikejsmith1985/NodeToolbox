// relay.ts — Types describing relay bridge connectivity between the bookmarklet and React app.

/** External systems currently supported by the relay bridge. */
export type RelaySystem = 'snow';

/** Current connection status for a relay bridge channel. */
export interface RelayBridgeStatus {
  system: RelaySystem;
  isConnected: boolean;
  lastPingAt: string | null;
  version: string | null;
  /** True when the ServiceNow bookmarklet found g_ck, which is needed for write APIs. */
  hasSessionToken?: boolean;
}

/** Relay channel registration metadata returned by the backend. */
export interface RelayChannel {
  channelId: string;
  system: RelaySystem;
  isRegistered: boolean;
}

/**
 * A request enqueued for the bookmarklet to execute on behalf of the React client.
 * The bookmarklet fetches `window.location.origin + path` using the user's Okta session cookies.
 */
export interface RelayRequest {
  sys: RelaySystem;
  /** Unique identifier used to match this request with its result. */
  id: string;
  method: string;
  /** ServiceNow API path, e.g. /api/now/table/incident — bookmarklet prepends the SNow origin. */
  path: string;
  body?: unknown;
  /** Optional bearer/PAT auth header; ServiceNow normally uses g_ck from the bookmarklet instead. */
  authHeader?: string | null;
}

/** Result posted by the bookmarklet after executing a relay request. */
export interface RelayResult {
  id: string;
  ok: boolean;
  status: number;
  /** Raw response text from the bookmarklet's fetch — JSON.parse before use. */
  data: unknown;
  error: string | null;
}
