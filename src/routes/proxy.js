// src/routes/proxy.js — Express router for all service proxy endpoints.
//
// Forwards browser requests to Jira, ServiceNow, and GitHub with server-side
// credential injection. The browser never sees API tokens or passwords —
// they are read from toolbox-proxy.json and injected here on the server.

'use strict';

const express    = require('express');
const { proxyRequest } = require('../utils/httpClient');
const snowSession      = require('../services/snowSession');

// ── Router Factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router with all proxy endpoints mounted.
 * Accepts the live configuration object so credential changes take effect
 * immediately without restarting the server.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {import('express').Router}
 */
function createProxyRouter(configuration) {
  const router = express.Router();

  // ── Jira Proxy ──────────────────────────────────────────────────────────────
  // Strips the /jira-proxy prefix and forwards the remainder to the Jira instance.
  // Supports Basic Auth (username + apiToken) and PAT (Bearer token).

  router.all('/jira-proxy/*', (req, res) => {
    const jiraPath = buildDownstreamPath(req.path, '/jira-proxy');
    proxyRequest(req, res, configuration.jira, jiraPath, null, configuration.sslVerify);
  });

  // ── ServiceNow Proxy ────────────────────────────────────────────────────────
  // Strips the /snow-proxy prefix. Uses g_ck session token if a browser session
  // has been handed off; falls back to Basic Auth credentials if configured.

  router.all('/snow-proxy/*', (req, res) => {
    const snowPath = buildDownstreamPath(req.path, '/snow-proxy');

    // Resolve the effective base URL — session base URL takes priority over config
    const effectiveBaseUrl = snowSession.resolveSnowBaseUrl(configuration.snow.baseUrl);
    const sessionHeaders   = snowSession.buildSessionHeaders();

    const snowServiceConfig = Object.assign({}, configuration.snow, { baseUrl: effectiveBaseUrl });
    proxyRequest(req, res, snowServiceConfig, snowPath, sessionHeaders, configuration.sslVerify);
  });

  // ── GitHub Proxy ────────────────────────────────────────────────────────────
  // Strips the /github-proxy prefix and injects the server-side GitHub PAT as
  // a Bearer token. The browser never stores or transmits the PAT directly.

  router.all('/github-proxy/*', (req, res) => {
    if (!configuration.github.pat) {
      return res.status(502).json({
        error:   'GitHub PAT not configured',
        message: 'Set GITHUB_TOKEN environment variable or configure via the setup wizard.',
      });
    }

    const githubPath = buildDownstreamPath(req.path, '/github-proxy');
    proxyRequest(req, res, configuration.github, githubPath, null, configuration.sslVerify);
  });

  return router;
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Strips a route prefix from the request path to get the downstream API path.
 * Falls back to '/' when nothing remains after stripping (e.g. /jira-proxy with no trailing path).
 *
 * @param {string} requestPath - The full request path (e.g. /jira-proxy/rest/api/2/myself)
 * @param {string} prefix      - The prefix to strip (e.g. /jira-proxy)
 * @returns {string} The downstream path (e.g. /rest/api/2/myself)
 */
function buildDownstreamPath(requestPath, prefix) {
  const downstreamPath = requestPath.substring(prefix.length);
  return downstreamPath || '/';
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createProxyRouter;
