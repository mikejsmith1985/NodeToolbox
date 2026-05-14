// relayBridgeApi.ts — Typed client for relay bridge registration, status, and request/result endpoints.

import type { RelayBridgeStatus, RelayRequest, RelayResult, RelaySystem } from '../types/relay.ts';

const RELAY_BASE = '/api/relay-bridge';
const JSON_CONTENT_TYPE = 'application/json';

function assertSuccessfulResponse(response: Response, messagePrefix: string): void {
  if (!response.ok) {
    throw new Error(`${messagePrefix}: ${response.status}`);
  }
}

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const errorEnvelope = await parseJsonResponse<{ error?: unknown }>(response);
    return typeof errorEnvelope.error === 'string' ? errorEnvelope.error : null;
  } catch {
    return null;
  }
}

/** Checks whether a relay bridge channel is active for the given system. */
export async function fetchRelayStatus(system: RelaySystem): Promise<RelayBridgeStatus> {
  const response = await fetch(`${RELAY_BASE}/status?sys=${system}`);

  assertSuccessfulResponse(response, 'Relay status check failed');
  return parseJsonResponse<RelayBridgeStatus>(response);
}

/** Registers this React client as a relay consumer for the given system. */
export async function registerRelay(system: RelaySystem): Promise<void> {
  const response = await fetch(`${RELAY_BASE}/register?sys=${system}`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify({}),
  });

  assertSuccessfulResponse(response, 'Relay registration failed');
}

/** Polls for the next pending relay request for the given system. */
export async function pollRelay<ResponseBody>(system: RelaySystem): Promise<{ request: ResponseBody | null }> {
  const response = await fetch(`${RELAY_BASE}/poll?sys=${system}`);

  assertSuccessfulResponse(response, 'Relay poll failed');
  return parseJsonResponse<{ request: ResponseBody | null }>(response);
}

/**
 * Enqueues a request for the bookmarklet to execute on the target system's origin.
 * The bookmarklet will fetch `window.location.origin + request.path` using its Okta session.
 */
export async function postRelayRequest(request: RelayRequest): Promise<void> {
  const response = await fetch(`${RELAY_BASE}/request`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(request),
  });

  assertSuccessfulResponse(response, 'Relay request enqueue failed');
}

/**
 * Long-polls for the result of a specific relay request.
 * Resolves once the bookmarklet posts the result; throws on timeout (408) or server error.
 */
export async function waitForRelayResult(requestId: string, system: RelaySystem): Promise<RelayResult> {
  const response = await fetch(`${RELAY_BASE}/result/${requestId}?sys=${system}`);

  // 408 means the bookmarklet did not respond within the server's 30-second window
  if (response.status === 408) {
    throw new Error(
      'Relay bridge timed out (30 seconds). Is the bookmarklet still active on the ServiceNow page?',
    );
  }
  if (!response.ok) {
    const relayErrorMessage = await readErrorMessage(response);
    if (relayErrorMessage !== null) {
      throw new Error(relayErrorMessage);
    }
  }
  assertSuccessfulResponse(response, 'Relay result collection failed');

  const envelope = await parseJsonResponse<{ result: RelayResult }>(response);
  return envelope.result;
}
