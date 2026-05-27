// src/routes/api.js — Express router for internal API endpoints.
//
// Provides health check, configuration read/write, ServiceNow session management,
// and a diagnostic endpoint for corporate-PC debugging. These are consumed by the
// Toolbox front-end dashboard and the connection wizard — not by the proxy pass-through.

'use strict';

const https      = require('https');
const path       = require('path');
const crypto     = require('crypto');
const express    = require('express');
const { saveConfigToDisk, isServiceConfigured, isServiceBaseUrlSet } = require('../config/loader');
const snowSession = require('../services/snowSession');
const { clearInstallationTokenCache, hasGitHubAppCredentials, getValidInstallationToken, listGitHubAppInstallations } = require('../services/githubAppAuth');
const { isDemoModeRequest } = require('../utils/demoMode');

const {
  prepareUpdate,
  spawnDetachedProcess,
  spawnReplacementAndExit,
} = require('../utils/updater');
const relayBridge = require('./relayBridge');
const logBuffer   = require('../utils/logBuffer');

/** Application version read once at startup — avoids repeated disk I/O per request */
const APP_VERSION = require('../../package.json').version;

/** Delay that lets a shutdown/restart response flush before the process exits. */
const SHUTDOWN_RESPONSE_DELAY_MS = 300;

/** Delay that gives the browser time to arm restart polling after /api/update succeeds. */
const UPDATE_RESPONSE_DELAY_MS = 3000;

/** Hidden launch flag used to identify updater-driven restart handoffs. */
const RESTART_HANDOFF_ARGUMENT = '--restart-handoff';

/** Public GitHub API endpoint for the latest NodeToolbox release metadata. */
const VERSION_CHECK_API_URL = 'https://api.github.com/repos/mikejsmith1985/NodeToolbox/releases/latest';

/** Public GitHub release redirect used as a lightweight fallback when the API is slow. */
const VERSION_CHECK_REDIRECT_URL = 'https://github.com/mikejsmith1985/NodeToolbox/releases/latest';

/** Timeout budget for each outbound GitHub version-check request. */
const VERSION_CHECK_TIMEOUT_MS = 6000;

/** Fallback note shown when the release version comes from the redirect instead of the API. */
const VERSION_CHECK_REDIRECT_RELEASE_NOTES = 'Version detected from the public GitHub release page because the GitHub API request did not complete. Release notes are unavailable right now.';

// ── GitHub Connectivity Probe Cache ──────────────────────────────────────────
//
// Stores the last live probe result so proxy-status can report real connectivity
// rather than just credential presence. The cache is updated after each test and
// cleared when credentials change so the icon reflects truth, not assumptions.

/** @type {{ isConnected: boolean, checkedAt: Date|null }} */
let githubProbeCache = {
  isConnected: false,
  checkedAt: null,
};

/**
 * Runs a live connectivity probe against the GitHub API (/user endpoint) using
 * whichever auth method is configured — App credentials take priority over PAT.
 * Updates githubProbeCache and returns the probe result.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {Promise<{ ok: boolean, statusCode: number, authMethod: string, message: string }>}
 */
async function runGitHubConnectivityProbe(configuration) {
  const githubConfig    = configuration.github || {};
  const isAppConfigured = hasGitHubAppCredentials(configuration);
  const isPatConfigured = !!(githubConfig.pat);

  if (!isAppConfigured && !isPatConfigured) {
    const noCredentialsResult = { ok: false, statusCode: 0, authMethod: 'none', message: 'No GitHub credentials configured.' };
    githubProbeCache = { isConnected: false, checkedAt: new Date() };
    return noCredentialsResult;
  }

  try {
    const githubBaseUrl = (githubConfig.baseUrl || 'https://api.github.com').replace(/\/$/, '');
    let authHeader;
    let authMethod;

    if (isAppConfigured) {
      // Prefer App auth — bypasses SAML SSO enforcement on enterprise orgs
      const installationToken = await getValidInstallationToken(configuration);
      authHeader = 'token ' + installationToken;
      authMethod = 'GitHub App';
    } else {
      authHeader = 'token ' + githubConfig.pat;
      authMethod = 'PAT';
    }

    const probeResponse = await fetch(githubBaseUrl + '/user', {
      method:  'GET',
      headers: {
        'Authorization': authHeader,
        'User-Agent':    'NodeToolbox',
        'Accept':        'application/vnd.github.v3+json',
      },
    });

    const probeResult = {
      ok:         probeResponse.ok,
      statusCode: probeResponse.status,
      authMethod,
      message: probeResponse.ok
        ? 'Connected successfully via ' + authMethod + '.'
        : 'Received HTTP ' + probeResponse.status + ' (auth method: ' + authMethod + ')',
    };

    // Persist result so proxy-status can reflect actual connectivity
    githubProbeCache = { isConnected: probeResponse.ok, checkedAt: new Date() };
    return probeResult;
  } catch (probeError) {
    githubProbeCache = { isConnected: false, checkedAt: new Date() };
    return { ok: false, statusCode: 0, authMethod: 'unknown', message: 'Connection failed: ' + probeError.message };
  }
}

// ── Router Factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router with all internal API endpoints.
 * The configuration object is passed by reference so live updates (e.g. from
 * POST /api/proxy-config) are immediately reflected in the proxy behaviour.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @param {{
 *   requestShutdown?: (options?: { delayMs?: number }) => void,
 *   requestRestart?: (options?: { delayMs?: number, execPath?: string, execArgs?: string[] }) => void,
 *   requestReplacement?: (options: { delayMs?: number, execPath: string, execArgs: string[], targetVersion?: string }) => void
 * }} [lifecycleHandlers]
 * @returns {import('express').Router}
 */
