// snowSameOriginTransport.ts — Calls ServiceNow directly from the Wizard window, which belongs to ServiceNow's own
// origin (proven live by the probe, research R-001). It sends exactly what Toolbox's relay bookmarklet sends.

import type { RelayRequest, RelayResult } from '../../types/relay.ts';
import type { SnowTransport } from './wizardTransports.ts';

const HTTP_UNAUTHORIZED = 401;
const JSON_CONTENT_TYPE = 'application/json';

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

/** What the transport needs from the Wizard window. */
export interface SnowSameOriginTransportOptions {
  instanceOrigin: string;
  initialToken: string;
  fetchFn: FetchFunction;
  /** Asks the ServiceNow tab for a fresh session token; null when nobody answers. */
  requestFreshToken: () => Promise<string | null>;
  /** Called when the session cannot be recovered, so the Wizard can show "reconnect". */
  onSessionExpired: () => void;
}

/** The part of a BroadcastChannel the token request uses. */
export interface TokenRequestChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (messageEvent: MessageEvent) => void): void;
  close(): void;
}

function decodeBase64ToBytes(encodedText: string): Uint8Array {
  const binaryText = atob(encodedText);
  const decodedBytes = new Uint8Array(binaryText.length);
  for (let i = 0; i < binaryText.length; i++) decodedBytes[i] = binaryText.charCodeAt(i);
  return decodedBytes;
}

function buildRequestBody(relayRequest: RelayRequest): BodyInit | undefined {
  if (relayRequest.body === null || relayRequest.body === undefined) return undefined;
  if (relayRequest.bodyEncoding === 'base64') return decodeBase64ToBytes(String(relayRequest.body)) as BodyInit;
  return typeof relayRequest.body === 'string' ? relayRequest.body : JSON.stringify(relayRequest.body);
}

function buildRequestInit(relayRequest: RelayRequest, userToken: string): RequestInit {
  const isBinaryBody = relayRequest.bodyEncoding === 'base64';
  const requestHeaders: Record<string, string> = {
    'Content-Type': isBinaryBody ? (relayRequest.contentType || 'application/octet-stream') : JSON_CONTENT_TYPE,
    Accept: JSON_CONTENT_TYPE,
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (userToken) requestHeaders['X-UserToken'] = userToken;
  return { method: (relayRequest.method || 'GET').toUpperCase(), credentials: 'include', headers: requestHeaders, body: buildRequestBody(relayRequest) };
}

async function sendOnce(options: SnowSameOriginTransportOptions, relayRequest: RelayRequest, userToken: string): Promise<RelayResult> {
  try {
    const snowResponse = await options.fetchFn(options.instanceOrigin + relayRequest.path, buildRequestInit(relayRequest, userToken));
    return { id: relayRequest.id, ok: snowResponse.ok, status: snowResponse.status, data: await snowResponse.text(), error: null };
  } catch (requestError) {
    return { id: relayRequest.id, ok: false, status: 0, data: null, error: (requestError as Error).message };
  }
}

/**
 * Creates the ServiceNow connection for the Wizard window. A 401 is retried once with a fresh token from the
 * ServiceNow tab; if none comes, the Wizard is told the session expired.
 */
export function createSnowSameOriginTransport(
  options: SnowSameOriginTransportOptions,
): SnowTransport & { readToken(): string; updateToken(freshToken: string): void } {
  let currentToken = options.initialToken;
  return {
    readToken: () => currentToken,
    // The ServiceNow tab pushes a fresh token when the user clicks the bookmark again (bookmarkPayload).
    updateToken: (freshToken) => { if (freshToken) currentToken = freshToken; },
    execute: async (relayRequest) => {
      const firstResult = await sendOnce(options, relayRequest, currentToken);
      if (firstResult.status !== HTTP_UNAUTHORIZED) return firstResult;
      const freshToken = await options.requestFreshToken();
      if (!freshToken) {
        options.onSessionExpired();
        return firstResult;
      }
      currentToken = freshToken;
      const retriedResult = await sendOnce(options, relayRequest, currentToken);
      if (retriedResult.status === HTTP_UNAUTHORIZED) options.onSessionExpired();
      return retriedResult;
    },
  };
}

/** Asks the ServiceNow tab (which ran the bookmark) for a fresh session token over a same-origin channel. */
export function requestTokenOverChannel(
  createChannel: (channelName: string) => TokenRequestChannel,
  channelName: string,
  timeoutMs: number,
): Promise<string | null> {
  const tokenChannel = createChannel(channelName);
  return new Promise((resolve) => {
    const finish = (freshToken: string | null) => {
      clearTimeout(timeoutId);
      tokenChannel.close();
      resolve(freshToken);
    };
    const timeoutId = setTimeout(() => finish(null), timeoutMs);
    tokenChannel.addEventListener('message', (messageEvent: MessageEvent) => {
      if (messageEvent.data?.kind === 'token' && messageEvent.data.token) finish(String(messageEvent.data.token));
    });
    tokenChannel.postMessage({ kind: 'tokenRequest' });
  });
}
