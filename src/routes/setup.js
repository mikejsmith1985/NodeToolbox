// src/routes/setup.js — First-run guided credential setup wizard.
//
// Serves a friendly step-by-step HTML wizard on GET /setup that walks a brand-new
// user through connecting Jira, GitHub, Confluence, and ServiceNow in plain language.
// On POST /api/setup, validates the submitted credentials, persists them to
// toolbox-proxy.json, and redirects the browser to the main dashboard.
// The entire wizard is self-contained — no CDN or external assets required.

'use strict';

const express  = require('express');
const { saveConfigToDisk, JIRA_URL_PLACEHOLDER_PATTERNS } = require('../config/loader');
const { createDemoModePath, isDemoModeRequest } = require('../utils/demoMode');
const { buildBasicAuthHeader } = require('../utils/httpClient');

// ── Named Constants ───────────────────────────────────────────────────────────

/** Number of service-connection steps shown in the progress indicator */
const WIZARD_TOTAL_SERVICE_STEPS = 5;

/** Step name referenced in data-step attributes and JS navigation */
const STEP_NAMES = ['welcome', 'jira', 'github', 'confluence', 'workspace', 'snow', 'done'];

/** Confluence Database property key that stores the published shared ART payload. */
const SHARED_ART_WORKSPACE_PROPERTY_KEY = 'nodetoolbox-shared-art';
const DEFAULT_SHARED_ART_WORKSPACE_NAME = 'Sales to Enrollment';
const DEFAULT_SHARED_ART_WORKSPACE_DATABASE_ID = '684163133';

/**
 * The organisation's Jira instance URL — pre-filled in the wizard so users
 * only need to paste their PAT without hunting for the URL.
 */
const DEFAULT_JIRA_BASE_URL = 'https://jira.healthspring-jira-prod.aws.zilverton.com';

// ── Router Factory ────────────────────────────────────────────────────────────

/**
 * Creates the Express router for the first-run setup wizard.
 *
 * @param {object} configuration - Live proxy config object (mutated on POST)
 * @returns {import('express').Router}
 */
function createSetupRouter(configuration) {
  const router = express.Router();
  router.get('/setup',     (req, res) => handleGetSetup(req, res, configuration));
  router.post('/api/setup/shared-art-workspace', (req, res) => handlePostSharedArtWorkspace(req, res));
  router.post('/api/setup', (req, res) => handlePostSetup(req, res, configuration));
  return router;
}

// ── Route Handlers ────────────────────────────────────────────────────────────

/**
 * Serves the guided HTML wizard. Sets no-store so the browser always
 * fetches a fresh copy after credentials change.
 */
function handleGetSetup(req, res, configuration) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(buildWizardHtml(configuration, isDemoModeRequest(req)));
}

/**
 * Loads a published Shared ART Workspace during setup without persisting the
 * Confluence credentials until the full wizard is submitted.
 */
async function handlePostSharedArtWorkspace(req, res) {
  const {
    confluenceBaseUrl = '',
    confluenceUsername = '',
    confluenceApiToken = '',
    sharedArtDatabaseId = '',
  } = req.body || {};

  const cleanConfluenceBaseUrl = confluenceBaseUrl.trim().replace(/\/+$/, '');
  const cleanConfluenceUsername = confluenceUsername.trim();
  const cleanConfluenceApiToken = confluenceApiToken.trim();
  const cleanSharedArtDatabaseId = sharedArtDatabaseId.trim();

  if (!cleanConfluenceBaseUrl || !cleanConfluenceUsername || !cleanConfluenceApiToken || !cleanSharedArtDatabaseId) {
    return res.status(400).json({
      error: 'Confluence base URL, Atlassian email, Cloud API token, and Shared ART Database ID are required.',
    });
  }

  try {
    const sharedArtWorkspace = await loadSharedArtWorkspaceFromConfluence({
      baseUrl: cleanConfluenceBaseUrl,
      username: cleanConfluenceUsername,
      apiToken: cleanConfluenceApiToken,
      databaseId: cleanSharedArtDatabaseId,
    });
    res.status(200).json({ workspace: sharedArtWorkspace });
  } catch (workspaceLoadError) {
    const statusCode = Number.isInteger(workspaceLoadError && workspaceLoadError.statusCode)
      ? workspaceLoadError.statusCode
      : 502;
    res.status(statusCode).json({
      error: workspaceLoadError.message || 'Failed to load the shared ART workspace.',
    });
  }
}

/**
 * Accepts submitted credentials, merges them into the live configuration,
 * persists to disk, and redirects to the dashboard.
 * Returns 400 JSON if no service has enough info to be usable.
 */