function createApiRouter(configuration, lifecycleHandlers = {}) {
  const router = express.Router();
  const requestShutdown = lifecycleHandlers.requestShutdown || defaultRequestShutdown;
  const requestRestart = lifecycleHandlers.requestRestart || defaultRequestRestart;
  const requestReplacement = lifecycleHandlers.requestReplacement || defaultRequestReplacement;

  // ── GET /api/proxy-status ────────────────────────────────────────────────
  // Health check endpoint used by the Toolbox front-end for auto-detection.
  // Returns which services are configured and ready — never exposes credentials.

  router.get('/api/proxy-status', (req, res) => {
    if (isDemoModeRequest(req)) {
      return res.json(buildDemoProxyStatusResponse(configuration));
    }

    const isJiraHasBasicAuth = !!(configuration.jira.username && configuration.jira.apiToken);
    const isJiraHasPat       = !!configuration.jira.pat;
    const isJiraReady        = isServiceBaseUrlSet(configuration.jira) && (isJiraHasBasicAuth || isJiraHasPat);

    const isSnowHasBasicAuth    = !!(configuration.snow.username && configuration.snow.password);
    const isSnowSessionCurrent  = snowSession.isSessionActive();
    const isSnowReady           = (isServiceBaseUrlSet(configuration.snow) && isSnowHasBasicAuth) || isSnowSessionCurrent;

    const snowBaseUrl = (isServiceBaseUrlSet(configuration.snow) ? configuration.snow.baseUrl : null)
      || snowSession.resolveSnowBaseUrl('') || null;

    const isGithubReady = githubProbeCache.isConnected;

    const confluenceConfig        = configuration.confluence || {};
    const isConfluenceHasCredentials = !!(confluenceConfig.username && confluenceConfig.apiToken);
    const isConfluenceConfigured  = !!(confluenceConfig.baseUrl);
    const isConfluenceReady       = isConfluenceConfigured && isConfluenceHasCredentials;

    res.json({
      proxy:     true,
      version:   APP_VERSION,
      sslVerify: configuration.sslVerify !== false,
      jira: {
        configured:     isServiceBaseUrlSet(configuration.jira),
        hasCredentials: isJiraHasBasicAuth || isJiraHasPat,
        ready:          isJiraReady,
        baseUrl:        isServiceBaseUrlSet(configuration.jira) ? configuration.jira.baseUrl : null,
      },
      snow: {
        configured:       isServiceBaseUrlSet(configuration.snow) || !!snowBaseUrl,
        hasCredentials:   isSnowHasBasicAuth,
        sessionMode:      isSnowSessionCurrent,
        sessionExpiresAt: isSnowSessionCurrent ? snowSession.getSessionStatus().expiresAt : null,
        ready:            isSnowReady,
        baseUrl:          snowBaseUrl,
      },
      github: {
        configured:     !!(configuration.github.pat) || hasGitHubAppCredentials(configuration),
        hasCredentials: !!(configuration.github.pat) || hasGitHubAppCredentials(configuration),
        ready:          isGithubReady,
        probeCheckedAt: githubProbeCache.checkedAt ? githubProbeCache.checkedAt.toISOString() : null,
      },
      confluence: {
        configured:     isConfluenceConfigured,
        hasCredentials: isConfluenceHasCredentials,
        ready:          isConfluenceReady,
        baseUrl:        isConfluenceConfigured ? confluenceConfig.baseUrl : null,
      },
    });
  });

  // ── GET /api/proxy-config ────────────────────────────────────────────────
  // Returns non-sensitive configuration for the Admin Hub UI.
  // Base URLs are returned; credentials are summarised as boolean flags.

  // ── GET /api/diagnostics ──────────────────────────────────────────────────
  // Returns live server diagnostics for the Admin Hub Diagnostics panel.
  // Includes runtime metadata, sanitised Snow/GitHub config state, relay status,
  // and session info — no raw credentials are ever included.

  router.get('/api/diagnostics', (req, res) => {
    const snowConfig     = configuration.snow   || {};
    const githubConfig   = configuration.github || {};
    const sessionStatus  = snowSession.getSessionStatus();
    const snowBridgeDiag = relayBridge.getBridgeDiag('snow');
    const jiraBridgeDiag = relayBridge.getBridgeDiag('jira');

    res.json({
      version:     APP_VERSION,
      nodeVersion: process.version,
      uptime:      Math.round(process.uptime()),
      timestamp:   new Date().toISOString(),
      // isPkgExe distinguishes the compiled .exe from `node server.js` —
      // useful for diagnosing path resolution issues on corporate machines.
      isPkgExe:    !!process.pkg,
      platform:    process.platform,
      snow: {
        baseUrl:          snowConfig.baseUrl || null,
        hasCredentials:   !!(snowConfig.username && snowConfig.password),
        usernameMasked:   maskCredentialUsername(snowConfig.username || ''),
        sessionActive:    !!sessionStatus.isActive,
        sessionExpiresAt: sessionStatus.isActive ? (sessionStatus.expiresAt || null) : null,
      },
      relay: {
        snowActive:           snowBridgeDiag.active,
        jiraActive:           jiraBridgeDiag.active,
        snowLastRegisteredAt: snowBridgeDiag.lastRegisteredAt,
        snowLastPolledAt:     snowBridgeDiag.lastPolledAt,
      },
      github: {
        baseUrl: githubConfig.baseUrl || null,
        hasPat:  !!(githubConfig.pat),
      },
    });
  });

  // ── GET /api/config/connectivity ──────────────────────────────────────────
  // Returns sanitised Snow and GitHub configuration for the Admin Hub
  // connectivity form. Never returns raw credentials — only presence flags
  // and a masked username so the user can confirm which account is active.

  router.get('/api/config/connectivity', (req, res) => {
    if (isDemoModeRequest(req)) {
      return res.json(buildDemoConnectivityConfigResponse());
    }

    const snowConfig      = configuration.snow      || {};
    const githubConfig    = configuration.github    || {};
    const confluenceConfig = configuration.confluence || {};

    res.json({
      snow: {
        baseUrl:        snowConfig.baseUrl || '',
        hasCredentials: !!(snowConfig.username && snowConfig.password),
        usernameMasked: maskCredentialUsername(snowConfig.username || ''),
      },
      github: {
        baseUrl:          githubConfig.baseUrl || '',
        hasPat:           !!(githubConfig.pat),
        hasAppAuth:       hasGitHubAppCredentials(configuration),
        hasAppId:         !!(githubConfig.appId),
        hasAppPrivateKey: !!(githubConfig.appPrivateKey),
        hasInstallationId: !!(githubConfig.installationId),
        hasAppLookupReady: !!(githubConfig.appId && githubConfig.appPrivateKey),
      },
      confluence: {
        baseUrl:        confluenceConfig.baseUrl || '',
        hasCredentials: !!(confluenceConfig.username && confluenceConfig.apiToken),
        usernameMasked: maskCredentialUsername(confluenceConfig.username || ''),
      },
    });
  });

  // ── POST /api/config/connectivity ─────────────────────────────────────────
  // Saves Snow, GitHub, and Confluence config fields to toolbox-proxy.json.
  // Credential fields (password, pat, apiToken) are only overwritten when the
  // submitted value is non-empty — masked placeholders won't erase saved credentials.

  router.post('/api/config/connectivity', (req, res) => {
    if (isDemoModeRequest(req)) {
      return res.json(buildDemoConnectivityConfigResponse());
    }

    const body             = req.body || {};
    const snowUpdate       = body.snow       || {};
    const ghUpdate         = body.github     || {};
    const confluenceUpdate = body.confluence || {};

    // Apply Snow fields — always accept baseUrl, but skip credential fields
    // when the submitted value is blank (the form shows masked placeholders).
    if (snowUpdate.baseUrl !== undefined) {
      configuration.snow.baseUrl = (snowUpdate.baseUrl || '').trim();
    }
    if (snowUpdate.username && snowUpdate.username.trim()) {
      configuration.snow.username = snowUpdate.username.trim();
    }
    if (snowUpdate.password && snowUpdate.password.trim()) {
      configuration.snow.password = snowUpdate.password.trim();
    }

    // Apply GitHub fields.
    if (ghUpdate.baseUrl !== undefined) {
      configuration.github.baseUrl = (ghUpdate.baseUrl || '').trim();
    }
    if (ghUpdate.pat && ghUpdate.pat.trim()) {
      configuration.github.pat = ghUpdate.pat.trim();
    }
    // Apply GitHub App credentials — clear token cache so the new key takes effect immediately.
    let isAppCredentialChanged = false;
    if (ghUpdate.appId !== undefined) {
      configuration.github.appId = (ghUpdate.appId || '').trim();
      isAppCredentialChanged = true;
    }
    if (ghUpdate.installationId !== undefined) {
      configuration.github.installationId = (ghUpdate.installationId || '').trim();
      isAppCredentialChanged = true;
    }
    if (ghUpdate.appPrivateKey && ghUpdate.appPrivateKey.trim()) {
      configuration.github.appPrivateKey = ghUpdate.appPrivateKey.trim();
      isAppCredentialChanged = true;
    }
    if (isAppCredentialChanged) {
      clearInstallationTokenCache();
    }
    // Any GitHub credential change invalidates the last probe result — icon turns
    // amber/gray until the user runs Test Connection with the new credentials.
    const isGitHubCredentialChanged = isAppCredentialChanged || !!(ghUpdate.pat && ghUpdate.pat.trim());
    if (isGitHubCredentialChanged) {
      githubProbeCache = { isConnected: false, checkedAt: null };
    }

    // Apply Confluence fields — same pattern as Snow/GitHub.
    configuration.confluence = configuration.confluence || {};
    if (confluenceUpdate.baseUrl !== undefined) {
      configuration.confluence.baseUrl = (confluenceUpdate.baseUrl || '').trim();
    }
    if (confluenceUpdate.username && confluenceUpdate.username.trim()) {
      configuration.confluence.username = confluenceUpdate.username.trim();
    }
    if (confluenceUpdate.apiToken && confluenceUpdate.apiToken.trim()) {
      configuration.confluence.apiToken = confluenceUpdate.apiToken.trim();
    }

    saveConfigToDisk(configuration);

    const savedConfluenceConfig = configuration.confluence || {};
    res.json({
      ok: true,
      snow: {
        baseUrl:        configuration.snow.baseUrl || '',
        hasCredentials: !!(configuration.snow.username && configuration.snow.password),
        usernameMasked: maskCredentialUsername(configuration.snow.username || ''),
      },
      github: {
        baseUrl:           configuration.github.baseUrl || '',
        hasPat:            !!(configuration.github.pat),
        hasAppAuth:        hasGitHubAppCredentials(configuration),
        hasAppId:          !!(configuration.github.appId),
        hasAppPrivateKey:  !!(configuration.github.appPrivateKey),
        hasInstallationId: !!(configuration.github.installationId),
        hasAppLookupReady: !!(configuration.github.appId && configuration.github.appPrivateKey),
      },
      confluence: {
        baseUrl:        savedConfluenceConfig.baseUrl || '',
        hasCredentials: !!(savedConfluenceConfig.username && savedConfluenceConfig.apiToken),
        usernameMasked: maskCredentialUsername(savedConfluenceConfig.username || ''),
      },
    });
  });

  // ── GET /api/config/github-app/installations ─────────────────────────────
  // Diagnostic endpoint: lists all orgs/accounts where this GitHub App is installed.
  // Requires only appId + appPrivateKey (already saved) — no installationId needed.
  // Returns the installationId for each installation so users can copy the correct value.
  // A 404 on the token endpoint almost always means the wrong installationId was entered.

  router.get('/api/config/github-app/installations', async (req, res) => {
    const githubConfig = configuration.github || {};
    if (!githubConfig.appId || !githubConfig.appPrivateKey) {
      return res.status(400).json({
        ok: false,
        message: 'App ID (or Client ID) and Private Key must be saved before listing installations.',
      });
    }
    try {
      const installations = await listGitHubAppInstallations(configuration);
      res.json({ ok: true, installations });
    } catch (listError) {
      res.json({ ok: false, installations: [], message: listError.message });
    }
  });

  // ── POST /api/config/connectivity/test ────────────────────────────────────
  // Probes the configured Snow or GitHub endpoint and returns live reachability
  // status. Used by the Admin Hub "Test" buttons so the user can verify their
  // settings before saving. Expects { system: 'snow' | 'github' } in the body.

  router.post('/api/config/connectivity/test', async (req, res) => {
    if (isDemoModeRequest(req)) {
      return res.json({
        ok: false,
        statusCode: 0,
        message: 'Demo mode starts with blank connections and does not use saved server credentials.',
      });
    }

    const body   = req.body || {};
    // Normalise to lowercase so 'Snow', 'SNOW', 'snow' all work.
    const system = (body.system || '').toLowerCase();

    if (system === 'snow') {
      const snowConfig = configuration.snow || {};
      if (!snowConfig.baseUrl) {
        return res.json({ ok: false, statusCode: 0, message: 'No ServiceNow base URL configured.' });
      }
      try {
        const testUrl = snowConfig.baseUrl.replace(/\/$/, '') + '/api/now/table/sys_user?sysparm_limit=1';
        const proxyResponse = await fetch(testUrl, {
          method: 'GET',
          headers: {
            // Basic Auth header — credentials are never logged or forwarded outside this request.
            'Authorization': 'Basic ' + Buffer.from(
              (snowConfig.username || '') + ':' + (snowConfig.password || '')
            ).toString('base64'),
            'Content-Type': 'application/json',
            'Accept':       'application/json',
          },
        });
        res.json({
          ok:         proxyResponse.ok,
          statusCode: proxyResponse.status,
          message:    proxyResponse.ok ? 'Connected successfully.' : 'Received HTTP ' + proxyResponse.status,
        });
      } catch (testError) {
        res.json({ ok: false, statusCode: 0, message: 'Connection failed: ' + testError.message });
      }

    } else if (system === 'github') {
      try {
        const probeResult = await runGitHubConnectivityProbe(configuration);
        res.json({
          ok:         probeResult.ok,
          statusCode: probeResult.statusCode,
          authMethod: probeResult.authMethod,
          message:    probeResult.message,
        });
      } catch (testError) {
        res.json({ ok: false, statusCode: 0, message: 'Connection failed: ' + testError.message });
      }

    } else if (system === 'confluence') {
      const confluenceConfig = configuration.confluence || {};
      if (!confluenceConfig.baseUrl) {
        return res.json({ ok: false, statusCode: 0, message: 'No Confluence base URL configured.' });
      }
      try {
        // Probe the current-user endpoint — cheap and reliably returns 200 or 401.
        const testUrl = confluenceConfig.baseUrl.replace(/\/$/, '') + '/wiki/rest/api/user/current';
        const probeResponse = await fetch(testUrl, {
          method: 'GET',
          headers: {
            // Confluence Cloud uses Basic Auth with Atlassian email + Cloud API token.
            'Authorization': 'Basic ' + Buffer.from(
              (confluenceConfig.username || '') + ':' + (confluenceConfig.apiToken || '')
            ).toString('base64'),
            'Accept': 'application/json',
          },
        });
        let confluenceMessage;
        if (probeResponse.ok) {
          confluenceMessage = 'Connected successfully.';
        } else if (probeResponse.status === 401) {
          confluenceMessage = 'Authentication failed (HTTP 401) — check your Atlassian email address and Cloud API token.';
        } else if (probeResponse.status === 403) {
          confluenceMessage = 'Access denied (HTTP 403) — verify your Atlassian email and Cloud API token. ' +
            'Confluence Cloud requires an Atlassian Cloud API token from id.atlassian.com, not a Jira on-prem PAT.';
        } else if (probeResponse.status === 404) {
          confluenceMessage = 'Not found (HTTP 404) — check your Confluence base URL. It should end with your site name, e.g. https://yoursite.atlassian.net/';
        } else {
          confluenceMessage = `Request failed with HTTP ${probeResponse.status}.`;
        }
        res.json({ ok: probeResponse.ok, statusCode: probeResponse.status, message: confluenceMessage });
      } catch (testError) {
        res.json({ ok: false, statusCode: 0, message: 'Connection failed: ' + testError.message });
      }

    } else {
      res.status(400).json({ ok: false, message: 'system must be "snow", "github", or "confluence"' });
    }
  });

  // ── GET /api/version-check ────────────────────────────────────────────────
  // Compares the running version against the latest GitHub release.
  // Prefers the GitHub API for release notes, but also probes the public release
  // redirect in parallel so API-specific slowdowns do not look like a full outage.

  router.get('/api/version-check', async (_req, res) => {
    const versionCheckResult = await resolveVersionCheckResult();
    res.json(versionCheckResult);
  });

  // ── GET /api/logs ─────────────────────────────────────────────────────────
  // Returns all buffered server-side log entries for the Dev Panel Server Logs tab.
  // Entries are captured by the logBuffer console interceptor installed at startup.

  router.get('/api/logs', (req, res) => {
    res.json({ entries: logBuffer.getAllEntries() });
  });

  // ── POST /api/logs/clear ───────────────────────────────────────────────────
  // Clears all buffered server log entries — triggered by the Dev Panel clear button.

  router.post('/api/logs/clear', (req, res) => {
    logBuffer.clearEntries();
    res.json({ ok: true });
  });

  // ── GET /api/download/launcher-vbs ────────────────────────────────────────
  // Serves the silent VBScript launcher so users can re-download it from the
  // Admin Hub without extracting a new release zip.
  //
  // The file lives alongside server.js in the distribution root. When running
  // as a pkg bundle (process.pkg truthy), that root is path.dirname(process.execPath)
  // rather than the virtual snapshot __dirname.

  router.get('/api/download/launcher-vbs', (req, res) => {
    const distributionRoot = process.pkg
      ? path.dirname(process.execPath)
      : path.join(__dirname, '..', '..');
    const vbsFilePath = path.join(distributionRoot, 'Launch Toolbox Silent.vbs');

    res.download(vbsFilePath, 'Launch Toolbox Silent.vbs', (downloadError) => {
      if (downloadError && !res.headersSent) {
        res.status(404).json({
          error: 'Launcher file not found. Make sure you are running from the full release folder.',
        });
      }
    });
  });

  // ── GET /api/download/launcher-bat ────────────────────────────────────────
  // Serves the batch launcher for users who prefer a visible console window.
  // Only present in the zip distribution — not included in the exe zip.

  router.get('/api/download/launcher-bat', (req, res) => {
    const distributionRoot = process.pkg
      ? path.dirname(process.execPath)
      : path.join(__dirname, '..', '..');
    const batFilePath = path.join(distributionRoot, 'Launch Toolbox.bat');

    res.download(batFilePath, 'Launch Toolbox.bat', (downloadError) => {
      if (downloadError && !res.headersSent) {
        res.status(404).json({
          error: 'Launcher file not found. Make sure you are running from the full release folder.',
        });
      }
    });
  });

  router.get('/api/proxy-config', (req, res) => {
    if (isDemoModeRequest(req)) {
      return res.json(buildDemoProxyConfigResponse(configuration));
    }

    const confluenceConfig = configuration.confluence || {};
    res.json({
      port: configuration.port,
      jira: {
        baseUrl:        configuration.jira.baseUrl || '',
        hasCredentials: !!(configuration.jira.username && configuration.jira.apiToken) || !!configuration.jira.pat,
      },
      snow: {
        baseUrl:        configuration.snow.baseUrl || '',
        hasCredentials: !!(configuration.snow.username && configuration.snow.password),
      },
      github: {
        hasCredentials: !!configuration.github.pat,
      },
      confluence: {
        baseUrl:        confluenceConfig.baseUrl || '',
        hasCredentials: !!(confluenceConfig.username && confluenceConfig.apiToken),
      },
    });
  });

  // ── POST /api/proxy-config ────────────────────────────────────────────────
  // Accepts updated credentials from the Toolbox Admin Hub and saves to disk.
  // Merges — does not overwrite. Missing fields in the request are left unchanged.

  router.post('/api/proxy-config', (req, res) => {
    if (isDemoModeRequest(req)) {
      return res.json({ success: true, demoMode: true });
    }

    const incomingConfig = req.body;

    if (!incomingConfig || typeof incomingConfig !== 'object') {
      return res.status(400).json({ error: 'Invalid body', message: 'Request body must be a JSON object.' });
    }

    mergeJiraConfig(configuration, incomingConfig.jira);
    mergeSnowConfig(configuration, incomingConfig.snow);
    mergeGithubConfig(configuration, incomingConfig.github);
    mergeConfluenceConfig(configuration, incomingConfig.confluence);

    if (incomingConfig.sslVerify !== undefined) {
      configuration.sslVerify = !!incomingConfig.sslVerify;
    }

    // Strip trailing slashes after merge to normalise any user-provided values
    if (configuration.jira.baseUrl)       configuration.jira.baseUrl       = configuration.jira.baseUrl.replace(/\/+$/, '');
    if (configuration.snow.baseUrl)       configuration.snow.baseUrl       = configuration.snow.baseUrl.replace(/\/+$/, '');
    if (configuration.confluence.baseUrl) configuration.confluence.baseUrl = configuration.confluence.baseUrl.replace(/\/+$/, '');

    saveConfigToDisk(configuration);

    console.log('  ✅ Config updated via Admin Hub');
    res.json({ success: true });
  });

  // ── POST /api/admin-verify ────────────────────────────────────────────────
  // Verifies Admin Hub credentials server-side so the check works regardless
  // of whether the browser is in a secure context (HTTPS / localhost) —
  // window.crypto.subtle is unavailable over plain HTTP on non-localhost origins.
  //
  // Body: { username: string, password: string }
  // Returns 200 { success: true } on match, 401 on mismatch, 400 on bad input.
  // Does NOT set any session — the client stores the unlock flag in sessionStorage.

  router.post('/api/admin-verify', (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Bad request', message: 'username and password are required.' });
    }

    // Compute SHA-256 of "username:password" — same algorithm as the old client-side check
    // so existing credential hashes stored in toolbox-proxy.json remain valid.
    const inputHash = crypto
      .createHash('sha256')
      .update(username + ':' + password)
      .digest('hex');

    const storedHash = (configuration.admin && configuration.admin.credentialHash) || '';

    if (storedHash) {
      // Stored credentials configured — validate against the SHA-256 hash.
      if (inputHash !== storedHash) {
        console.warn('  ⚠ Admin Hub: failed unlock attempt for user "' + username + '"');
        return res.status(401).json({ error: 'Unauthorized', message: 'Incorrect credentials.' });
      }
    } else {
      // No admin credentials configured yet — accept the default credentials so
      // first-time users can unlock without setting up toolbox-proxy.json first.
      const defaultHash = crypto.createHash('sha256').update('admin:toolbox').digest('hex');
      if (inputHash !== defaultHash) {
        console.warn('  ⚠ Admin Hub: failed unlock attempt (no credentials configured)');
        return res.status(401).json({ error: 'Unauthorized', message: 'Incorrect credentials.' });
      }
    }

    console.log('  🔓 Admin Hub unlocked by user "' + username + '"');
    res.json({ success: true });
  });

  // ── /api/snow-session ─────────────────────────────────────────────────────
  // Manages the SNow in-memory session token forwarded from the browser relay
  // after Okta authentication.

  router.get('/api/snow-session', (req, res) => {
    res.json(snowSession.getSessionStatus());
  });

  router.post('/api/snow-session', (req, res) => {
    const { gck, baseUrl, expiresIn } = req.body || {};

    const cleanGck = (gck || '').trim();
    if (!cleanGck) {
      return res.status(400).json({ error: 'Missing gck', message: 'gck session token is required.' });
    }

    const sessionLifetime  = parseInt(expiresIn, 10) || snowSession.DEFAULT_SESSION_LIFETIME_SECONDS;
    const resolvedBaseUrl  = (baseUrl || '').trim() || configuration.snow.baseUrl || '';

    snowSession.storeSession(cleanGck, resolvedBaseUrl, sessionLifetime);

    res.json({ ok: true, expiresAt: snowSession.getSessionStatus().expiresAt, expiresIn: sessionLifetime });
  });

  router.delete('/api/snow-session', (req, res) => {
    snowSession.clearSession();
    res.json({ ok: true });
  });

  // ── GET /api/diagnostic ──────────────────────────────────────────────────
  // Runtime health snapshot for corporate-PC debugging — returns how the HTML
  // was loaded, whether we are inside a pkg snapshot, and Node.js runtime info.
  // Safe to expose: no credentials, no config values.

  router.get('/api/diagnostic', (req, res) => {
    res.json({
      // True when running inside a pkg-compiled .exe (vs node server.js)
      pkgSnapshot:       !!process.pkg,
      // Node.js runtime version — helps diagnose compatibility issues
      nodeVersion:       process.version,
      // Operating system platform — 'win32', 'darwin', 'linux'
      platform:          process.platform,
    });
  });

  // ── POST /api/shutdown ──────────────────────────────────────────────────
  // Gracefully stops the server process. Accessible from localhost only —
  // the server never binds to a public interface so no extra auth is needed.
  // Responds before the process exits so the browser can display a message.

  router.post('/api/shutdown', (_req, res) => {
    res.json({ ok: true, message: 'Server is shutting down.' });
    requestShutdown({ delayMs: SHUTDOWN_RESPONSE_DELAY_MS });
  });

  // ── POST /api/restart ────────────────────────────────────────────────────
  // Spawns a fresh detached copy of the server process, then exits this one.
  // Works for both plain `node server.js` and the pkg-compiled .exe launcher.
  // The new process starts after the port is released, using the same argv flags
  // (e.g. --open) that were originally passed to the current process.

  router.post('/api/restart', (_req, res) => {
    res.json({ ok: true, message: 'Server is restarting.' });
    requestRestart({
      delayMs: SHUTDOWN_RESPONSE_DELAY_MS,
      execPath: process.execPath,
      execArgs: buildRestartArguments(),
    });
  });

  // ── POST /api/update ────────────────────────────────────────────────────
  // Downloads a specific release version from GitHub, extracts it to a staging
  // directory, spawns the replacement process, and exits the current one.
  // Expects { version: "0.2.10" } in the request body.
  //
  // IMPORTANT: The response is sent AFTER the download and extraction complete,
  // not before. This prevents a race condition where the client's
  // pollUntilServerRestarts() polls too early, finds the old server still alive
  // (mid-download), and incorrectly declares the update successful. By the time
  // the client receives { ok: true, restarting: true }, the server has already
  // staged the new binary and is about to spawn + exit — so the first poll that
  // finds the server down means the handoff is genuinely in progress.

  router.post('/api/update', async (req, res) => {
    const requestedVersion = (req.body && req.body.version) ? String(req.body.version).trim() : '';

    if (!requestedVersion) {
      return res.status(400).json({ ok: false, error: 'version is required' });
    }

    // Guard against requesting the version already running — nothing to do.
    if (requestedVersion === APP_VERSION) {
      return res.json({ alreadyLatest: true });
    }

    try {
      console.log(`  ⬇ Update requested: v${APP_VERSION} → v${requestedVersion}`);
      const { newExecPath, newExecArgs } = await prepareUpdate(requestedVersion);
      console.log(`  ✅ Update staged — spawning v${requestedVersion} and exiting.`);

      // Respond now that the download is complete and the replacement is ready.
      // Writing and flushing the JSON body before the shutdown delay gives the
      // browser time to arm its restart detector before this process exits.
      res.status(200);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.write(JSON.stringify({ ok: true, restarting: true }));
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      res.end();
      requestReplacement({
        delayMs: UPDATE_RESPONSE_DELAY_MS,
        execPath: newExecPath,
        execArgs: newExecArgs,
        targetVersion: requestedVersion,
      });
    } catch (updateError) {
      // Surface the failure to the client so the UI can display a real error
      // message instead of silently reloading to the same version.
      console.error('  ❌ Update failed:', updateError.message);
      res.status(500).json({ ok: false, error: updateError.message });
    }
  });

  // ── GET /api/snow-diag ──────────────────────────────────────────────────
  // Returns all server-side ServiceNow diagnostic state in a single request.
  // Used by the Admin Hub "SNow Diagnostics" report button so the client can
  // include proxy credentials status and relay bridge state in the copy-paste report.
  //
  // Security: raw credentials are NEVER returned. Username is masked (e.g. svc_t****x).
  // Password is omitted entirely. The g_ck token is never exposed.

  router.get('/api/snow-diag', (req, res) => {
    const snowConfig      = configuration.snow || {};
    const sessionStatus   = snowSession.getSessionStatus();
    const snowBridgeDiag  = relayBridge.getBridgeDiag('snow');
    const jiraBridgeDiag  = relayBridge.getBridgeDiag('jira');

    res.json({
      snow: {
        baseUrl:          snowConfig.baseUrl || null,
        hasCredentials:   !!(snowConfig.username && snowConfig.password),
        usernameMasked:   maskCredentialUsername(snowConfig.username || ''),
        sessionActive:    !!sessionStatus.isActive,
        sessionExpiresAt: sessionStatus.isActive ? (sessionStatus.expiresAt || null) : null,
      },
      relay: {
        snowActive:              snowBridgeDiag.active,
        jiraActive:              jiraBridgeDiag.active,
        // Timestamps expose registration history so diagnostic reports can show
        // exactly when the bookmarklet last connected, disconnected, and polled.
        snowLastRegisteredAt:    snowBridgeDiag.lastRegisteredAt,
        snowLastDeregisteredAt:  snowBridgeDiag.lastDeregisteredAt,
        snowLastPolledAt:        snowBridgeDiag.lastPolledAt,
      },
    });
  });

  // ── GET /api/snow-relay/change/:changeKey ──────────────────────────────────
  // Fetches an existing ServiceNow CHG (Change Request) record by key.
  // Uses the relayBridge to communicate with ServiceNow via the browser session or proxy credentials.
  //
  // Params: changeKey (e.g., "CHG0046897")
  // Returns: 200 { shortDescription, description, justification, ... } on success
  // Returns: 404 if the change does not exist
  // Returns: 502 if the relay bridge is not active or ServiceNow is unreachable

  function inferModifyEnvironmentKeyFromValue(environmentValue) {
    const normalizedEnvironmentValue = String(environmentValue || '').trim().toLowerCase();
    if (!normalizedEnvironmentValue) return null;
    if (normalizedEnvironmentValue.includes('pfix') || normalizedEnvironmentValue.includes('fix')) return 'pfix';
    if (normalizedEnvironmentValue.includes('prd') || normalizedEnvironmentValue.includes('prod')) return 'prd';
    if (normalizedEnvironmentValue.includes('rel') || normalizedEnvironmentValue.includes('release')) return 'rel';
    return null;
  }

  function readModifySnowReferenceSysId(referenceValue) {
    if (!referenceValue) return '';
    if (typeof referenceValue === 'string') return referenceValue;
    if (typeof referenceValue === 'object') return referenceValue.sysId || referenceValue.value || '';
    return '';
  }

  function readModifyEnvironmentState(changeData, environmentKey) {
    const environmentState = changeData?.[`${environmentKey}Environment`];
    return environmentState && typeof environmentState === 'object' ? environmentState : null;
  }

  function readSelectedModifyEnvironmentState(changeData) {
    const selectedEnvironmentKey = inferModifyEnvironmentKeyFromValue(changeData?.chgBasicInfo?.environment);
    if (selectedEnvironmentKey) {
      return readModifyEnvironmentState(changeData, selectedEnvironmentKey);
    }

    const enabledEnvironmentKey = ['rel', 'prd', 'pfix'].find((environmentKey) => (
      readModifyEnvironmentState(changeData, environmentKey)?.isEnabled
    ));
    return enabledEnvironmentKey ? readModifyEnvironmentState(changeData, enabledEnvironmentKey) : null;
  }

  router.get('/api/snow-relay/change/:changeKey', async (req, res) => {
    const changeKey = (req.params.changeKey || '').trim().toUpperCase();

    if (!changeKey) {
      return res.status(400).json({ error: 'Missing changeKey', message: 'Change key is required in the URL path.' });
    }

    try {
      // Use the relay bridge to fetch the change from ServiceNow.
      // The bookmarklet will make a fetch() call to ServiceNow's /api/now/v2/table/change_request?sysparm_query=number={changeKey}
      const relayRequest = {
        method: 'GET',
        url: `/api/now/v2/table/change_request?sysparm_query=number=${encodeURIComponent(changeKey)}`,
      };

      const changeData = await relayBridge.submitRelayRequest('snow', relayRequest, 30000);

      if (!changeData || !changeData.result || changeData.result.length === 0) {
        return res.status(404).json({ error: 'Not found', message: `Change ${changeKey} not found in ServiceNow.` });
      }

      // ServiceNow returns an array of matches — take the first one
      const change = changeData.result[0];

      // Map ServiceNow field names to our internal schema
      res.json({
        sysId: change.sys_id || '',
        number: change.number || '',
        shortDescription: change.short_description || '',
        description: change.description || '',
        justification: change.justification || '',
        riskImpactAnalysis: change.risk_impact_analysis || '',
        chgBasicInfo: {
          category: change.category || '',
          changeType: change.type || '',
          requestedBy: change.requested_by ? { sysId: change.requested_by.value, displayName: change.requested_by.display_value } : { sysId: '', displayName: '' },
          assignmentGroup: change.assignment_group ? { sysId: change.assignment_group.value, displayName: change.assignment_group.display_value } : { sysId: '', displayName: '' },
        },
        chgPlanningAssessment: {
          impact: change.impact || '',
          systemAvailabilityImplication: change.u_availability_impact || '',
          hasBeenTested: change.u_change_tested || '',
          impactedPersonsAware: change.u_impacted_persons_aware || '',
          hasBeenPerformedPreviously: change.u_performed_previously || '',
          successProbability: change.u_success_probability || '',
          canBeBackedOut: change.u_can_be_backed_out || '',
        },
        chgPlanningContent: {
          implementationPlan: change.implementation_plan || '',
          backoutPlan: change.backout_plan || '',
          testPlan: change.test_plan || '',
        },
      });
    } catch (error) {
      console.error('  ❌ Error fetching change ' + changeKey + ':', error.message);
      res.status(502).json({
        error: 'Relay error',
        message: 'Failed to fetch change from ServiceNow. Ensure the relay bookmarklet is active and ServiceNow is accessible.',
        details: error.message,
      });
    }
  });

  // ── PATCH /api/snow-relay/change/:changeKey ────────────────────────────────
  // Updates an existing ServiceNow CHG (Change Request) record.
  // Uses the relayBridge to communicate with ServiceNow via the browser session or proxy credentials.
  //
  // Params: changeKey (e.g., "CHG0046897")
  // Body: { shortDescription, description, chgBasicInfo, chgPlanningAssessment, chgPlanningContent, changeTasks }
  // Returns: 204 No Content on success
  // Returns: 404 if the change does not exist
  // Returns: 502 if the relay bridge is not active or ServiceNow is unreachable

  router.patch('/api/snow-relay/change/:changeKey', async (req, res) => {
    const changeKey = (req.params.changeKey || '').trim().toUpperCase();
    const changeData = req.body || {};

    if (!changeKey) {
      return res.status(400).json({ error: 'Missing changeKey', message: 'Change key is required in the URL path.' });
    }

    try {
      // First, fetch the current change to get its sys_id
      const fetchRelayRequest = {
        method: 'GET',
        url: `/api/now/v2/table/change_request?sysparm_query=number=${encodeURIComponent(changeKey)}`,
      };

      const fetchResult = await relayBridge.submitRelayRequest('snow', fetchRelayRequest, 30000);

      if (!fetchResult || !fetchResult.result || fetchResult.result.length === 0) {
        return res.status(404).json({ error: 'Not found', message: `Change ${changeKey} not found in ServiceNow.` });
      }

      const sysId = fetchResult.result[0].sys_id;
      const selectedEnvironmentState = readSelectedModifyEnvironmentState(changeData);

      // Build the update payload with ServiceNow field names
      const updatePayload = {
        short_description: changeData.shortDescription || '',
        description: changeData.description || '',
        justification: changeData.justification || '',
        risk_impact_analysis: changeData.riskImpactAnalysis || '',
      };

      if (changeData.chgBasicInfo) {
        if (changeData.chgBasicInfo.category) updatePayload.category = changeData.chgBasicInfo.category;
        if (changeData.chgBasicInfo.changeType) updatePayload.type = changeData.chgBasicInfo.changeType;
        if (changeData.chgBasicInfo.environment) updatePayload.u_environment = changeData.chgBasicInfo.environment;
        if (changeData.chgBasicInfo.assignmentGroup) {
          updatePayload.assignment_group = typeof changeData.chgBasicInfo.assignmentGroup === 'string' 
            ? changeData.chgBasicInfo.assignmentGroup 
            : changeData.chgBasicInfo.assignmentGroup.sysId;
        }

        if (selectedEnvironmentState) {
          updatePayload.cmdb_ci = readModifySnowReferenceSysId(selectedEnvironmentState.configItem);
        } else {
          const configItemSysId = readModifySnowReferenceSysId(changeData.chgBasicInfo.configItem);
          if (configItemSysId) updatePayload.cmdb_ci = configItemSysId;
        }
      }

      if (changeData.chgPlanningAssessment) {
        if (changeData.chgPlanningAssessment.impact) updatePayload.impact = changeData.chgPlanningAssessment.impact;
        if (changeData.chgPlanningAssessment.systemAvailabilityImplication) updatePayload.u_availability_impact = changeData.chgPlanningAssessment.systemAvailabilityImplication;
        if (changeData.chgPlanningAssessment.hasBeenTested) updatePayload.u_change_tested = changeData.chgPlanningAssessment.hasBeenTested;
        if (selectedEnvironmentState) {
          updatePayload.u_impacted_persons_aware = selectedEnvironmentState.impactedPersonsAware || '';
        } else if (changeData.chgPlanningAssessment.impactedPersonsAware) {
          updatePayload.u_impacted_persons_aware = changeData.chgPlanningAssessment.impactedPersonsAware;
        }
        if (changeData.chgPlanningAssessment.hasBeenPerformedPreviously) updatePayload.u_performed_previously = changeData.chgPlanningAssessment.hasBeenPerformedPreviously;
        if (changeData.chgPlanningAssessment.successProbability) updatePayload.u_success_probability = changeData.chgPlanningAssessment.successProbability;
        if (changeData.chgPlanningAssessment.canBeBackedOut) updatePayload.u_can_be_backed_out = changeData.chgPlanningAssessment.canBeBackedOut;
      }

      if (changeData.chgPlanningContent) {
        if (changeData.chgPlanningContent.implementationPlan) updatePayload.implementation_plan = changeData.chgPlanningContent.implementationPlan;
        if (changeData.chgPlanningContent.backoutPlan) updatePayload.backout_plan = changeData.chgPlanningContent.backoutPlan;
        if (changeData.chgPlanningContent.testPlan) updatePayload.test_plan = changeData.chgPlanningContent.testPlan;
      }

      if (selectedEnvironmentState) {
        updatePayload.planned_start_date = selectedEnvironmentState.plannedStartDate || '';
        updatePayload.planned_end_date = selectedEnvironmentState.plannedEndDate || '';
      }

      // Submit the PATCH request via relay
      const updateRelayRequest = {
        method: 'PATCH',
        url: `/api/now/v2/table/change_request/${sysId}`,
        body: updatePayload,
      };

      await relayBridge.submitRelayRequest('snow', updateRelayRequest, 30000);

      // Also handle CTASKs if provided
      if (changeData.changeTasks && Array.isArray(changeData.changeTasks) && changeData.changeTasks.length > 0) {
        for (const ctask of changeData.changeTasks) {
          // Create new CTASK records linked to this change
          const ctaskPayload = {
            change_request: sysId,
            short_description: ctask.shortDescription || '',
            description: ctask.description || '',
            assignment_group: typeof ctask.assignmentGroup === 'string' ? ctask.assignmentGroup : (ctask.assignmentGroup?.sysId || ''),
            assigned_to: typeof ctask.assignedTo === 'string' ? ctask.assignedTo : (ctask.assignedTo?.sysId || ''),
            planned_start_date: ctask.plannedStartDate || '',
            planned_end_date: ctask.plannedEndDate || '',
          };

          const ctaskRelayRequest = {
            method: 'POST',
            url: '/api/now/v2/table/change_task',
            body: ctaskPayload,
          };

          try {
            await relayBridge.submitRelayRequest('snow', ctaskRelayRequest, 30000);
          } catch (ctaskError) {
            // Log CTASK creation failures but don't fail the entire update
            console.warn('  ⚠ Failed to create CTASK:', ctaskError.message);
          }
        }
      }

      console.log('  ✅ Change ' + changeKey + ' updated successfully');
      res.status(204).send();
    } catch (error) {
      console.error('  ❌ Error updating change ' + changeKey + ':', error.message);
      res.status(502).json({
        error: 'Relay error',
        message: 'Failed to update change in ServiceNow. Ensure the relay bookmarklet is active and ServiceNow is accessible.',
        details: error.message,
      });
    }
  });

  // ── GET /api/snow-relay/my-changes ──────────────────────────────────────
  // Fetches all open ServiceNow Changes assigned to the current user.
  // Uses the relayBridge to query ServiceNow via the browser session or proxy credentials.
  //
  // Query params: state (optional, defaults to "1,2,3" = Open, Pending, In Progress)
  // Returns: 200 [ { key, summary, state, priority, assignedTo }, ... ] on success
  // Returns: 502 if the relay bridge is not active or ServiceNow is unreachable
  // Returns: 500 if parsing user information fails

  router.get('/api/snow-relay/my-changes', async (req, res) => {
   try {
     // Fetch the current user to get their sys_id for filtering changes
     const userRelayRequest = {
       method: 'GET',
       url: '/api/now/v2/table/sys_user?sysparm_query=user_name=javascript:gs.getUserID()&sysparm_fields=sys_id,user_name,name',
       headers: { 'X-User-Override': 'true' },
     };

     let currentUser;
     try {
       const userResponse = await relayBridge.submitRelayRequest('snow', userRelayRequest, 30000);
       if (!userResponse || !userResponse.result || userResponse.result.length === 0) {
         return res.status(500).json({
           error: 'User not found',
           message: 'Could not determine current ServiceNow user. Ensure you are logged in to ServiceNow.',
         });
       }
       currentUser = userResponse.result[0];
     } catch (userFetchError) {
       // Fall back to querying by assignment_group instead of individual user
       currentUser = null;
     }

     // Default state filter: open (1), pending (2), in progress (3)
     const stateFilter = (req.query.state || '1,2,3').trim();

     // Query for changes: ordered by state and last modified, showing most recent first
     const changeQueryParts = [
       `state=${encodeURIComponent(stateFilter)}`,
       currentUser
         ? `assigned_to=${encodeURIComponent(currentUser.sys_id)}`
         : 'ORDERBYDESCpriority',
     ];

     const changesRelayRequest = {
       method: 'GET',
       url: `/api/now/v2/table/change_request?sysparm_query=${changeQueryParts.join('^')}&sysparm_fields=sys_id,number,short_description,state,priority,assigned_to&sysparm_limit=100`,
     };

     const changesResponse = await relayBridge.submitRelayRequest('snow', changesRelayRequest, 30000);

     if (!changesResponse || !changesResponse.result) {
       return res.json([]);
     }

     // Transform ServiceNow records into a clean API response with key and summary for UI binding
     const changes = changesResponse.result.map((changeRecord) => ({
       key: changeRecord.number || '',
       summary: changeRecord.short_description || '',
       state: changeRecord.state || '',
       priority: changeRecord.priority || '',
       assignedTo: changeRecord.assigned_to
         ? {
             sysId: changeRecord.assigned_to.value || '',
             displayName: changeRecord.assigned_to.display_value || '',
           }
         : { sysId: '', displayName: '' },
     }));

     res.json(changes);
   } catch (error) {
     console.error('  ❌ Error fetching user changes:', error.message);
     res.status(502).json({
       error: 'Relay error',
       message: 'Failed to fetch open changes from ServiceNow. Ensure the relay bookmarklet is active and ServiceNow is accessible.',
       details: error.message,
     });
   }
  });

  // ── Startup GitHub probe ─────────────────────────────────────────────────────
  // Run a background connectivity check once at startup so the connection bar
  // reflects real status immediately — not just "credentials are present".
  // Non-blocking: errors are swallowed and the cache stays false.
  if (hasGitHubAppCredentials(configuration) || configuration.github.pat) {
   runGitHubConnectivityProbe(configuration).catch(() => {});
  }

  return router;
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Builds proxy status for a first-install demo tab without exposing real config.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {object}
 */
