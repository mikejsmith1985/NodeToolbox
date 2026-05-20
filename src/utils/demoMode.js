// src/utils/demoMode.js — Detects first-install demo requests without touching saved credentials.

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

/** Query parameter used by links that launch a safe first-install demo. */
const DEMO_MODE_QUERY_PARAMETER = 'demo';

/** Expected query/header value that enables demo behavior for one browser tab. */
const DEMO_MODE_VALUE = '1';

/** HTTP header added by the React demo-mode runtime for same-origin API calls. */
const DEMO_MODE_REQUEST_HEADER = 'x-nodetoolbox-demo-mode';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether an Express request belongs to the first-install demo flow.
 *
 * Demo mode can arrive through the initial `?demo=1` URL or through the
 * same-origin header added by the React app after it removes the visible query
 * string. This keeps the demo tab isolated without changing global server state.
 *
 * @param {import('express').Request} request - Incoming Express request.
 * @returns {boolean} True when the request should ignore saved credentials.
 */
function isDemoModeRequest(request) {
  const queryDemoValue = request.query && request.query[DEMO_MODE_QUERY_PARAMETER];
  const headerDemoValue = request.get && request.get(DEMO_MODE_REQUEST_HEADER);
  return queryDemoValue === DEMO_MODE_VALUE || headerDemoValue === DEMO_MODE_VALUE;
}

/**
 * Adds the demo query parameter to a local path so the target page stays isolated.
 *
 * @param {string} localPath - Root-relative path such as `/setup`.
 * @returns {string} The same path with `demo=1` appended.
 */
function createDemoModePath(localPath) {
  const separator = localPath.indexOf('?') >= 0 ? '&' : '?';
  return `${localPath}${separator}${DEMO_MODE_QUERY_PARAMETER}=${DEMO_MODE_VALUE}`;
}

module.exports = {
  DEMO_MODE_REQUEST_HEADER,
  DEMO_MODE_VALUE,
  createDemoModePath,
  isDemoModeRequest,
};
