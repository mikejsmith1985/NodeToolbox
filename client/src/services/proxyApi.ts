// proxyApi.ts — Typed client for Express /api endpoints used by the React SPA.

import type { ProxyConfig, ProxyStatusResponse } from '../types/config.ts';

const PROXY_STATUS_ENDPOINT = '/api/proxy-status';
const PROXY_CONFIG_ENDPOINT = '/api/proxy-config';
const JSON_CONTENT_TYPE = 'application/json';

function assertSuccessfulResponse(response: Response, messagePrefix: string): void {
  if (!response.ok) {
    throw new Error(`${messagePrefix}: ${response.status}`);
  }
}

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

/** Fetches current proxy health and credential configuration state. */
export async function fetchProxyStatus(): Promise<ProxyStatusResponse> {
  const response = await fetch(PROXY_STATUS_ENDPOINT);

  assertSuccessfulResponse(response, 'proxy-status fetch failed');
  return parseJsonResponse<ProxyStatusResponse>(response);
}

/** Reads the full proxy configuration including service URLs and admin settings. */
export async function fetchProxyConfig(): Promise<ProxyConfig> {
  const response = await fetch(PROXY_CONFIG_ENDPOINT);

  assertSuccessfulResponse(response, 'proxy-config fetch failed');
  return parseJsonResponse<ProxyConfig>(response);
}

/** Persists updated proxy configuration to the Express backend. */
export async function updateProxyConfig(config: Partial<ProxyConfig>): Promise<void> {
  const response = await fetch(PROXY_CONFIG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(config),
  });

  assertSuccessfulResponse(response, 'proxy-config update failed');
}