function buildDemoProxyStatusResponse(configuration) {
  return {
    proxy:     true,
    version:   APP_VERSION,
    sslVerify: configuration.sslVerify !== false,
    jira:       buildBlankServiceStatus(),
    snow: {
      ...buildBlankServiceStatus(),
      sessionMode:      false,
      sessionExpiresAt: null,
    },
    github: {
      ...buildBlankServiceStatus(),
      probeCheckedAt: null,
    },
    confluence: buildBlankServiceStatus(),
  };
}

/**
 * Builds Admin Hub connectivity config for a demo tab with all services blank.
 *
 * @returns {object}
 */
function buildDemoConnectivityConfigResponse() {
  return {
    snow: {
      baseUrl: '',
      hasCredentials: false,
      usernameMasked: null,
    },
    github: {
      baseUrl: '',
      hasPat: false,
      hasAppAuth: false,
    },
    confluence: {
      baseUrl: '',
      hasCredentials: false,
      usernameMasked: null,
    },
  };
}

/**
 * Builds legacy proxy-config response for a demo tab with all credentials hidden.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {object}
 */
function buildDemoProxyConfigResponse(configuration) {
  return {
    port: configuration.port,
    jira: {
      baseUrl: '',
      hasCredentials: false,
    },
    snow: {
      baseUrl: '',
      hasCredentials: false,
    },
    github: {
      hasCredentials: false,
    },
    confluence: {
      baseUrl: '',
      hasCredentials: false,
    },
  };
}

