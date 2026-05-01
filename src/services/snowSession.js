// src/services/snowSession.js — In-memory ServiceNow browser session store.
//
// ServiceNow in some corporate environments requires Okta browser authentication.
// After the user logs in through Okta, the browser relays the g_ck (UserToken)
// to the proxy via POST /api/snow-session. The proxy then uses that token on
// all /snow-proxy/* requests, bypassing the need for a service account.

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

/** Default session lifetime in seconds when the caller does not specify one */
const DEFAULT_SESSION_LIFETIME_SECONDS = 7200; // 2 hours

// ── Session Store ─────────────────────────────────────────────────────────────

/**
 * In-memory SNow session state. Reset on every server restart.
 * The g_ck token is the SNow X-UserToken value forwarded from the browser.
 */
const snowSessionState = {
  gck:       null,   // ServiceNow g_ck / X-UserToken value
  baseUrl:   null,   // SNow base URL captured at handoff time
  storedAt:  null,   // Unix timestamp (seconds) when the session was stored
  expiresAt: null,   // Unix timestamp (seconds) after which the session is considered stale
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Stores a new SNow browser session token in memory.
 * Overwrites any existing session — only one session is active at a time.
 *
 * @param {string} gck              - The SNow g_ck / X-UserToken value
 * @param {string} baseUrl          - The SNow instance base URL at handoff time
 * @param {number} [lifetimeSeconds] - How long the session should be valid (default: 2 hours)
 */
function storeSession(gck, baseUrl, lifetimeSeconds) {
  // Use nullish coalescing semantics — only fall back to default when genuinely not provided.
  // This allows callers to pass 0 to create an immediately-expired session for testing.
  const sessionLifetime   = (lifetimeSeconds != null) ? lifetimeSeconds : DEFAULT_SESSION_LIFETIME_SECONDS;
  const nowUnixSeconds    = Date.now() / 1000;

  snowSessionState.gck       = gck;
  snowSessionState.baseUrl   = (baseUrl || '').trim();
  snowSessionState.storedAt  = nowUnixSeconds;
  snowSessionState.expiresAt = nowUnixSeconds + sessionLifetime;

  console.log('  ✅ SNow session stored (expires in ' + sessionLifetime + 's) baseUrl=' + snowSessionState.baseUrl);
}

/**
 * Returns the current session status without exposing the raw token.
 *
 * @returns {{ hasSession: boolean, isActive: boolean, expiresAt: number|null, baseUrl: string|null }}
 */
function getSessionStatus() {
  const isActive = isSessionActive();
  return {
    hasSession: !!snowSessionState.gck,
    isActive,
    expiresAt:  snowSessionState.expiresAt,
    baseUrl:    snowSessionState.baseUrl,
  };
}

/**
 * Clears the stored SNow session from memory.
 * Called on DELETE /api/snow-session or when the user explicitly signs out.
 */
function clearSession() {
  snowSessionState.gck       = null;
  snowSessionState.baseUrl   = null;
  snowSessionState.storedAt  = null;
  snowSessionState.expiresAt = null;
  console.log('  🗑  SNow session cleared');
}

/**
 * Returns whether the stored session token is still valid (exists and not expired).
 *
 * @returns {boolean}
 */
function isSessionActive() {
  return !!(
    snowSessionState.gck &&
    snowSessionState.expiresAt &&
    (Date.now() / 1000) < snowSessionState.expiresAt
  );
}

/**
 * Builds the session headers to inject on SNow proxy requests when a live
 * session is available. Returns an empty object when no session is active.
 *
 * @returns {{ 'X-UserToken': string }|{}}
 */
function buildSessionHeaders() {
  if (!isSessionActive()) return {};
  return { 'X-UserToken': snowSessionState.gck };
}

/**
 * Returns the effective SNow base URL — from the live session if available,
 * falling back to the configured service URL.
 *
 * @param {string} [configuredBaseUrl] - The baseUrl from toolbox-proxy.json
 * @returns {string}
 */
function resolveSnowBaseUrl(configuredBaseUrl) {
  if (isSessionActive() && snowSessionState.baseUrl) {
    return snowSessionState.baseUrl;
  }
  return configuredBaseUrl || '';
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  storeSession,
  getSessionStatus,
  clearSession,
  isSessionActive,
  buildSessionHeaders,
  resolveSnowBaseUrl,
  DEFAULT_SESSION_LIFETIME_SECONDS,
};
