// connectivityConfigApi.ts — Typed client for the /api/config/connectivity endpoints.
// Fetches, saves, and tests Snow, GitHub, and Confluence server-side connectivity configuration.

import type { ConnectivityConfigResult, ConnectivityConfigUpdate, ConnectionProbeResult } from '../types/config.ts';

const CONNECTIVITY_BASE = '/api/config/connectivity';
const JSON_CONTENT_TYPE = 'application/json';

/** Throws a descriptive error when the HTTP response status is not in the 2xx range. */
function assertOkResponse(response: Response, errorPrefix: string): void {
  if (!response.ok) {
    throw new Error(`${errorPrefix}: HTTP ${response.status}`);
  }
}

/** Fetches the current sanitized Snow, GitHub, and Confluence connectivity config from the server. */
export async function fetchConnectivityConfig(): Promise<ConnectivityConfigResult> {
  const response = await fetch(CONNECTIVITY_BASE);
  assertOkResponse(response, 'Failed to load connectivity config');
  return response.json() as Promise<ConnectivityConfigResult>;
}

/** Saves updated Snow, GitHub, and/or Confluence config fields to the server (persisted to toolbox-proxy.json). */
export async function saveConnectivityConfig(
  update: ConnectivityConfigUpdate,
): Promise<ConnectivityConfigResult> {
  const response = await fetch(CONNECTIVITY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(update),
  });
  assertOkResponse(response, 'Failed to save connectivity config');
  return response.json() as Promise<ConnectivityConfigResult>;
}

/**
 * Parses a raw probe response from the server and maps the `ok` field to `isOk`.
 * The server returns `{ ok, statusCode, message }` but our TypeScript interface
 * uses `isOk` — a direct `as` cast would silently leave `isOk` as undefined.
 */
async function parseProbeResponse(response: Response): Promise<ConnectionProbeResult> {
  const data = await response.json() as { ok: boolean; statusCode: number; message: string };
  return { isOk: data.ok, statusCode: data.statusCode, message: data.message };
}

/** Tests Snow connectivity using currently stored server credentials. */
export async function testSnowConnectivity(): Promise<ConnectionProbeResult> {
  const response = await fetch(`${CONNECTIVITY_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify({ system: 'snow' }),
  });
  return parseProbeResponse(response);
}

/** Tests GitHub connectivity using currently stored server PAT. */
export async function testGitHubConnectivity(): Promise<ConnectionProbeResult> {
  const response = await fetch(`${CONNECTIVITY_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify({ system: 'github' }),
  });
  return parseProbeResponse(response);
}

/** Tests Confluence connectivity using currently stored Atlassian credentials. */
export async function testConfluenceConnectivity(): Promise<ConnectionProbeResult> {
  const response = await fetch(`${CONNECTIVITY_BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify({ system: 'confluence' }),
  });
  return parseProbeResponse(response);
}