/**
 * Creates the common blank status object used by first-install demo services.
 *
 * @returns {object}
 */
function buildBlankServiceStatus() {
  return {
    configured: false,
    hasCredentials: false,
    ready: false,
    baseUrl: null,
  };
}

/**
 * Appends the hidden restart-handoff flag so restarted processes fail fast if
 * the old listener never releases the port.
 *
 * @returns {string[]}
 */
function buildRestartArguments() {
  const restartArguments = process.pkg ? process.argv.slice(2) : process.argv.slice(1);
  if (!restartArguments.includes(RESTART_HANDOFF_ARGUMENT)) {
    restartArguments.push(RESTART_HANDOFF_ARGUMENT);
  }
  return restartArguments;
}

/**
 * Default shutdown handler used by isolated route tests that do not inject the
 * real server lifecycle controls from server.js.
 *
 * @param {{ delayMs?: number }} [options]
 * @returns {void}
 */
function defaultRequestShutdown(options = {}) {
  const delayMs = options.delayMs ?? SHUTDOWN_RESPONSE_DELAY_MS;
  setTimeout(() => {
    console.log('  🛑 Shutdown requested from Admin Hub — stopping server.');
    process.exit(0);
  }, delayMs);
}

/**
 * Default restart handler used when the router runs outside the real server.
 *
 * @param {{ delayMs?: number, execPath?: string, execArgs?: string[] }} [options]
 * @returns {void}
 */
