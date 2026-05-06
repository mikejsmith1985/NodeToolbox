// src/routes/api.js — Express router for internal API endpoints.
//
// Provides health check, configuration read/write, ServiceNow session management,
// and a diagnostic endpoint for corporate-PC debugging. These are consumed by the
// Toolbox front-end dashboard and the connection wizard — not by the proxy pass-through.

'use strict';

const crypto     = require('crypto');
const express    = require('express');
const { saveConfigToDisk, isServiceConfigured, isServiceBaseUrlSet } = require('../config/loader');
const snowSession = require('../services/snowSession');
const { cachedDashboardHtml, cachedHtmlLoadMethod } = require('../utils/staticFileServer');
const { prepareUpdate, spawnReplacementAndExit }   = require('../utils/updater');
const relayBridge = require('./relayBridge');

/** Application version read once at startup — avoids repeated disk I/O per request */
const APP_VERSION = require('../../package.json').version;

// ── Router Factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router with all internal API endpoints.
 * The configuration object is passed by reference so live updates (e.g. from
 * POST /api/proxy-config) are immediately reflected in the proxy behaviour.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {import('express').Router}
 */
function createApiRouter(configuration) {
  const router = express.Router();

  // ── GET /api/proxy-status ────────────────────────────────────────────────
  // Health check endpoint used by the Toolbox front-end for auto-detection.
  // Returns which services are configured and ready — never exposes credentials.

  router.get('/api/proxy-status', (req, res) => {
    const isJiraHasBasicAuth = !!(configuration.jira.username && configuration.jira.apiToken);
    const isJiraHasPat       = !!configuration.jira.pat;
    const isJiraReady        = isServiceBaseUrlSet(configuration.jira) && (isJiraHasBasicAuth || isJiraHasPat);

    const isSnowHasBasicAuth    = !!(configuration.snow.username && configuration.snow.password);
    const isSnowSessionCurrent  = snowSession.isSessionActive();
    const isSnowReady           = (isServiceBaseUrlSet(configuration.snow) && isSnowHasBasicAuth) || isSnowSessionCurrent;

    const snowBaseUrl = (isServiceBaseUrlSet(configuration.snow) ? configuration.snow.baseUrl : null)
      || snowSession.resolveSnowBaseUrl('') || null;

    const isGithubReady = !!configuration.github.pat;

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
        configured:     isGithubReady,
        hasCredentials: isGithubReady,
        ready:          isGithubReady,
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

  router.get('/api/proxy-config', (req, res) => {
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

    if (!storedHash || inputHash !== storedHash) {
      // Log failed attempts to help diagnose lockouts (no rate-limiting needed: local server only)
      console.warn('  ⚠ Admin Hub: failed unlock attempt for user "' + username + '"');
      return res.status(401).json({ error: 'Unauthorized', message: 'Incorrect credentials.' });
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
      // Whether toolbox.html was successfully pre-loaded at startup
      cachedHtmlLoaded:  cachedDashboardHtml !== null,
      // Which code path loaded it: 'require' (snapshot), 'readFileSync' (disk), or null
      htmlLoadMethod:    cachedHtmlLoadMethod,
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
    // Small delay lets the HTTP response reach the browser before the process ends
    setTimeout(() => {
      console.log('  🛑 Shutdown requested from Admin Hub — stopping server.');
      process.exit(0);
    }, 300);
  });

  // ── POST /api/restart ────────────────────────────────────────────────────
  // Spawns a fresh detached copy of the server process, then exits this one.
  // Works for both plain `node server.js` and the pkg-compiled .exe launcher.
  // The new process starts after the port is released, using the same argv flags
  // (e.g. --open) that were originally passed to the current process.

  router.post('/api/restart', (_req, res) => {
    res.json({ ok: true, message: 'Server is restarting.' });
    setTimeout(() => {
      console.log('  🔄 Restart requested from Admin Hub — restarting server.');
      const { spawn } = require('child_process');
      // When running as a pkg-compiled exe, argv[1] is the internal snapshot path
      // (e.g. /snapshot/server.js) — skip it and pass only the user args that follow.
      // When running as plain node, argv[1] is the script path and must be included.
      const spawnArgs = process.pkg ? process.argv.slice(2) : process.argv.slice(1);
      const restartedProcess = spawn(process.execPath, spawnArgs, {
        detached: true,
        stdio:    'ignore',
        cwd:      process.cwd(),
        env:      process.env,
      });
      restartedProcess.unref();
      process.exit(0);
    }, 300);
  });

  // ── POST /api/update ────────────────────────────────────────────────────
  // Downloads a specific release version from GitHub, extracts it to a staging
  // directory, then spawns the new process and exits the current one.
  // Expects { version: "0.2.10" } in the request body.
  // Responds before the download begins because the process exits mid-download
  // from the browser's perspective — polling /api/version detects when the
  // replacement is ready.

  router.post('/api/update', async (req, res) => {
    const requestedVersion = (req.body && req.body.version) ? String(req.body.version).trim() : '';

    if (!requestedVersion) {
      return res.status(400).json({ ok: false, error: 'version is required' });
    }

    // Guard against requesting the version already running — nothing to do.
    if (requestedVersion === APP_VERSION) {
      return res.json({ alreadyLatest: true });
    }

    // Respond immediately so the browser knows the update is in progress.
    // The server process will exit once the download + extraction completes.
    res.json({ ok: true, restarting: true });

    try {
      console.log(`  ⬇ Update requested: v${APP_VERSION} → v${requestedVersion}`);
      const { newExecPath, newExecArgs } = await prepareUpdate(requestedVersion);
      console.log(`  ✅ Update staged — spawning v${requestedVersion} and exiting.`);
      spawnReplacementAndExit(newExecPath, newExecArgs);
    } catch (updateError) {
      // The response has already been sent, so log the failure server-side.
      // The browser will notice the server went away and show the restart polling UI.
      console.error('  ❌ Update failed:', updateError.message);
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

  return router;
}

// ── Private Helpers ───────────────────────────────────────────────────────────

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
 *
 * @param {object} configuration    - Live config (mutated in place)
 * @param {object} [incomingGithub] - Partial GitHub config from the request
 */
function mergeGithubConfig(configuration, incomingGithub) {
  if (!incomingGithub) return;
  if (incomingGithub.pat !== undefined) configuration.github.pat = (incomingGithub.pat || '').trim();
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createApiRouter;
