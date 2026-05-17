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

export interface ProxyGitHubStatus extends ProxyServiceStatus {
  /** ISO timestamp of the last live connectivity probe, or null if never probed. */
  probeCheckedAt: string | null;
}

export interface ProxyStatusResponse {
  version: string;
  sslVerify: boolean;
  jira: ProxyServiceStatus;
  snow: ProxySnowStatus;
  github: ProxyGitHubStatus;
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

/** Sanitized connectivity configuration returned by GET /api/config/connectivity. */
export interface ConnectivityConfigResult {
  snow: {
    /** The ServiceNow instance base URL (e.g. https://acme.service-now.com). */
    baseUrl: string;
    /** True when both username and password are stored in server config. */
    hasCredentials: boolean;
    /** Masked username for display — e.g. "svc_****x". */
    usernameMasked: string;
  };
  github: {
    /** The GitHub API base URL. */
    baseUrl: string;
    /** True when a PAT is stored in server config. */
    hasPat: boolean;
    /** True when all three GitHub App credentials (appId, installationId, appPrivateKey) are stored. */
    hasAppAuth: boolean;
  };
  confluence: {
    /** The Confluence Cloud base URL (e.g. https://yoursite.atlassian.net). */
    baseUrl: string;
    /** True when both Atlassian email and API token are stored in server config. */
    hasCredentials: boolean;
    /** Masked email for display — e.g. "you@****m". */
    usernameMasked: string;
  };
}

/** Fields accepted by POST /api/config/connectivity. */
export interface ConnectivityConfigUpdate {
  snow?: {
    baseUrl?: string;
    /** Only sent when the user types a new value — empty string = do not update. */
    username?: string;
    /** Only sent when the user types a new value — empty string = do not update. */
    password?: string;
  };
  github?: {
    baseUrl?: string;
    /** Only sent when the user types a new value — empty string = do not update. */
    pat?: string;
    /** GitHub App ID (numeric, shown on the app settings page). */
    appId?: string;
    /** GitHub App Installation ID (visible in the installation URL). */
    installationId?: string;
    /** RSA private key PEM downloaded from GitHub App settings. Highly sensitive. */
    appPrivateKey?: string;
  };
  confluence?: {
    baseUrl?: string;
    /** Atlassian account email — only sent when the user types a new value. */
    username?: string;
    /** Atlassian Cloud API token — only sent when the user types a new value. */
    apiToken?: string;
  };
}