function defaultRequestRestart(options = {}) {
  const delayMs = options.delayMs ?? SHUTDOWN_RESPONSE_DELAY_MS;
  const execPath = options.execPath || process.execPath;
  const execArgs = options.execArgs || buildRestartArguments();
  setTimeout(() => {
    console.log('  🔄 Restart requested from Admin Hub — relaunching server.');
    spawnDetachedProcess(execPath, execArgs, process.cwd());
    process.exit(0);
  }, delayMs);
}

/**
 * Default staged-replacement handler used by isolated route tests.
 *
 * @param {{ delayMs?: number, execPath: string, execArgs: string[] }} options
 * @returns {void}
 */
function defaultRequestReplacement(options) {
  const delayMs = options.delayMs ?? UPDATE_RESPONSE_DELAY_MS;
  setTimeout(() => {
    spawnReplacementAndExit(options.execPath, options.execArgs);
  }, delayMs);
}

/**
 * Masks a service account username so it can be included in diagnostic reports
 * without exposing the full credential. Reveals up to 4 leading characters and
 * the last character — enough to confirm which account is configured without
 * disclosing anything useful to an attacker.
 *
 * Examples:
 *   'svc_toolbox'  → 'svc_****x'
 *   'admin'        → 'admi****n'
 *   'ab'           → '****'      (too short to reveal anything meaningful)
 *   ''             → null        (not configured)
 *
 * @param {string} username - Raw username from config (may be empty)
 * @returns {string|null} Masked username, or null if username is empty
 */
