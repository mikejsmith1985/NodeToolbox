// src/routes/setup.js — First-run credential setup wizard.
//
// Serves a self-contained HTML wizard on GET /setup that walks the user through
// entering their Jira, GitHub, and ServiceNow credentials. On POST /api/setup,
// validates the input, writes toolbox-proxy.json, and redirects to the dashboard.
// No external CDN dependencies — the entire wizard ships as a single inline HTML response.

'use strict';

const express  = require('express');
const { saveConfigToDisk, isServiceConfigured } = require('../config/loader');

// ── Constants ────────────────────────────────────────────────────────────────

/** CSS custom properties matching the Toolbox dark theme palette */
const WIZARD_THEME_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:       #0d1117; --surface: #161b22; --surface2: #21262d;
    --border:   #30363d; --border-strong: #484f58;
    --text:     #e6edf3; --text-muted: #7d8590;
    --accent:   #2f81f7; --accent-h: #388bfd;
    --success:  #3fb950; --warning: #d29922; --danger: #f85149;
  }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: var(--bg); color: var(--text); min-height: 100vh;
         padding: 40px 20px; }
  .wizard-header { text-align: center; margin-bottom: 40px; }
  .wizard-header h1 { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
  .wizard-header p  { color: var(--text-muted); font-size: 14px; }
  .cards { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center;
           max-width: 1080px; margin: 0 auto; }
  .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 24px; width: 320px; flex-shrink: 0; }
  .card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .card-icon   { font-size: 24px; }
  .card-title  { font-size: 17px; font-weight: 600; }
  .card-optional { font-size: 11px; color: var(--text-muted);
                   background: var(--surface2); border-radius: 4px;
                   padding: 2px 7px; margin-left: auto; }
  label { display: block; font-size: 12px; color: var(--text-muted);
          margin: 14px 0 5px; }
  label:first-of-type { margin-top: 0; }
  input[type=text], input[type=password], input[type=url] {
    width: 100%; padding: 8px 11px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font-size: 13px; outline: none; }
  input:focus { border-color: var(--accent); }
  .hint { font-size: 11px; color: var(--text-muted); margin-top: 5px; line-height: 1.5; }
  .submit-row { display: flex; justify-content: center; margin-top: 36px; }
  .btn-primary { padding: 12px 40px; background: var(--accent); color: #fff;
                 border: none; border-radius: 8px; font-size: 15px; font-weight: 600;
                 cursor: pointer; transition: background .2s; }
  .btn-primary:hover { background: var(--accent-h); }
  .error-banner { display: none; background: rgba(248,81,73,.12); border: 1px solid var(--danger);
                  color: var(--danger); border-radius: 8px; padding: 12px 16px;
                  margin-bottom: 24px; max-width: 1080px; margin-left: auto; margin-right: auto;
                  text-align: center; font-size: 13px; }
  .error-banner.visible { display: block; }
`;

/** Inline JavaScript for the setup wizard form submission */
const WIZARD_JS = `
  document.getElementById('setup-form').addEventListener('submit', async function(ev) {
    ev.preventDefault();
    const banner  = document.getElementById('error-banner');
    const submitButton = document.querySelector('.btn-primary');
    banner.className = 'error-banner';
    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';

    const payload = {
      jiraBaseUrl:  document.getElementById('jira-base-url').value.trim(),
      jiraPat:      document.getElementById('jira-pat').value.trim(),
      githubPat:    document.getElementById('github-pat').value.trim(),
      snowBaseUrl:  document.getElementById('snow-base-url').value.trim(),
      snowUsername: document.getElementById('snow-username').value.trim(),
      snowPassword: document.getElementById('snow-password').value.trim(),
    };

    try {
      const response = await fetch('/api/setup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      if (response.ok || response.redirected) {
        window.location.href = '/';
        return;
      }

      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      banner.textContent = errorData.error || 'Setup failed — please check your inputs.';
      banner.className = 'error-banner visible';
    } catch (networkError) {
      banner.textContent = 'Could not reach the proxy server: ' + networkError.message;
      banner.className = 'error-banner visible';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Save and Continue →';
    }
  });
