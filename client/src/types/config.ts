// config.ts — Interfaces describing proxy configuration, credential readiness, and app theme state.

/** Full proxy configuration managed by the Express backend. */
export interface ProxyConfig {
  jiraBaseUrl: string;
  snowBaseUrl: string;
  confluenceBaseUrl: string;
  adminPin: string;
}

/** Credential availability flags consumed by connection-aware UI components. */
export interface CredentialState {
  isJiraConfigured: boolean;
  isSnowConfigured: boolean;
  isConfluenceConfigured: boolean;
}

/** Response shape for GET /api/proxy-status. Matches the server's actual JSON output. */
export interface ProxyServiceStatus {
  /** True when a base URL is set for this service in the config file. */
  configured: boolean;
  /** True when both a base URL and at least one credential are present. */
  hasCredentials: boolean;
  /** True when the service is fully configured and credentials are present (Jira/SNow/GitHub/Confluence). */
  ready: boolean;
  /** The service base URL if configured, or null. */
  baseUrl?: string | null;
}

export interface ProxySnowStatus extends ProxyServiceStatus {
  /** True when a SNow OAuth session (rather than basic auth) is active. */
  sessionMode: boolean;
  /** ISO timestamp when the current SNow session expires, or null. */
  sessionExpiresAt: string | null;
}

export interface ProxyStatusResponse {
  version: string;
  sslVerify: boolean;
  jira: ProxyServiceStatus;
  snow: ProxySnowStatus;
  github: ProxyServiceStatus;
  confluence: ProxyServiceStatus;
}

/**
 * Result of a live connection probe — distinguishes a service being configured
 * (URL + credentials present) from a service that actually responds successfully.
 */
export interface ConnectionProbeResult {
  /** True when the remote service returned a successful HTTP response. */
  isOk: boolean;
  /** The HTTP status code, or 0 if the request never completed (network error). */
  statusCode: number;
  /** Human-readable summary suitable for display in an error message. */
  message: string;
}

/** Supported application themes stored in browser settings. */
export type Theme = 'dark' | 'light';
