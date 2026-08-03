// snowApi.ts — ServiceNow API client that uses the browser bookmarklet relay by default.
//
// The relay bridge (bookmarklet on an authenticated SNow page) is the primary path for
// SNow connections that require Okta SSO cookies — something the server-side proxy cannot
// provide because the server process does not have a browser session.

import { useConnectionStore } from '../store/connectionStore.ts';
import { postRelayRequest, waitForRelayResult } from './relayBridgeApi.ts';
import type { RelaySystem } from '../types/relay.ts';

const SNOW_PROXY_BASE = '/snow-proxy';
const SNOW_RELAY_SYSTEM: RelaySystem = 'snow';

/** Additional fetch options accepted by the ServiceNow proxy client. */
export interface SnowFetchOptions extends RequestInit {
  /** If true, use the server-side proxy for diagnostics/admin tests instead of the browser relay. */
  forceDirectProxy?: boolean;
}

function assertSuccessfulResponse(response: Response, path: string): void {
  if (!response.ok) {
    throw new Error(`SNow fetch ${path} failed: ${response.status}`);
  }
}

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

function removeRelayOnlyOptions(options: SnowFetchOptions): RequestInit {
  const fetchOptions: SnowFetchOptions = { ...options };
  delete fetchOptions.forceDirectProxy;
  return fetchOptions;
}

/**
 * Pulls ServiceNow's own error message/detail out of a failed response body, or '' when absent.
 * The bookmarklet posts the response text even for failed requests, and ServiceNow puts the
 * human-readable rejection reason (ACL, data policy, business rule) in `error.message/detail` —
 * surfacing it turns a bare "403" into an actionable message (GH #282).
 */
function extractSnowErrorDetail(responseData: unknown): string {
  try {
    const parsedBody = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
    const errorBlock = (parsedBody as { error?: { message?: string; detail?: string } } | null)?.error;
    const messageParts = [errorBlock?.message, errorBlock?.detail]
      .filter((messagePart): messagePart is string => typeof messagePart === 'string' && messagePart.trim() !== '');
    return messageParts.length > 0 ? ` — ServiceNow says: ${messageParts.join(' · ')}` : '';
  } catch {
    return '';
  }
}

function getAuthorizationHeader(headers: HeadersInit | undefined): string | null {
  if (headers === undefined) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get('Authorization') ?? headers.get('authorization');
  }

  if (Array.isArray(headers)) {
    const authorizationHeader = headers.find(([headerName]) => headerName.toLowerCase() === 'authorization');
    return authorizationHeader?.[1] ?? null;
  }

  const headerRecord = headers as Record<string, string>;
  return headerRecord.Authorization ?? headerRecord.authorization ?? null;
}

/**
 * Fetches a ServiceNow resource through the browser relay.
 *
 * Normal app traffic uses the same bookmarklet tab flow as ToolBox v0.20.13.
 * The server proxy is reserved for explicit diagnostics/admin probes via forceDirectProxy.
 */
export async function snowFetch<ResponseBody>(
  path: string,
  options: SnowFetchOptions = {},
): Promise<ResponseBody> {
  if (options.forceDirectProxy === true) {
    const fetchOptions = removeRelayOnlyOptions(options);
    const response = await fetch(`${SNOW_PROXY_BASE}${path}`, fetchOptions);
    assertSuccessfulResponse(response, path);
    return parseJsonResponse<ResponseBody>(response);
  }

  const relayBridgeStatus = useConnectionStore.getState().relayBridgeStatus;
  const isRelayActive = relayBridgeStatus?.isConnected ?? false;

  if (!isRelayActive) {
    throw new Error(
      'SNow relay not connected. Click Relay -> Open ServiceNow, then click the NodeToolbox SNow Relay bookmarklet.',
    );
  }

  return snowRelayFetch<ResponseBody>(path, options);
}

/**
 * Routes a ServiceNow fetch through the relay bridge bookmarklet.
 *
 * Enqueues the request for the ServiceNow bookmarklet to execute from the SNow tab.
 * This HTTP bridge avoids Chrome/Edge COOP breaking postMessage between tabs.
 */
async function snowRelayFetch<ResponseBody>(
  path: string,
  options: SnowFetchOptions,
): Promise<ResponseBody> {
  const requestId = crypto.randomUUID();
  const method = ((options.method as string | undefined) ?? 'GET').toUpperCase();
  const hasSessionToken = useConnectionStore.getState().relayBridgeStatus?.hasSessionToken ?? false;

  if (method !== 'GET' && !hasSessionToken) {
    throw new Error(
      'SNow session token (g_ck) not ready. Wait for ServiceNow to finish loading, then click the NodeToolbox SNow Relay bookmarklet again.',
    );
  }

  // Parse body from its serialized string form back to an object for the relay envelope.
  // The bookmarklet re-serializes it when forwarding to the SNow origin.
  let requestBody: unknown = null;
  if (options.body !== null && options.body !== undefined) {
    try {
      requestBody = JSON.parse(options.body as string);
    } catch {
      requestBody = options.body;
    }
  }

  await postRelayRequest({
    sys: SNOW_RELAY_SYSTEM,
    id: requestId,
    method,
    path,
    body:       requestBody,
    authHeader: getAuthorizationHeader(options.headers),
  });

  const result = await waitForRelayResult(requestId, SNOW_RELAY_SYSTEM);

  if (!result.ok) {
    const relayErrorDetail = result.error !== null ? ` — ${result.error}` : '';
    const snowErrorDetail = extractSnowErrorDetail(result.data);
    // 401/403 is ambiguous from a relayed page: it can be a session/permission problem OR a
    // data-policy/business-rule rejection (GH #282) — say so instead of assuming authorization.
    const sessionHint = result.status === 401 || result.status === 403
      ? ' (ServiceNow rejected the relayed request — this can be a session/permission problem or a data-policy rejection; check the ServiceNow message if shown, otherwise refresh the SNow tab and re-click the bookmarklet.)'
      : '';
    throw new Error(`SNow relay fetch ${path} failed: ${result.status}${relayErrorDetail}${snowErrorDetail}${sessionHint}`);
  }

  // The bookmarklet collects the response via a.text(), so result.data is a JSON string.
  // Older relay paths return a JSON string; the browser relay returns parsed JSON.
  if (typeof result.data === 'string') {
    try {
      return JSON.parse(result.data) as ResponseBody;
    } catch {
      return result.data as ResponseBody;
    }
  }
  return result.data as ResponseBody;
}