`;

// ── Router Factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router for the setup wizard endpoints.
 *
 * @param {import('../config/loader').ProxyConfig} configuration - Live config (mutated on POST)
 * @returns {import('express').Router}
 */
function createSetupRouter(configuration) {
  const router = express.Router();

  // ── GET /setup ─────────────────────────────────────────────────────────────
  // Serves the self-contained credential wizard. Pre-fills base URLs if already
  // set so users can update credentials without re-entering their instance URLs.

  router.get('/setup', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(buildWizardHtml(configuration));
  });

  // ── POST /api/setup ────────────────────────────────────────────────────────
  // Accepts credentials, updates the live config, persists to disk, redirects to /.

  router.post('/api/setup', (req, res) => {
    const {
      jiraBaseUrl  = '',
      jiraPat      = '',
      githubPat    = '',
      snowBaseUrl  = '',
      snowUsername = '',
      snowPassword = '',
    } = req.body || {};

    const cleanJiraBaseUrl  = jiraBaseUrl.trim().replace(/\/+$/, '');
    const cleanJiraPat      = jiraPat.trim();
    const cleanGithubPat    = githubPat.trim();
    const cleanSnowBaseUrl  = snowBaseUrl.trim().replace(/\/+$/, '');
    const cleanSnowUsername = snowUsername.trim();
    const cleanSnowPassword = snowPassword.trim();

    // Require at least one service to have enough info to be usable
    const hasJiraConfig   = !!(cleanJiraBaseUrl && cleanJiraPat);
    const hasGithubConfig = !!cleanGithubPat;
    const hasSnowConfig   = !!(cleanSnowBaseUrl && cleanSnowUsername && cleanSnowPassword);

    if (!hasJiraConfig && !hasGithubConfig && !hasSnowConfig) {
      return res.status(400).json({
        error: 'Please configure at least one service before continuing.',
      });
    }

    // Merge submitted values into the live configuration
    if (cleanJiraBaseUrl) configuration.jira.baseUrl = cleanJiraBaseUrl;
    if (cleanJiraPat)     configuration.jira.pat     = cleanJiraPat;

    if (cleanGithubPat)   configuration.github.pat   = cleanGithubPat;

    if (cleanSnowBaseUrl)  configuration.snow.baseUrl  = cleanSnowBaseUrl;
    if (cleanSnowUsername) configuration.snow.username = cleanSnowUsername;
    if (cleanSnowPassword) configuration.snow.password = cleanSnowPassword;

    saveConfigToDisk(configuration);
    console.log('  ✅ Setup wizard completed — credentials saved');

    // Redirect to the dashboard — the browser fetch API follows 302 automatically
    res.redirect(302, '/');
  });

  return router;
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Builds the complete self-contained HTML for the setup wizard page.
 * Pre-fills base URL fields from the current configuration.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {string} Complete HTML document
 */
function buildWizardHtml(configuration) {
  const prefillJiraBaseUrl = escapeHtmlAttribute(configuration.jira && configuration.jira.baseUrl || '');
  const prefillSnowBaseUrl = escapeHtmlAttribute(configuration.snow && configuration.snow.baseUrl || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NodeToolbox — First-Run Setup</title>
  <style>${WIZARD_THEME_CSS}</style>
</head>
<body>
  <div class="wizard-header">
    <h1>🧰 NodeToolbox Setup</h1>
    <p>Configure your service connections to get started. You can update these at any time from the Admin Hub.</p>
  </div>

  <div id="error-banner" class="error-banner"></div>

  <form id="setup-form">
    <div class="cards">

      <!-- Jira Card -->
      <div class="card">
        <div class="card-header">
          <span class="card-icon">🎟</span>
          <span class="card-title">Jira</span>
        </div>

        <label for="jira-base-url">Instance URL</label>
        <input id="jira-base-url" type="url" placeholder="https://your-org.atlassian.net"
               value="${prefillJiraBaseUrl}" autocomplete="off" />
        <div class="hint">Your Atlassian Cloud or Server base URL</div>

        <label for="jira-pat">Personal Access Token</label>
        <input id="jira-pat" type="password" placeholder="Your Jira API token or PAT"
               autocomplete="new-password" />
        <div class="hint">Cloud: API token from id.atlassian.com → Account → Security. Server: PAT from profile settings.</div>
      </div>

      <!-- GitHub Card -->
      <div class="card">
        <div class="card-header">
          <span class="card-icon">🐙</span>
          <span class="card-title">GitHub</span>
          <span class="card-optional">optional</span>
        </div>

        <label for="github-pat">Personal Access Token</label>
        <input id="github-pat" type="password" placeholder="ghp_your_token_here"
               autocomplete="new-password" />
        <div class="hint">github.com → Settings → Developer settings → Personal access tokens. Needs <code>repo</code> scope for the branch monitor.</div>
      </div>

      <!-- ServiceNow Card -->
      <div class="card">
        <div class="card-header">
          <span class="card-icon">☁️</span>
          <span class="card-title">ServiceNow</span>
          <span class="card-optional">optional</span>
        </div>

        <label for="snow-base-url">Instance URL</label>
        <input id="snow-base-url" type="url" placeholder="https://your-instance.service-now.com"
               value="${prefillSnowBaseUrl}" autocomplete="off" />

        <label for="snow-username">Username</label>
        <input id="snow-username" type="text" placeholder="your.name@company.com"
               autocomplete="off" />

        <label for="snow-password">Password</label>
        <input id="snow-password" type="password" placeholder="Service account password"
               autocomplete="new-password" />
        <div class="hint">Used for Basic Auth. For Okta SSO environments, leave this blank and use the browser session relay instead.</div>
      </div>

    </div>

    <div class="submit-row">
      <button type="submit" class="btn-primary">Save and Continue →</button>
    </div>
  </form>

  <script>${WIZARD_JS}</script>
</body>
</html>`;
}

/**
 * Escapes a string for safe use in an HTML attribute value.
 * Prevents XSS from attacker-controlled config values being reflected into the page.
 *
 * @param {string} value - Raw string to escape
 * @returns {string} HTML-attribute-safe string
 */
function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createSetupRouter;