function maskCredentialUsername(username) {
  if (!username) return null;
  if (username.length <= 4) return '****';
  const visiblePrefixLength = Math.min(4, Math.floor(username.length / 3));
  return username.slice(0, visiblePrefixLength) + '****' + username.slice(-1);
}


/**
 * Merges incoming Jira configuration fields into the live config object.
 * Only fields that are present and defined in the incoming data are applied.
 *
 * @param {object} configuration  - Live config (mutated in place)
 * @param {object} [incomingJira] - Partial Jira config from the request
 */
function mergeJiraConfig(configuration, incomingJira) {
  if (!incomingJira) return;
  if (incomingJira.baseUrl  !== undefined) configuration.jira.baseUrl  = incomingJira.baseUrl;
  if (incomingJira.username !== undefined) configuration.jira.username = incomingJira.username;
  if (incomingJira.apiToken !== undefined) configuration.jira.apiToken = incomingJira.apiToken;
  if (incomingJira.pat      !== undefined) configuration.jira.pat      = incomingJira.pat;
}

/**
 * Merges incoming ServiceNow configuration fields into the live config object.
 *
 * @param {object} configuration  - Live config (mutated in place)
 * @param {object} [incomingSnow] - Partial SNow config from the request
 */
function mergeSnowConfig(configuration, incomingSnow) {
  if (!incomingSnow) return;
  if (incomingSnow.baseUrl  !== undefined) configuration.snow.baseUrl  = incomingSnow.baseUrl;
  if (incomingSnow.username !== undefined) configuration.snow.username = incomingSnow.username;
  if (incomingSnow.password !== undefined) configuration.snow.password = incomingSnow.password;
}

