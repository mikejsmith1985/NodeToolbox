// proxyApi.ts — Typed client for Express /api endpoints used by the React SPA.

import type { ConnectionProbeResult, ProxyConfig, ProxyStatusResponse } from '../types/config.ts';

const PROXY_STATUS_ENDPOINT = '/api/proxy-status';
const PROXY_CONFIG_ENDPOINT = '/api/proxy-config';
const JIRA_PROBE_ENDPOINT = '/jira-proxy/rest/api/2/myself';
const SNOW_PROBE_ENDPOINT = '/snow-proxy/api/now/table/sys_user?sysparm_limit=1';
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

/**
 * Performs a live probe to Jira's /myself endpoint to verify credentials actually work.
 * Returns a ConnectionProbeResult rather than throwing so callers can handle
 * auth failures gracefully without crashing the polling loop.
 */
export async function probeJiraConnection(): Promise<ConnectionProbeResult> {
  try {
    const response = await fetch(JIRA_PROBE_ENDPOINT);
    return {
      isOk: response.ok,
      statusCode: response.status,
      message: response.ok
        ? 'Jira connection verified.'
        : `Jira returned HTTP ${response.status} — check your credentials in Admin Hub.`,
    };
  } catch {
    return {
      isOk: false,
      statusCode: 0,
      message: 'Jira is unreachable — check the proxy base URL in Admin Hub.',
    };
  }
}

/**
 * Performs a live probe to the SNow sys_user table to verify credentials actually work.
 * Returns a ConnectionProbeResult rather than throwing so callers can handle
 * auth failures gracefully without crashing the polling loop.
 */
export async function probeSnowConnection(): Promise<ConnectionProbeResult> {
  try {
    const response = await fetch(SNOW_PROBE_ENDPOINT);
    return {
      isOk: response.ok,
      statusCode: response.status,
      message: response.ok
        ? 'SNow connection verified.'
        : `SNow returned HTTP ${response.status} — check your credentials or activate the relay bridge.`,
    };
  } catch {
    return {
      isOk: false,
      statusCode: 0,
      message: 'SNow is unreachable — check the proxy base URL or activate the relay bridge.',
    };
  }
}
