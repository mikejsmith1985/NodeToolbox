// src/routes/proxy.js — Express router for all service proxy endpoints.
//
// Forwards browser requests to Jira, ServiceNow, and GitHub with server-side
// credential injection. The browser never sees API tokens or passwords —
// they are read from toolbox-proxy.json and injected here on the server.

'use strict';

const express    = require('express');
const { proxyRequest } = require('../utils/httpClient');
const snowSession      = require('../services/snowSession');
const { hasAnyGitHubAuth, resolveEffectiveGitHubToken } = require('../services/githubAppAuth');
const { recordJiraWrite } = require('../services/jiraWriteJournal');
const relayBridge      = require('./relayBridge');

/** How long one relayed Jira call may take before the browser is told the Jira tab did not answer. */
const JIRA_RELAY_TIMEOUT_MS = 60000;
/** Methods that never carry a body, so nothing is forwarded for them. */
const BODYLESS_METHODS = ['GET', 'HEAD', 'DELETE'];

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
    // Use req.url (not req.path) so query strings are preserved and forwarded downstream.
    const jiraPath = buildDownstreamPath(req.url, '/jira-proxy');

    // Every write the browser makes to Jira passes through here, which makes this the one place
    // that can answer "did this application change that issue?" after the fact. Reads are ignored
    // by the journal itself. Recorded before forwarding so an attempt is never lost to a crash.
    recordJiraWrite({ method: req.method, path: jiraPath, source: 'ui' });

    // A signed-in Jira tab running the relay bookmark wins over any stored token. After a Jira
    // re-instance migration the stored token belongs to the old instance and is refused (401); the
    // person's own browser session is always current, and needs nothing created or pasted.
    if (shouldUseJiraRelay(req)) {
      forwardJiraThroughRelay(req, res, jiraPath);
      return;
    }

    proxyRequest(req, res, configuration.jira, jiraPath, null, configuration.sslVerify);
  });

  // ── ServiceNow Proxy ────────────────────────────────────────────────────────
  // Strips the /snow-proxy prefix. Uses g_ck session token if a browser session
  // has been handed off; falls back to Basic Auth credentials if configured.

  router.all('/snow-proxy/*', (req, res) => {
    // Use req.url (not req.path) so query strings are preserved and forwarded downstream.
    const snowPath = buildDownstreamPath(req.url, '/snow-proxy');

    // Resolve the effective base URL — session base URL takes priority over config
    const effectiveBaseUrl = snowSession.resolveSnowBaseUrl(configuration.snow.baseUrl);
    const sessionHeaders   = snowSession.buildSessionHeaders();

    const snowServiceConfig = Object.assign({}, configuration.snow, { baseUrl: effectiveBaseUrl });
    proxyRequest(req, res, snowServiceConfig, snowPath, sessionHeaders, configuration.sslVerify);
  });

  // ── GitHub Proxy ────────────────────────────────────────────────────────────
  // Strips the /github-proxy prefix and injects a server-side GitHub token.
  // Supports both PAT and GitHub App installation tokens.
  // The browser never stores or transmits the token directly.

  router.all('/github-proxy/*', async (req, res) => {
    // Reject immediately when no GitHub auth method is configured at all
    if (!hasAnyGitHubAuth(configuration)) {
      return res.status(502).json({
        error:   'GitHub not configured',
        message: 'Set GITHUB_TOKEN environment variable or configure GitHub App credentials via the setup wizard.',
      });
    }

    let resolvedToken;
    try {
      // Resolve the effective token — GitHub App installation token takes priority over PAT.
      // This call is fast when the cache is warm (no network round-trip needed).
      const authResult = await resolveEffectiveGitHubToken(configuration);
      resolvedToken = authResult.token;
    } catch (tokenError) {
      console.error('  [GitHub Proxy] Token resolution failed: ' + tokenError.message);
      return res.status(502).json({
        error:   'GitHub authentication failed',
        message: tokenError.message,
      });
    }

    // Build an effective config with the resolved token so proxyRequest injects it.
    // We override only the pat field — all other settings (baseUrl, etc.) come from config.
    const effectiveGithubConfig = Object.assign({}, configuration.github, { pat: resolvedToken });

    // Use req.url (not req.path) so query strings are preserved and forwarded downstream.
    const githubPath = buildDownstreamPath(req.url, '/github-proxy');
    proxyRequest(req, res, effectiveGithubConfig, githubPath, null, configuration.sslVerify);
  });

  // ── Confluence Proxy ─────────────────────────────────────────────────────────
  // Strips the /confluence-proxy prefix and forwards to the Confluence Cloud tenant.
  // Confluence Cloud is at https://zilverton.atlassian.net — auth is Basic Auth using
  // an Atlassian email address and a Cloud API token (not the same as a Jira self-hosted PAT).
  // Example downstream path: /wiki/rest/api/space or /wiki/api/v2/pages

  router.all('/confluence-proxy/*', (req, res) => {
    if (!configuration.confluence.baseUrl) {
      return res.status(502).json({
        error:   'Confluence not configured',
        message: 'Set TBX_CONFLUENCE_URL and credentials in toolbox-proxy.json or environment variables.',
      });
    }

    // Use req.url (not req.path) so query strings are preserved and forwarded downstream.
    const confluencePath = buildDownstreamPath(req.url, '/confluence-proxy');
    proxyRequest(req, res, configuration.confluence, confluencePath, null, configuration.sslVerify);
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
// ── Jira relay ────────────────────────────────────────────────────────────────

/**
 * True when a Jira tab is relaying and this request can ride it. The relay carries JSON only, so a
 * non-JSON write (a file attachment upload) still goes direct.
 */
function shouldUseJiraRelay(req) {
  if (!relayBridge.getBridgeStatus('jira')) return false;
  if (BODYLESS_METHODS.includes(req.method)) return true;
  const hasNoBodyType = !req.headers['content-type'];
  return hasNoBodyType || Boolean(req.is('application/json'));
}

/**
 * Sends one Jira call through the relaying Jira tab and answers the browser with Jira's own status and
 * body, so every caller sees exactly what a direct call would have returned.
 */
async function forwardJiraThroughRelay(req, res, jiraPath) {
  const relayRequest = {
    method: req.method,
    url:    jiraPath,
    body:   BODYLESS_METHODS.includes(req.method) ? null : (req.body === undefined ? null : req.body),
  };
  try {
    const relayResult = await relayBridge.forwardRelayRequest('jira', relayRequest, JIRA_RELAY_TIMEOUT_MS);
    if (!relayResult.status) {
      res.status(502).json({ error: 'Proxy error', message: 'Jira relay: the Jira tab could not reach Jira — ' + (relayResult.error || 'no response') });
      return;
    }
    sendRelayedBody(res, relayResult.status, relayResult.data);
  } catch (relayError) {
    res.status(504).json({ error: 'Proxy error', message: 'Jira relay: ' + relayError.message });
  }
}

/** Writes a relayed body back with the content type a direct Jira call would have carried. */
function sendRelayedBody(res, status, relayedData) {
  res.status(status);
  if (relayedData === null || relayedData === undefined || relayedData === '') {
    res.end();
    return;
  }
  const bodyText = typeof relayedData === 'string' ? relayedData : JSON.stringify(relayedData);
  const trimmedBody = bodyText.trim();
  const isJsonBody = trimmedBody.startsWith('{') || trimmedBody.startsWith('[');
  res.setHeader('Content-Type', isJsonBody ? 'application/json;charset=UTF-8' : 'text/plain;charset=UTF-8');
  res.send(bodyText);
}

function buildDownstreamPath(requestPath, prefix) {
  const downstreamPath = requestPath.substring(prefix.length);
  return downstreamPath || '/';
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createProxyRouter;