/**
 * Merges incoming GitHub configuration fields into the live config object.
 * Clears the App installation token cache when App credentials change so
 * the next API call fetches a fresh token.
 *
 * @param {object} configuration    - Live config (mutated in place)
 * @param {object} [incomingGithub] - Partial GitHub config from the request
 */
function mergeGithubConfig(configuration, incomingGithub) {
  if (!incomingGithub) return;
  if (incomingGithub.pat !== undefined) configuration.github.pat = (incomingGithub.pat || '').trim();

  // Apply GitHub App fields — clear the installation token cache so the new
  // credentials take effect immediately without waiting for the old token to expire.
  let isAppCredentialChanged = false;
  if (incomingGithub.appId !== undefined) {
    configuration.github.appId = (incomingGithub.appId || '').trim();
    isAppCredentialChanged = true;
  }
  if (incomingGithub.installationId !== undefined) {
    configuration.github.installationId = (incomingGithub.installationId || '').trim();
    isAppCredentialChanged = true;
  }
  if (incomingGithub.appPrivateKey !== undefined && incomingGithub.appPrivateKey.trim()) {
    configuration.github.appPrivateKey = incomingGithub.appPrivateKey.trim();
    isAppCredentialChanged = true;
  }
  if (isAppCredentialChanged) {
    clearInstallationTokenCache();
  }
}

