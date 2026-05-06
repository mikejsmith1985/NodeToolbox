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

/** Supported application themes stored in browser settings. */
export type Theme = 'dark' | 'light';
