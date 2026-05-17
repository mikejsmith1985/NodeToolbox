// src/routes/api.js — Express router for internal API endpoints.
//
// Provides health check, configuration read/write, ServiceNow session management,
// and a diagnostic endpoint for corporate-PC debugging. These are consumed by the
// Toolbox front-end dashboard and the connection wizard — not by the proxy pass-through.

'use strict';

const path       = require('path');
const crypto     = require('crypto');
const express    = require('express');
const { saveConfigToDisk, isServiceConfigured, isServiceBaseUrlSet } = require('../config/loader');
const snowSession = require('../services/snowSession');
const { clearInstallationTokenCache, hasGitHubAppCredentials, getValidInstallationToken } = require('../services/githubAppAuth');

const { prepareUpdate, spawnReplacementAndExit }   = require('../utils/updater');
const relayBridge = require('./relayBridge');
const logBuffer   = require('../utils/logBuffer');

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

    const isGithubReady = !!(configuration.github.pat) || hasGitHubAppCredentials(configuration);

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
        baseUrl:    githubConfig.baseUrl || '',
        hasPat:     !!(githubConfig.pat),
        hasAppAuth: hasGitHubAppCredentials(configuration),
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
        baseUrl:    configuration.github.baseUrl || '',
        hasPat:     !!(configuration.github.pat),
        hasAppAuth: hasGitHubAppCredentials(configuration),
      },
      confluence: {
        baseUrl:        savedConfluenceConfig.baseUrl || '',
        hasCredentials: !!(savedConfluenceConfig.username && savedConfluenceConfig.apiToken),
        usernameMasked: maskCredentialUsername(savedConfluenceConfig.username || ''),
      },
    });
  });

  // ── POST /api/config/connectivity/test ────────────────────────────────────
  // Probes the configured Snow or GitHub endpoint and returns live reachability
  // status. Used by the Admin Hub "Test" buttons so the user can verify their
  // settings before saving. Expects { system: 'snow' | 'github' } in the body.

  router.post('/api/config/connectivity/test', async (req, res) => {
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
      const githubConfig = configuration.github || {};
      const isAppConfigured = hasGitHubAppCredentials(configuration);
      const isPatConfigured = !!(githubConfig.pat);

      if (!isAppConfigured && !isPatConfigured) {
        return res.json({ ok: false, statusCode: 0, message: 'No GitHub credentials configured. Add a PAT or GitHub App credentials in Admin Hub.' });
      }

      try {
        const githubBaseUrl = (githubConfig.baseUrl || 'https://api.github.com').replace(/\/$/, '');
        let authHeader;

        if (isAppConfigured) {
          // Prefer App auth — bypasses SAML SSO enforcement on enterprise orgs
          const installationToken = await getValidInstallationToken(configuration);
          authHeader = 'token ' + installationToken;
        } else {
          authHeader = 'token ' + githubConfig.pat;
        }

        const proxyResponse = await fetch(githubBaseUrl + '/user', {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'User-Agent':    'NodeToolbox',
            'Accept':        'application/vnd.github.v3+json',
          },
        });
        const authMethod = isAppConfigured ? 'GitHub App' : 'PAT';
        res.json({
          ok:         proxyResponse.ok,
          statusCode: proxyResponse.status,
          authMethod,
          message:    proxyResponse.ok
            ? 'Connected successfully via ' + authMethod + '.'
            : 'Received HTTP ' + proxyResponse.status + ' (auth method: ' + authMethod + ')',
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
  // Fetches https://api.github.com/repos/mikejsmith1985/NodeToolbox/releases/latest
  // and compares tag_name to APP_VERSION. Fails gracefully on network error.

  router.get('/api/version-check', (req, res) => {
    const https = require('https');
    const GITHUB_RELEASES_URL = 'https://api.github.com/repos/mikejsmith1985/NodeToolbox/releases/latest';

    /** Compares two semver strings — returns true when versionA > versionB. */
    function isSemverGreaterThan(versionA, versionB) {
      const partsA = versionA.split('.').map(Number);
      const partsB = versionB.split('.').map(Number);
      for (let partIndex = 0; partIndex < 3; partIndex++) {
        const partA = partsA[partIndex] || 0;
        const partB = partsB[partIndex] || 0;
        if (partA > partB) return true;
        if (partA < partB) return false;
      }
      return false;
    }

    const githubRequest = https.get(
      GITHUB_RELEASES_URL,
      {
        headers: {
          'User-Agent': 'NodeToolbox/' + APP_VERSION,
          'Accept':     'application/vnd.github.v3+json',
        },
      },
      (githubResponse) => {
        let responseBody = '';
        githubResponse.on('data', (chunk) => { responseBody += chunk; });
        githubResponse.on('end', () => {
          try {
            const releaseData = JSON.parse(responseBody);
            // tag_name is typically 'v0.7.0' — strip the leading 'v' for comparison.
            const latestVersion = (releaseData.tag_name || APP_VERSION).replace(/^v/, '');
            const hasUpdate = isSemverGreaterThan(latestVersion, APP_VERSION);
            res.json({
              currentVersion: APP_VERSION,
              latestVersion,
              hasUpdate,
              releaseNotes: releaseData.body || '',
            });
          } catch {
            res.json({
              currentVersion: APP_VERSION,
              latestVersion:  APP_VERSION,
              hasUpdate:      false,
              releaseNotes:   'Could not parse GitHub release data.',
            });
          }
        });
      },
    );

    githubRequest.on('error', () => {
      res.json({
        currentVersion: APP_VERSION,
        latestVersion:  APP_VERSION,
        hasUpdate:      false,
        releaseNotes:   'Could not reach GitHub to check for updates.',
      });
    });

    // Abort after 8 seconds so the UI does not hang on slow networks.
    githubRequest.setTimeout(8000, () => {
      githubRequest.destroy();
      res.json({
        currentVersion: APP_VERSION,
        latestVersion:  APP_VERSION,
        hasUpdate:      false,
        releaseNotes:   'Version check timed out.',
      });
    });
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
      // Give the response 300 ms to flush through Express and reach the browser
      // before process.exit(0) tears down the socket.
      res.json({ ok: true, restarting: true });
      setTimeout(() => spawnReplacementAndExit(newExecPath, newExecArgs), 300);
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createApiRouter;