/**
 * Merges incoming Confluence configuration fields into the live config object.
 * Confluence Cloud uses Basic Auth — username is the Atlassian email, apiToken
 * is a Cloud API token generated at id.atlassian.com (not the same as Jira PAT).
 *
 * @param {object} configuration        - Live config (mutated in place)
 * @param {object} [incomingConfluence] - Partial Confluence config from the request
 */
function mergeConfluenceConfig(configuration, incomingConfluence) {
  if (!incomingConfluence) return;
  // Ensure the confluence object exists even if this is the first time it is set
  configuration.confluence = configuration.confluence || {};
  if (incomingConfluence.baseUrl  !== undefined) configuration.confluence.baseUrl  = incomingConfluence.baseUrl;
  if (incomingConfluence.username !== undefined) configuration.confluence.username = incomingConfluence.username;
  if (incomingConfluence.apiToken !== undefined) configuration.confluence.apiToken = incomingConfluence.apiToken;
}

// ── Version Check Helpers ──────────────────────────────────────────────────────

/**
 * Compares two semver strings and returns true when versionA is newer.
 *
 * @param {string} versionA - Candidate version.
 * @param {string} versionB - Current version.
 * @returns {boolean}
 */
function isSemverGreaterThan(versionA, versionB) {
  const versionAParts = versionA.split('.').map(Number);
  const versionBParts = versionB.split('.').map(Number);

  for (let partIndex = 0; partIndex < 3; partIndex += 1) {
    const candidatePart = versionAParts[partIndex] || 0;
    const currentPart = versionBParts[partIndex] || 0;
    if (candidatePart > currentPart) return true;
    if (candidatePart < currentPart) return false;
  }

  return false;
}

/**
 * Creates the UI response shape used by the Admin Hub update section.
 *
 * @param {string} latestVersion - Most recent version that could be resolved.
 * @param {string} releaseNotes - Release notes or a human-readable status message.
 * @returns {{ currentVersion: string, latestVersion: string, hasUpdate: boolean, releaseNotes: string }}
 */
function buildVersionCheckResponse(latestVersion, releaseNotes) {
  return {
    currentVersion: APP_VERSION,
    latestVersion,
    hasUpdate: isSemverGreaterThan(latestVersion, APP_VERSION),
    releaseNotes,
  };
}

/**
 * Wraps HTTPS requests so version checks can apply a consistent timeout and
 * produce plain-English failures instead of leaving the UI spinning.
 *
 * @param {string} url - Full HTTPS URL to request.
 * @param {{ method?: string, requestLabel: string, timeoutMs?: number }} options
 * @returns {Promise<{ statusCode: number, headers: import('http').IncomingHttpHeaders, body: string }>}
 */
function requestHttpsText(url, options) {
  const requestMethod = options.method || 'GET';
  const timeoutMs = options.timeoutMs || VERSION_CHECK_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let hasSettled = false;
    function resolveOnce(value) {
      if (hasSettled) return;
      hasSettled = true;
      resolve(value);
    }
    function rejectOnce(error) {
      if (hasSettled) return;
      hasSettled = true;
      reject(error);
    }

    const outgoingRequest = https.request(url, {
      method: requestMethod,
      headers: {
        'User-Agent': 'NodeToolbox/' + APP_VERSION,
        'Accept': 'application/vnd.github.v3+json',
      },
    }, (incomingResponse) => {
      let responseBody = '';
      incomingResponse.on('data', (responseChunk) => {
        responseBody += responseChunk;
      });
      incomingResponse.on('end', () => {
        resolveOnce({
          statusCode: incomingResponse.statusCode || 0,
          headers: incomingResponse.headers,
          body: responseBody,
        });
      });
    });

    outgoingRequest.on('error', rejectOnce);
    outgoingRequest.setTimeout(timeoutMs, () => {
      outgoingRequest.destroy(new Error(`${options.requestLabel} timed out after ${timeoutMs} ms.`));
    });
    outgoingRequest.end();
  });
}

/**
 * Reads the latest version and release notes from GitHub's JSON release API.
 *
 * @returns {Promise<{ latestVersion: string, releaseNotes: string }>}
 */
async function fetchLatestReleaseFromApi() {
  const apiResponse = await requestHttpsText(VERSION_CHECK_API_URL, {
    requestLabel: 'GitHub API version check',
  });

  if (apiResponse.statusCode < 200 || apiResponse.statusCode >= 300) {
    throw new Error(`GitHub API returned HTTP ${apiResponse.statusCode}.`);
  }

  let releasePayload;
  try {
    releasePayload = JSON.parse(apiResponse.body);
  } catch {
    throw new Error('Could not parse GitHub release data.');
  }

  const latestVersion = String(releasePayload.tag_name || '').replace(/^v/, '');
  if (!latestVersion) {
    throw new Error('GitHub release data did not include a tag name.');
  }

  return {
    latestVersion,
    releaseNotes: releasePayload.body || '',
  };
}

/**
 * Extracts the latest release version from GitHub's public latest-release redirect.
 *
 * @returns {Promise<{ latestVersion: string, releaseNotes: string }>}
 */
async function fetchLatestReleaseFromRedirect() {
  const redirectResponse = await requestHttpsText(VERSION_CHECK_REDIRECT_URL, {
    method: 'HEAD',
    requestLabel: 'GitHub release redirect check',
  });

  const redirectLocationHeader = Array.isArray(redirectResponse.headers.location)
    ? redirectResponse.headers.location[0]
    : redirectResponse.headers.location || '';
  const locationMatch = /\/releases\/tag\/v?([^/?#]+)/.exec(redirectLocationHeader);
  const latestVersion = locationMatch ? locationMatch[1] : '';

  if (redirectResponse.statusCode >= 300 && redirectResponse.statusCode < 400 && latestVersion) {
    return {
      latestVersion,
      releaseNotes: VERSION_CHECK_REDIRECT_RELEASE_NOTES,
    };
  }

  throw new Error(`GitHub release redirect returned HTTP ${redirectResponse.statusCode}.`);
}

/**
 * Runs both public GitHub version-check paths and returns the best available result.
 *
 * @returns {Promise<{ currentVersion: string, latestVersion: string, hasUpdate: boolean, releaseNotes: string }>}
 */
async function resolveVersionCheckResult() {
  const [apiResult, redirectResult] = await Promise.allSettled([
    fetchLatestReleaseFromApi(),
    fetchLatestReleaseFromRedirect(),
  ]);

  if (apiResult.status === 'fulfilled') {
    return buildVersionCheckResponse(apiResult.value.latestVersion, apiResult.value.releaseNotes);
  }

  if (redirectResult.status === 'fulfilled') {
    return buildVersionCheckResponse(redirectResult.value.latestVersion, redirectResult.value.releaseNotes);
  }

  const apiErrorMessage = apiResult.reason instanceof Error ? apiResult.reason.message : 'Unknown GitHub API error.';
  const redirectErrorMessage = redirectResult.reason instanceof Error ? redirectResult.reason.message : 'Unknown GitHub redirect error.';

  return buildVersionCheckResponse(
    APP_VERSION,
    `Could not reach GitHub to check for updates. API: ${apiErrorMessage} Fallback: ${redirectErrorMessage}`,
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createApiRouter;