function handlePostSetup(req, res, configuration) {
  const {
    jiraBaseUrl  = '',
    jiraPat      = '',
    githubPat    = '',
    confluenceBaseUrl = '',
    confluenceUsername = '',
    confluenceApiToken = '',
    snowBaseUrl  = '',
    snowUsername = '',
    snowPassword = '',
  } = req.body || {};

  const cleanJiraBaseUrl  = jiraBaseUrl.trim().replace(/\/+$/, '');
  const cleanJiraPat      = jiraPat.trim();
  const cleanGithubPat    = githubPat.trim();
  const cleanConfluenceBaseUrl = confluenceBaseUrl.trim().replace(/\/+$/, '');
  const cleanConfluenceUsername = confluenceUsername.trim();
  const cleanConfluenceApiToken = confluenceApiToken.trim();
  const cleanSnowBaseUrl  = snowBaseUrl.trim().replace(/\/+$/, '');
  const cleanSnowUsername = snowUsername.trim();
  const cleanSnowPassword = snowPassword.trim();

  const hasJiraConfig   = !!(cleanJiraBaseUrl && cleanJiraPat &&
    !JIRA_URL_PLACEHOLDER_PATTERNS.some((p) => cleanJiraBaseUrl.indexOf(p) >= 0));
  const hasGithubConfig = !!cleanGithubPat;
  const hasConfluenceConfig = !!(cleanConfluenceBaseUrl && cleanConfluenceUsername && cleanConfluenceApiToken);
  const hasSnowConfig   = !!(cleanSnowBaseUrl && cleanSnowUsername && cleanSnowPassword);

  if (!hasJiraConfig && !hasGithubConfig && !hasConfluenceConfig && !hasSnowConfig) {
    return res.status(400).json({
      error: 'Please set up at least one service before continuing.',
    });
  }

  if (isDemoModeRequest(req)) {
    console.log('  🎬 Demo setup completed — real credentials were not changed');
    return res.redirect(302, createDemoModePath('/'));
  }

  if (cleanJiraBaseUrl)  configuration.jira.baseUrl  = cleanJiraBaseUrl;
  if (cleanJiraPat)      configuration.jira.pat       = cleanJiraPat;
  if (cleanGithubPat)    configuration.github.pat     = cleanGithubPat;
  configuration.confluence = configuration.confluence || {};
  if (cleanConfluenceBaseUrl) configuration.confluence.baseUrl = cleanConfluenceBaseUrl;
  if (cleanConfluenceUsername) configuration.confluence.username = cleanConfluenceUsername;
  if (cleanConfluenceApiToken) configuration.confluence.apiToken = cleanConfluenceApiToken;
  if (cleanSnowBaseUrl)  configuration.snow.baseUrl   = cleanSnowBaseUrl;
  if (cleanSnowUsername) configuration.snow.username  = cleanSnowUsername;
  if (cleanSnowPassword) configuration.snow.password  = cleanSnowPassword;

  saveConfigToDisk(configuration);
  console.log('  ✅ Setup wizard completed — credentials saved');
  res.redirect(302, '/');
}

// ── HTML Builder ──────────────────────────────────────────────────────────────

/**
 * Assembles the complete self-contained HTML wizard page.
 * Steps are rendered as hidden divs; JS shows one at a time.
 *
 * @param {object} configuration - Used to pre-fill base URLs already on disk
 * @param {boolean} isDemoMode - True when existing saved URLs should be hidden.
 * @returns {string} Full HTML document
 */
