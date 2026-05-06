// relayBridgeApi.ts — Typed client for relay bridge registration, status, and polling endpoints.

import type { RelayBridgeStatus, RelaySystem } from '../types/relay.ts';

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

/** Checks whether a relay bridge channel is active for the given system. */
export async function fetchRelayStatus(system: RelaySystem): Promise<RelayBridgeStatus> {
  const response = await fetch(`${RELAY_BASE}/status?sys=${system}`);

  assertSuccessfulResponse(response, 'Relay status check failed');
  return parseJsonResponse<RelayBridgeStatus>(response);
}

/** Registers this React client as a relay consumer for the given system. */
export async function registerRelay(system: RelaySystem): Promise<void> {
  const response = await fetch(`${RELAY_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify({ sys: system }),
  });

  assertSuccessfulResponse(response, 'Relay registration failed');
}

/** Polls for pending relay messages for the given system. */
export async function pollRelay<ResponseBody>(system: RelaySystem): Promise<ResponseBody[]> {
  const response = await fetch(`${RELAY_BASE}/poll?sys=${system}`);

  assertSuccessfulResponse(response, 'Relay poll failed');
  return parseJsonResponse<ResponseBody[]>(response);
}
