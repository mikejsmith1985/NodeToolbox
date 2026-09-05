// relay.ts — Types describing relay bridge connectivity between the bookmarklet and React app.

/** External systems currently supported by the relay bridge. */
export type RelaySystem = 'snow' | 'sharepoint';

/** Current connection status for a relay bridge channel. */
export interface RelayBridgeStatus {
  system: RelaySystem;
  isConnected: boolean;
  lastPingAt: string | null;
  version: string | null;
  /** True when the ServiceNow bookmarklet found g_ck, which is needed for write APIs. */
  hasSessionToken?: boolean;
  /**
   * False when the far system REFUSED the last relayed request (401/403).
   *
   * Separate from `isConnected` because they are different facts and a dropped VPN makes them
   * disagree: the bookmarklet keeps long-polling this machine perfectly happily while every
   * SharePoint call comes back unauthorized. Showing that as connected is a false positive somebody
   * plans around.
   *
   * Optional, and treated as `true` when absent — an older server that does not report it has not
   * told us we are refused.
   */
  isAuthorized?: boolean;
  /** When the far system last refused us, so the panel can say how long it has been broken. */
  lastUnauthorizedAt?: string | null;
  /**
   * Which site the bookmarklet is running on, as it reported at registration.
   *
   * Optional: a bookmarklet from before this existed reports nothing, and that reads as "not known"
   * rather than as a mismatch.
   */
  relayOrigin?: string | null;
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
  /**
   * How `body` is carried. Absent means a JSON object the bookmarklet re-serializes; `base64` means
   * `body` is base64 text the bookmarklet decodes to raw bytes and sends as-is — the only way a
   * file (a zip of test evidence) can cross the JSON relay envelope.
   */
  bodyEncoding?: 'base64' | null;
  /** The Content-Type the far system should see for a base64 body, e.g. `application/zip`. */
  contentType?: string | null;
  /** How long the bookmarklet waits for the far system; absent means its default. Uploads need more. */
  timeoutMs?: number | null;
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