function buildWizardHtml(configuration, isDemoMode) {
  // Replace placeholder URLs with the organisation default so users only need to enter a PAT.
  // This also prevents old installs that still have the template placeholder URL from causing
  // a redirect loop after setup (isServiceConfigured rejects placeholder URLs).
  const visibleConfiguration = isDemoMode ? buildBlankWizardConfiguration(configuration) : configuration;
  const rawJiraBaseUrl      = visibleConfiguration.jira && visibleConfiguration.jira.baseUrl || '';
  const isPlaceholderJiraUrl = JIRA_URL_PLACEHOLDER_PATTERNS.some((p) => rawJiraBaseUrl.indexOf(p) >= 0);
  const prefillJiraBaseUrl  = escapeHtmlAttribute(isPlaceholderJiraUrl || !rawJiraBaseUrl ? DEFAULT_JIRA_BASE_URL : rawJiraBaseUrl);
  const prefillConfluenceBaseUrl = escapeHtmlAttribute(visibleConfiguration.confluence && visibleConfiguration.confluence.baseUrl || '');
  const prefillSharedArtWorkspaceDatabaseId = escapeHtmlAttribute(DEFAULT_SHARED_ART_WORKSPACE_DATABASE_ID);
  const demoModeScript = `window.__NODE_TOOLBOX_DEMO_MODE__ = ${isDemoMode ? 'true' : 'false'};`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NodeToolbox — Setup</title>
  <style>${WIZARD_THEME_CSS}</style>
</head>
<body>
  <div class="wizard-shell">

    <div class="progress-bar" id="progress-bar" aria-hidden="true">
      <div class="progress-dot" id="dot-1" title="Jira"></div>
      <div class="progress-dot" id="dot-2" title="GitHub"></div>
      <div class="progress-dot" id="dot-3" title="Confluence"></div>
      <div class="progress-dot" id="dot-4" title="Shared ART Workspace"></div>
      <div class="progress-dot" id="dot-5" title="ServiceNow"></div>
    </div>

    ${buildStepWelcome()}
    ${buildStepJira(prefillJiraBaseUrl)}
    ${buildStepGithub()}
    ${buildStepConfluence(prefillConfluenceBaseUrl)}
    ${buildStepWorkspace(prefillSharedArtWorkspaceDatabaseId)}
    ${buildStepSnow()}
    ${buildStepDone()}

  </div>
      <script>${demoModeScript}${WIZARD_JS}</script>
</body>
</html>`;
}

// ── Step Builders ─────────────────────────────────────────────────────────────

/** Builds the welcome/intro step HTML — no fields, just context and a start button. */
function buildStepWelcome() {
  return `
    <div id="step-welcome" data-step="welcome" class="wizard-step is-active">
      <div class="step-hero">👋</div>
      <h1 class="step-title">Hey there!</h1>
      <p class="step-subtitle">NodeToolbox is your personal helper that lives quietly on your computer.</p>
      <p class="step-body">It acts like a bridge between your browser and your work tools — Jira, GitHub, Confluence, and ServiceNow.</p>

      <div class="service-preview">
        <div class="service-chip">🎟 Jira</div>
        <div class="service-chip">🐙 GitHub</div>
        <div class="service-chip">📚 Confluence</div>
        <div class="service-chip">☁️ ServiceNow</div>
      </div>

      <p class="step-body">We'll connect them one at a time. Takes about 2 minutes, and you can skip any you don't use.</p>
      <div class="btn-row">
        <button class="btn-primary" onclick="goNext()">Let's get started →</button>
      </div>
    </div>`;
}

/**
 * Builds the Jira connection step. Pre-fills the base URL if already known.
 *
 * @param {string} prefillJiraBaseUrl - HTML-escaped existing Jira URL (may be empty)
 */
function buildStepJira(prefillJiraBaseUrl) {
  return `
    <div id="step-jira" data-step="jira" class="wizard-step">
      <p class="step-counter">Step 1 of ${WIZARD_TOTAL_SERVICE_STEPS}</p>
      <div class="step-hero">🎟</div>
      <h1 class="step-title">Let's connect Jira</h1>
      <p class="step-subtitle">Jira is where your team tracks tasks and tickets.</p>
 
      <label class="field-label" for="jira-base-url">Your Jira address</label>
      <input id="jira-base-url" class="field-input" type="url"
             placeholder="https://your-company.atlassian.net"
             value="${prefillJiraBaseUrl}" autocomplete="off" />
      <p class="field-hint">Open Jira in your browser and copy the address from the top — just up to and including ".net" or ".com"</p>
 
      <label class="field-label" for="jira-pat">Your Jira API token</label>
      <input id="jira-pat" class="field-input" type="password"
             placeholder="Paste your token here"
             autocomplete="new-password" />
      <div class="token-instruction">
        <div class="token-instruction-icon">🔑</div>
        <div class="token-instruction-content">
          <strong>How to get your API token:</strong>
          <ol style="margin-top: 8px; margin-left: 20px; color: var(--text);">
            <li>Click your <strong>profile picture</strong> in Jira (top right)</li>
            <li>Select <strong>Account Settings</strong></li>
            <li>Go to <strong>Security</strong> → <strong>API tokens</strong></li>
            <li>Click <strong>Create new token</strong> and give it a name like "NodeToolbox"</li>
            <li>Copy the token and paste it here</li>
          </ol>
        </div>
      </div>
 
      <div class="btn-row btn-row--spread">
        <button class="btn-ghost" onclick="goBack()">← Back</button>
        <div class="btn-group">
          <button class="btn-secondary" onclick="skipCurrentStep()">Skip Jira for now</button>
          <button class="btn-primary" onclick="goNext()">Next →</button>
        </div>
      </div>
    </div>`;
}

/** Builds the GitHub connection step (optional service). */
function buildStepGithub() {
  return `
    <div id="step-github" data-step="github" class="wizard-step">
      <p class="step-counter">Step 2 of ${WIZARD_TOTAL_SERVICE_STEPS}</p>
      <div class="step-hero">🐙</div>
      <h1 class="step-title">Connect GitHub</h1>
      <p class="step-subtitle">GitHub is where your team's code lives. <strong>This step is completely optional</strong> — skip it if you don't use GitHub with this tool.</p>
 
      <label class="field-label" for="github-pat">Your GitHub access token</label>
      <input id="github-pat" class="field-input" type="password"
             placeholder="ghp_your_token_here"
             autocomplete="new-password" />
      <div class="token-instruction">
        <div class="token-instruction-icon">🔑</div>
        <div class="token-instruction-content">
          <strong>How to get your access token:</strong>
          <ol style="margin-top: 8px; margin-left: 20px; color: var(--text);">
            <li>Click your <strong>profile picture</strong> in GitHub (top right)</li>
            <li>Select <strong>Settings</strong></li>
            <li>Go to <strong>Developer settings</strong> → <strong>Personal access tokens</strong></li>
            <li>Click <strong>Generate new token</strong> and select the scopes you need</li>
            <li>Copy the token (starts with "ghp_") and paste it here</li>
          </ol>
        </div>
      </div>
 
      <div class="btn-row btn-row--spread">
        <button class="btn-ghost" onclick="goBack()">← Back</button>
        <div class="btn-group">
          <button class="btn-secondary" onclick="skipCurrentStep()">Skip GitHub</button>
          <button class="btn-primary" onclick="goNext()">Next →</button>
        </div>
      </div>
    </div>`;
}

/**
 * Builds the Confluence connection step used by shared ART and PI Review features.
 *
 * @param {string} prefillConfluenceBaseUrl - HTML-escaped existing Confluence URL (may be empty)
 */
function buildStepConfluence(prefillConfluenceBaseUrl) {
  return `
    <div id="step-confluence" data-step="confluence" class="wizard-step">
      <p class="step-counter">Step 3 of ${WIZARD_TOTAL_SERVICE_STEPS}</p>
      <div class="step-hero">📚</div>
      <h1 class="step-title">Connect Confluence</h1>
      <p class="step-subtitle">Confluence powers shared ART setup, PI Review pages, and collaboration spaces. <strong>This step is optional</strong> if you only want local tools.</p>
 
      <label class="field-label" for="confluence-base-url">Confluence address</label>
      <input id="confluence-base-url" class="field-input" type="url"
             placeholder="https://your-company.atlassian.net"
             value="${prefillConfluenceBaseUrl}" autocomplete="off" />
 
      <label class="field-label" for="confluence-username">Your Atlassian email</label>
      <input id="confluence-username" class="field-input" type="email"
             placeholder="your.name@company.com" autocomplete="off" />
 
      <label class="field-label" for="confluence-api-token">Your Atlassian API token</label>
      <input id="confluence-api-token" class="field-input" type="password"
             placeholder="Paste your Cloud API token here"
             autocomplete="new-password" />
      <div class="token-instruction">
        <div class="token-instruction-icon">🔐</div>
        <div class="token-instruction-content">
          <strong>Important: Get a Cloud API token from Atlassian</strong>
          <p style="margin-top: 8px;">Go to <strong>id.atlassian.com → Security → API tokens</strong> and create a new token. <strong>Jira on-prem PATs will not work</strong> — you must use a Cloud API token from your Atlassian account page.</p>
        </div>
      </div>
 
      <div class="btn-row btn-row--spread">
        <button class="btn-ghost" onclick="goBack()">← Back</button>
        <div class="btn-group">
          <button class="btn-secondary" onclick="skipCurrentStep()">Skip Confluence</button>
          <button class="btn-primary" onclick="goNext()">Next →</button>
        </div>
      </div>
    </div>`;
}

/** Builds the shared ART workspace preload step for teams that publish from Confluence. */
function buildStepWorkspace(prefillSharedArtWorkspaceDatabaseId) {
  return `
    <div id="step-workspace" data-step="workspace" class="wizard-step">
      <p class="step-counter">Step 4 of ${WIZARD_TOTAL_SERVICE_STEPS}</p>
      <div class="step-hero">🧭</div>
      <h1 class="step-title">Load Shared ART Workspace</h1>
      <p class="step-subtitle">If your team already published an ART workspace in Confluence, load it now so ART View, Sprint Dashboard, and Reports Hub are ready on first launch.</p>

      <label class="field-label" for="shared-art-database-id">Shared ART Database ID</label>
      <input id="shared-art-database-id" class="field-input" type="text"
             placeholder="Paste the Confluence database ID"
             value="${prefillSharedArtWorkspaceDatabaseId}"
             autocomplete="off" />
      <p class="field-hint">This currently defaults to <strong>${DEFAULT_SHARED_ART_WORKSPACE_NAME}</strong> (${DEFAULT_SHARED_ART_WORKSPACE_DATABASE_ID}). If you do not want to preload that ART yet, you can still skip this step for now.</p>

      <div class="token-instruction">
        <div class="token-instruction-icon">📦</div>
        <div class="token-instruction-content">
          <strong>What happens when you load it:</strong>
          <p style="margin-top: 8px;">NodeToolbox will pull the published workspace from Confluence and preload your ART teams, advanced settings, and shared-workspace sync snapshot into this browser before you enter the app.</p>
        </div>
      </div>

      <div class="btn-row">
        <button id="load-shared-art-workspace-btn" class="btn-secondary" onclick="loadSharedArtWorkspace()">Load Workspace from Confluence</button>
      </div>

      <div id="shared-art-workspace-status" class="status-panel" style="display:none;"></div>

      <div class="btn-row btn-row--spread">
        <button class="btn-ghost" onclick="goBack()">← Back</button>
        <div class="btn-group">
          <button class="btn-secondary" onclick="skipCurrentStep()">Skip workspace</button>
          <button class="btn-primary" onclick="goNext()">Next →</button>
        </div>
      </div>
    </div>`;
}

/**
 * Builds the ServiceNow setup guidance step.
 * This step is intentionally relay-only so the user learns the post-setup flow
 * without being asked for URL, username, or password fields in the wizard.
 */
function buildStepSnow() {
  return `
    <div id="step-snow" data-step="snow" class="wizard-step">
      <p class="step-counter">Step 5 of ${WIZARD_TOTAL_SERVICE_STEPS}</p>
      <div class="step-hero">☁️</div>
      <h1 class="step-title">Connect ServiceNow</h1>
      <p class="step-subtitle">ServiceNow is where IT tickets and service requests live. <strong>Also optional</strong> — this step shows the relay flow you will use after the wizard.</p>

      <div class="token-instruction">
        <div class="token-instruction-icon">🔗</div>
        <div class="token-instruction-content">
          <strong>Important: SNow Hub uses a browser-based relay, not wizard fields</strong>
          <p style="margin-top: 8px;">After setup, click the <strong>SNow</strong> button in the Toolbox connection bar. That flow opens the relay instructions, helps you add the <strong>NodeToolbox SNow Relay</strong> bookmarklet, and connects Toolbox through your active ServiceNow browser session.</p>
        </div>
      </div>

      <p class="field-hint">This is the relay screen you will see after setup when you open the SNow connection flow:</p>

      <div class="relay-preview-card" aria-label="ServiceNow relay setup preview" role="img">
        <div class="relay-preview-title">✕ ServiceNow not reachable</div>
        <p class="relay-preview-method">Method: Not connected — relay bridge inactive</p>
        <p class="relay-preview-label">To activate the relay bridge:</p>
        <ol class="relay-preview-list">
          <li>Click <strong>Open ServiceNow</strong> below, or navigate to any SNow page while logged in</li>
          <li>Click <strong>NodeToolbox SNow Relay</strong> in your bookmarks bar</li>
          <li>The relay will activate and return focus to this tab automatically</li>
        </ol>
        <div class="relay-preview-actions">
          <span class="relay-preview-button">🔗 Open ServiceNow</span>
          <span class="relay-preview-button relay-preview-button--bookmark">🚀 Drag to bookmarks: NodeToolbox SNow Relay</span>
        </div>
        <p class="relay-preview-warning">⚠ Do not click the bookmarklet here. Drag it to the bookmarks bar, then click it from the ServiceNow tab.</p>
      </div>

      <div class="btn-row btn-row--spread">
        <button class="btn-ghost" onclick="goBack()">← Back</button>
        <div class="btn-group">
          <button class="btn-secondary" onclick="skipCurrentStep()">Skip ServiceNow</button>
          <button class="btn-primary" onclick="goNext()">Almost done! →</button>
        </div>
      </div>
    </div>`;
}

/** Builds the final confirmation step with the submit button. */
function buildStepDone() {
  return `
    <div id="step-done" data-step="done" class="wizard-step">
      <div class="step-hero">🎉</div>
      <h1 class="step-title">You're all set!</h1>
      <p class="step-subtitle">Your connections are saved. Click the button below to open your Toolbox.</p>

      <div id="done-summary" class="done-summary"></div>
      <div id="done-error" class="error-banner" style="display:none;"></div>

      <div class="btn-row">
        <button class="btn-ghost done-back-btn" onclick="goBack()">← Go back</button>
        <button id="submit-btn" class="btn-primary btn-large" onclick="submitSetup()">Open my Toolbox →</button>
      </div>
    </div>`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

/** All CSS for the wizard — self-contained, dark theme, no external dependencies */
const WIZARD_THEME_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:           #0d1117;
    --surface:      #161b22;
    --surface2:     #21262d;
    --border:       #30363d;
    --text:         #e6edf3;
    --text-muted:   #7d8590;
    --accent:       #2f81f7;
    --accent-h:     #388bfd;
    --success:      #3fb950;
    --danger:       #f85149;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg); color: var(--text);
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: flex-start;
    padding: 32px 20px 60px;
  }
  .wizard-shell {
    width: 100%; max-width: 520px;
  }
  /* Progress dots */
  .progress-bar {
    display: flex; justify-content: center; gap: 12px; margin-bottom: 32px;
    min-height: 18px;
  }
  .progress-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--border); transition: background .25s, transform .15s;
  }
  .progress-dot.is-current  { background: var(--accent); transform: scale(1.3); }
  .progress-dot.is-complete { background: var(--success); }
  /* Wizard steps */
  .wizard-step { display: none; animation: fadeIn .2s ease; }
  .wizard-step.is-active { display: block; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  /* Step content */
  .step-hero     { font-size: 52px; text-align: center; margin-bottom: 16px; line-height: 1; }
  .step-counter  { text-align: center; color: var(--text-muted); font-size: 12px;
                   text-transform: uppercase; letter-spacing: .06em; margin-bottom: 12px; }
  .step-title    { font-size: 28px; font-weight: 700; text-align: center; margin-bottom: 10px; }
  .step-subtitle { font-size: 15px; text-align: center; color: var(--text-muted);
                   line-height: 1.6; margin-bottom: 20px; }
  .step-body     { font-size: 14px; color: var(--text-muted); line-height: 1.6;
                   text-align: center; margin-bottom: 16px; }
  /* Service chips on welcome step */
  .service-preview { display: flex; justify-content: center; gap: 10px;
                     flex-wrap: wrap; margin: 20px 0; }
  .service-chip { background: var(--surface); border: 1px solid var(--border);
                  border-radius: 20px; padding: 6px 14px; font-size: 14px; }
  /* Form fields */
  .field-label { display: block; font-size: 13px; font-weight: 600;
                 color: var(--text); margin: 20px 0 6px; }
  .field-input {
    width: 100%; padding: 10px 13px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 14px;
    outline: none; transition: border-color .15s;
  }
  .field-input:focus { border-color: var(--accent); }
  .field-hint { font-size: 12px; color: var(--text-muted); margin-top: 7px;
                line-height: 1.55; }
  /* Token instruction callout — stands out visually to ensure users read it */
  .token-instruction { background: var(--surface2); border: 2px solid var(--accent);
                      border-radius: 8px; padding: 14px 16px; margin-top: 10px;
                      font-size: 13px; line-height: 1.6; color: var(--text);
                      display: flex; gap: 12px; align-items: flex-start; }
  .token-instruction-icon { font-size: 18px; flex-shrink: 0; line-height: 1.4; }
  .token-instruction-content { flex: 1; }
  .relay-preview-card {
    margin-top: 16px; padding: 18px 18px 14px;
    background: linear-gradient(180deg, #0f1724 0%, #101826 100%);
    border: 1px solid #2c3a55; border-radius: 12px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
  }
  .relay-preview-title {
    color: #f3f4f6; font-size: 22px; font-weight: 700;
    margin-bottom: 10px;
  }
  .relay-preview-method {
    color: #aeb7c6; font-size: 14px; margin-bottom: 16px;
  }
  .relay-preview-label {
    color: #dce3ee; font-size: 14px; font-weight: 600; margin-bottom: 10px;
  }
  .relay-preview-list {
    margin: 0 0 16px 20px; color: #e6edf3; line-height: 1.7; font-size: 14px;
  }
  .relay-preview-list li + li { margin-top: 6px; }
  .relay-preview-actions {
    display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;
  }
  .relay-preview-button {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 10px 14px; min-height: 40px;
    border-radius: 8px; border: 1px solid #405173;
    background: #162238; color: #dbe7ff; font-size: 13px; font-weight: 600;
  }
  .relay-preview-button--bookmark {
    background: #233557; border-color: #4667a4;
  }
  .relay-preview-warning {
    color: #c9b36a; font-size: 12px; line-height: 1.5;
  }
  /* Buttons */
  .btn-row { display: flex; justify-content: center; margin-top: 32px; gap: 10px; flex-wrap: wrap; }
  .btn-row--spread { justify-content: space-between; }
  .btn-group { display: flex; gap: 10px; }
  .btn-primary {
    padding: 11px 28px; background: var(--accent); color: #fff;
    border: none; border-radius: 8px; font-size: 15px; font-weight: 600;
    cursor: pointer; transition: background .15s;
  }
  .btn-primary:hover:not(:disabled) { background: var(--accent-h); }
  .btn-primary:disabled { opacity: .6; cursor: default; }
  .btn-large { padding: 14px 36px; font-size: 16px; }
  .btn-secondary {
    padding: 11px 20px; background: var(--surface2);
    color: var(--text-muted); border: 1px solid var(--border);
    border-radius: 8px; font-size: 14px; cursor: pointer; transition: color .15s;
  }
  .btn-secondary:hover { color: var(--text); }
  .btn-ghost {
    padding: 11px 16px; background: transparent; color: var(--text-muted);
    border: none; font-size: 14px; cursor: pointer;
  }
  .btn-ghost:hover { color: var(--text); }
  /* Done step */
  .done-summary { background: var(--surface); border: 1px solid var(--border);
                  border-radius: 10px; padding: 16px 20px; margin-top: 20px;
                  font-size: 14px; line-height: 1.8; }
  .done-summary:empty { display: none; }
  .done-back-btn { align-self: center; }
  /* Async workspace load status */
  .status-panel {
    margin-top: 18px; padding: 14px 16px;
    border-radius: 10px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); font-size: 13px; line-height: 1.65;
  }
  .status-panel--success {
    border-color: rgba(63,185,80,.65);
    background: rgba(63,185,80,.09);
  }
  .status-panel--error {
    border-color: rgba(248,81,73,.7);
    background: rgba(248,81,73,.09);
  }
  .status-panel strong { color: var(--text); }
  /* Error */
  .error-banner {
    margin-top: 16px; padding: 12px 16px;
    background: rgba(248,81,73,.1); border: 1px solid var(--danger);
    color: var(--danger); border-radius: 8px; font-size: 13px; text-align: center;
  }
`;

// ── Client-Side JavaScript ────────────────────────────────────────────────────

/** All client-side wizard JS — self-contained, no framework dependencies */
const WIZARD_JS = `
  /* All wizard state lives here */
  var STEP_NAMES = ${JSON.stringify(STEP_NAMES)};
  var IS_DEMO_MODE = window.__NODE_TOOLBOX_DEMO_MODE__ === true;

  /* Accumulated credentials collected step-by-step */
  var wizardData = {
    jiraBaseUrl: '', jiraPat: '',
    githubPat: '',
    confluenceBaseUrl: '', confluenceUsername: '', confluenceApiToken: '',
    sharedArtDatabaseId: '', sharedArtWorkspace: null,
  };

  var currentStepIndex = 0;

  function showStep(stepIndex) {
    document.querySelectorAll('.wizard-step').forEach(function(stepElement) {
      stepElement.classList.remove('is-active');
    });
    var targetStep = document.getElementById('step-' + STEP_NAMES[stepIndex]);
    if (targetStep) targetStep.classList.add('is-active');
    updateProgressDots(stepIndex);
    if (STEP_NAMES[stepIndex] === 'done') populateDoneSummary();
    window.scrollTo(0, 0);
  }

  function updateProgressDots(stepIndex) {
    /* Dots map to service steps: Jira, GitHub, Confluence, Shared ART, and ServiceNow. */
    for (var dotNumber = 1; dotNumber <= ${WIZARD_TOTAL_SERVICE_STEPS}; dotNumber++) {
      var dotElement = document.getElementById('dot-' + dotNumber);
      if (!dotElement) continue;
      dotElement.classList.remove('is-current', 'is-complete');
      if (stepIndex > dotNumber)      dotElement.classList.add('is-complete');
      else if (stepIndex === dotNumber) dotElement.classList.add('is-current');
    }
  }

  function collectCurrentStepData() {
    var stepName = STEP_NAMES[currentStepIndex];
    if (stepName === 'jira') {
      wizardData.jiraBaseUrl = (getValue('jira-base-url') || '').replace(/\\/+$/, '');
      wizardData.jiraPat     = getValue('jira-pat');
    } else if (stepName === 'github') {
      wizardData.githubPat = getValue('github-pat');
    } else if (stepName === 'confluence') {
      wizardData.confluenceBaseUrl  = (getValue('confluence-base-url') || '').replace(/\\/+$/, '');
      wizardData.confluenceUsername = getValue('confluence-username');
      wizardData.confluenceApiToken = getValue('confluence-api-token');
    } else if (stepName === 'workspace') {
      wizardData.sharedArtDatabaseId = getValue('shared-art-database-id');
    }
  }

  function getValue(fieldId) {
    var fieldElement = document.getElementById(fieldId);
    return fieldElement ? fieldElement.value.trim() : '';
  }

  function goNext() {
    collectCurrentStepData();
    if (currentStepIndex < STEP_NAMES.length - 1) {
      currentStepIndex++;
      showStep(currentStepIndex);
    }
  }

  function goBack() {
    if (currentStepIndex > 0) {
      currentStepIndex--;
      showStep(currentStepIndex);
    }
  }

  function skipCurrentStep() {
    /* Clear any partial data for the skipped service */
    var stepName = STEP_NAMES[currentStepIndex];
    if (stepName === 'jira')   { wizardData.jiraBaseUrl = ''; wizardData.jiraPat = ''; }
    if (stepName === 'github') { wizardData.githubPat = ''; }
    if (stepName === 'confluence') { wizardData.confluenceBaseUrl = ''; wizardData.confluenceUsername = ''; wizardData.confluenceApiToken = ''; }
    if (stepName === 'workspace') { wizardData.sharedArtDatabaseId = ''; wizardData.sharedArtWorkspace = null; }
    if (currentStepIndex < STEP_NAMES.length - 1) {
      currentStepIndex++;
      showStep(currentStepIndex);
    }
  }

  function populateDoneSummary() {
    var summaryElement = document.getElementById('done-summary');
    if (!summaryElement) return;
    var connectedServices = [];
    if (wizardData.jiraPat)      connectedServices.push('🎟 Jira connected');
    if (wizardData.githubPat)    connectedServices.push('🐙 GitHub connected');
    if (wizardData.confluenceApiToken) connectedServices.push('📚 Confluence connected');
    if (wizardData.sharedArtWorkspace) {
      connectedServices.push('🧭 Shared ART loaded: ' + wizardData.sharedArtWorkspace.artName + ' (' + wizardData.sharedArtWorkspace.teamCount + ' teams)');
    }
    if (connectedServices.length === 0) {
      summaryElement.innerHTML = '⚠️ No services were connected yet. Go back and fill in at least one.';
    } else {
      summaryElement.innerHTML = connectedServices.join('<br>');
    }
  }

  function readStoredJson(storageKey, fallbackValue) {
    try {
      var rawValue = localStorage.getItem(storageKey);
      return rawValue ? JSON.parse(rawValue) : fallbackValue;
    } catch (_storageParseError) {
      return fallbackValue;
    }
  }

  function persistLoadedSharedArtWorkspace(workspace, databaseId) {
    var nextArtName = String(workspace.artName || workspace.artKey || 'Shared ART Workspace').trim();
    var nextArtKey = String(workspace.artKey || '').trim();
    var nextTeams = Array.isArray(workspace.teams) ? workspace.teams : [];
    var nextSettings = Object.assign(
      {},
      readStoredJson('tbxARTSettings', {}),
      workspace.settings || {},
      {
        sharedArtName: nextArtName,
        sharedArtKey: nextArtKey,
        sharedArtDatabaseId: databaseId,
      }
    );
    localStorage.setItem('tbxARTSettings', JSON.stringify(nextSettings));
    localStorage.setItem('nodetoolbox-art-teams', JSON.stringify(nextTeams));

    var storedSnapshots = readStoredJson('tbxSharedArtSyncSnapshots', {});
    storedSnapshots[databaseId] = workspace;
    localStorage.setItem('tbxSharedArtSyncSnapshots', JSON.stringify(storedSnapshots));

    var recentWorkspaces = readStoredJson('tbxSharedArtRecentWorkspaces', []);
    if (!Array.isArray(recentWorkspaces)) recentWorkspaces = [];
    var nextRecentWorkspaces = [{
      artName: nextArtName,
      artKey: nextArtKey,
      databaseId: databaseId,
    }].concat(recentWorkspaces.filter(function(workspaceEntry) {
      return workspaceEntry && workspaceEntry.databaseId !== databaseId;
    })).slice(0, 10);
    localStorage.setItem('tbxSharedArtRecentWorkspaces', JSON.stringify(nextRecentWorkspaces));
  }

  function renderSharedArtWorkspaceStatus(statusType, messageHtml) {
    var statusElement = document.getElementById('shared-art-workspace-status');
    if (!statusElement) return;
    statusElement.className = 'status-panel status-panel--' + statusType;
    statusElement.innerHTML = messageHtml;
    statusElement.style.display = 'block';
  }

  async function loadSharedArtWorkspace() {
    collectCurrentStepData();
    var loadButton = document.getElementById('load-shared-art-workspace-btn');
    if (!wizardData.confluenceBaseUrl || !wizardData.confluenceUsername || !wizardData.confluenceApiToken) {
      renderSharedArtWorkspaceStatus('error', 'Connect Confluence on the previous step first so the workspace can be loaded with your Atlassian credentials.');
      return;
    }
    if (!wizardData.sharedArtDatabaseId) {
      renderSharedArtWorkspaceStatus('error', 'Shared ART Database ID is required before loading the workspace.');
      return;
    }

    loadButton.disabled = true;
    loadButton.textContent = 'Loading…';
    renderSharedArtWorkspaceStatus('success', 'Loading shared ART workspace from Confluence…');

    try {
      var response = await fetch('/api/setup/shared-art-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confluenceBaseUrl: wizardData.confluenceBaseUrl,
          confluenceUsername: wizardData.confluenceUsername,
          confluenceApiToken: wizardData.confluenceApiToken,
          sharedArtDatabaseId: wizardData.sharedArtDatabaseId,
        }),
      });
      var responseData = await response.json().catch(function() { return {}; });
      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to load the shared ART workspace.');
      }

      persistLoadedSharedArtWorkspace(responseData.workspace, wizardData.sharedArtDatabaseId);
      wizardData.sharedArtWorkspace = {
        artName: String(responseData.workspace.artName || responseData.workspace.artKey || 'Shared ART Workspace').trim(),
        artKey: String(responseData.workspace.artKey || '').trim(),
        teamCount: Array.isArray(responseData.workspace.teams) ? responseData.workspace.teams.length : 0,
      };
      renderSharedArtWorkspaceStatus(
        'success',
        '<strong>Loaded shared ART workspace.</strong><br>' +
          wizardData.sharedArtWorkspace.artName + ' • ' +
          wizardData.sharedArtWorkspace.teamCount + ' team(s) preloaded for this browser.'
      );
    } catch (workspaceLoadError) {
      renderSharedArtWorkspaceStatus(
        'error',
        workspaceLoadError.message || 'Failed to load the shared ART workspace.'
      );
    } finally {
      loadButton.disabled = false;
      loadButton.textContent = 'Load Workspace from Confluence';
    }
  }

  async function submitSetup() {
    var submitButton = document.getElementById('submit-btn');
    var errorBanner  = document.getElementById('done-error');
    errorBanner.style.display = 'none';

    var hasAnyCredential = wizardData.jiraPat || wizardData.githubPat || wizardData.confluenceApiToken;
    if (!hasAnyCredential) {
      errorBanner.textContent = 'Oops! Please go back and fill in at least one service.';
      errorBanner.style.display = 'block';
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';

    try {
      var setupEndpoint = IS_DEMO_MODE ? '/api/setup?demo=1' : '/api/setup';
      var dashboardUrl = IS_DEMO_MODE ? '/?demo=1' : '/';
      var response = await fetch(setupEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wizardData),
      });
      if (response.ok || response.redirected) { window.location.href = dashboardUrl; return; }
      var errorData = await response.json().catch(function() { return { error: 'Unknown error' }; });
      errorBanner.textContent = errorData.error || 'Something went wrong — please try again.';
      errorBanner.style.display = 'block';
    } catch (networkError) {
      errorBanner.textContent = 'Could not reach the proxy server: ' + networkError.message;
      errorBanner.style.display = 'block';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Open my Toolbox →';
    }
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Produces the blank server-backed configuration shown inside the demo wizard.
 *
 * Demo mode must feel like a first install even when the real server already has
 * saved enterprise credentials, so only safe non-credential defaults are retained.
 *
 * @param {object} configuration - Live configuration, used only for safe defaults.
 * @returns {object}
 */
function buildBlankWizardConfiguration(configuration) {
  return {
    jira: { baseUrl: '' },
    github: { baseUrl: configuration.github && configuration.github.baseUrl || '' },
    confluence: { baseUrl: '' },
    snow: { baseUrl: '' },
  };
}

/**
 * Escapes a string for safe use as an HTML attribute value.
 * Prevents config values from being interpreted as HTML or breaking attribute syntax.
 *
 * @param {string} value - Raw string to escape
 * @returns {string} HTML-attribute-safe string
 */
function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Creates a structured error object so setup routes can return appropriate status codes. */
function createSetupRouteError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/** Builds the Basic Auth header used for setup-time Confluence workspace loading. */
function buildSetupConfluenceHeaders(username, apiToken) {
  const authorizationHeader = buildBasicAuthHeader(username, apiToken);
  return {
    'Accept': 'application/json',
    'Authorization': authorizationHeader,
  };
}

/** Reads and validates a JSON response from the Confluence v2 API. */
async function fetchSetupConfluenceJson(baseUrl, headers, apiPath, defaultErrorMessage) {
  const response = await fetch(baseUrl + apiPath, {
    method: 'GET',
    headers,
  });

  let responseBody = {};
  try {
    responseBody = await response.json();
  } catch (_responseParseError) {
    responseBody = {};
  }

  if (!response.ok) {
    const responseMessage = responseBody.message || responseBody.reason || defaultErrorMessage || `HTTP ${response.status}`;
    throw createSetupRouteError(response.status, responseMessage);
  }

  return responseBody;
}

/** Loads the published Shared ART Workspace payload from a Confluence Database. */
async function loadSharedArtWorkspaceFromConfluence(confluenceConfiguration) {
  const headers = buildSetupConfluenceHeaders(confluenceConfiguration.username, confluenceConfiguration.apiToken);
  const encodedDatabaseId = encodeURIComponent(confluenceConfiguration.databaseId);
  const propertyList = await fetchSetupConfluenceJson(
    confluenceConfiguration.baseUrl,
    headers,
    `/wiki/api/v2/databases/${encodedDatabaseId}/properties?key=${encodeURIComponent(SHARED_ART_WORKSPACE_PROPERTY_KEY)}`,
    `Failed to inspect Confluence Database ${confluenceConfiguration.databaseId}.`,
  );
  const matchingProperty = Array.isArray(propertyList.results)
    ? propertyList.results.find((property) => property && property.key === SHARED_ART_WORKSPACE_PROPERTY_KEY)
    : null;

  if (!matchingProperty || !matchingProperty.id) {
    throw createSetupRouteError(
      404,
      `Database ${confluenceConfiguration.databaseId} does not contain a NodeToolbox shared ART workspace yet. Ask a teammate to publish it from Art View first.`,
    );
  }

  const propertyRecord = await fetchSetupConfluenceJson(
    confluenceConfiguration.baseUrl,
    headers,
    `/wiki/api/v2/databases/${encodedDatabaseId}/properties/${encodeURIComponent(String(matchingProperty.id))}`,
    `Failed to load the shared ART workspace from database ${confluenceConfiguration.databaseId}.`,
  );
  const workspaceValue = propertyRecord && propertyRecord.value;
  if (!workspaceValue || typeof workspaceValue !== 'object') {
    throw createSetupRouteError(
      502,
      `Database ${confluenceConfiguration.databaseId} returned an invalid NodeToolbox shared ART workspace payload.`,
    );
  }

  return workspaceValue;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createSetupRouter;
