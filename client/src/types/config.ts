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

/** Response shape for GET /api/proxy-status. */
export interface ProxyStatusResponse {
  version: string;
  jiraConfigured: boolean;
  snowConfigured: boolean;
  confluenceConfigured: boolean;
  schedulerEnabled: boolean;
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
