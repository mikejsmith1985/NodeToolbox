// src/routes/setup.js — First-run guided credential setup wizard.
//
// Serves a friendly step-by-step HTML wizard on GET /setup that walks a brand-new
// user through connecting Jira, GitHub, and ServiceNow in plain, jargon-free language.
// On POST /api/setup, validates the submitted credentials, persists them to
// toolbox-proxy.json, and redirects the browser to the main dashboard.
// The entire wizard is self-contained — no CDN or external assets required.

'use strict';

const express  = require('express');
const { saveConfigToDisk } = require('../config/loader');

// ── Named Constants ───────────────────────────────────────────────────────────

/** Number of service-connection steps shown in the progress indicator */
const WIZARD_TOTAL_SERVICE_STEPS = 3;

/** Step name referenced in data-step attributes and JS navigation */
const STEP_NAMES = ['welcome', 'jira', 'github', 'snow', 'done'];

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
  res.status(200).end(buildWizardHtml(configuration));
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

  const hasJiraConfig   = !!(cleanJiraBaseUrl && cleanJiraPat);
  const hasGithubConfig = !!cleanGithubPat;
  const hasSnowConfig   = !!(cleanSnowBaseUrl && cleanSnowUsername && cleanSnowPassword);

  if (!hasJiraConfig && !hasGithubConfig && !hasSnowConfig) {
    return res.status(400).json({
      error: 'Please set up at least one service before continuing.',
    });
  }

  if (cleanJiraBaseUrl)  configuration.jira.baseUrl  = cleanJiraBaseUrl;
  if (cleanJiraPat)      configuration.jira.pat       = cleanJiraPat;
  if (cleanGithubPat)    configuration.github.pat     = cleanGithubPat;
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
 * @returns {string} Full HTML document
 */
function buildWizardHtml(configuration) {
  const prefillJiraBaseUrl = escapeHtmlAttribute(configuration.jira && configuration.jira.baseUrl || '');
  const prefillSnowBaseUrl = escapeHtmlAttribute(configuration.snow && configuration.snow.baseUrl || '');

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
      <div class="progress-dot" id="dot-3" title="ServiceNow"></div>
    </div>

    ${buildStepWelcome()}
    ${buildStepJira(prefillJiraBaseUrl)}
    ${buildStepGithub()}
    ${buildStepSnow(prefillSnowBaseUrl)}
    ${buildStepDone()}

  </div>
  <script>${WIZARD_JS}</script>
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
      <p class="step-body">It acts like a bridge between your browser and your work tools — Jira, GitHub, and ServiceNow.</p>

      <div class="service-preview">
        <div class="service-chip">🎟 Jira</div>
        <div class="service-chip">🐙 GitHub</div>
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
      <p class="field-hint">In Jira: click your profile picture → Account Settings → Security → API tokens → Create new token. Then copy and paste it here.</p>

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
      <p class="field-hint">In GitHub: click your profile picture → Settings → Developer settings → Personal access tokens → Generate new token. It should start with "ghp_".</p>

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
 * Builds the ServiceNow connection step (optional service).
 * Pre-fills the base URL if already known.
 *
 * @param {string} prefillSnowBaseUrl - HTML-escaped existing SNow URL (may be empty)
 */
function buildStepSnow(prefillSnowBaseUrl) {
  return `
    <div id="step-snow" data-step="snow" class="wizard-step">
      <p class="step-counter">Step 3 of ${WIZARD_TOTAL_SERVICE_STEPS}</p>
      <div class="step-hero">☁️</div>
      <h1 class="step-title">Connect ServiceNow</h1>
      <p class="step-subtitle">ServiceNow is where IT tickets and service requests live. <strong>Also optional</strong> — skip it if you don't need it.</p>

      <label class="field-label" for="snow-base-url">ServiceNow address</label>
      <input id="snow-base-url" class="field-input" type="url"
             placeholder="https://your-instance.service-now.com"
             value="${prefillSnowBaseUrl}" autocomplete="off" />

      <label class="field-label" for="snow-username">Your username</label>
      <input id="snow-username" class="field-input" type="text"
             placeholder="your.name@company.com" autocomplete="off" />

      <label class="field-label" for="snow-password">Your password</label>
      <input id="snow-password" class="field-input" type="password"
             placeholder="Your service account password"
             autocomplete="new-password" />
      <p class="field-hint">All three fields are needed to connect to ServiceNow. Leave them blank to skip.</p>

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

  /* Accumulated credentials collected step-by-step */
  var wizardData = {
    jiraBaseUrl: '', jiraPat: '',
    githubPat: '',
    snowBaseUrl: '', snowUsername: '', snowPassword: '',
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
    /* Dots map to service steps: dot-1=jira(1), dot-2=github(2), dot-3=snow(3) */
    for (var dotNumber = 1; dotNumber <= 3; dotNumber++) {
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
    } else if (stepName === 'snow') {
      wizardData.snowBaseUrl  = (getValue('snow-base-url') || '').replace(/\\/+$/, '');
      wizardData.snowUsername = getValue('snow-username');
      wizardData.snowPassword = getValue('snow-password');
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
    if (stepName === 'snow')   { wizardData.snowBaseUrl = ''; wizardData.snowUsername = ''; wizardData.snowPassword = ''; }
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
    if (wizardData.snowPassword) connectedServices.push('☁️ ServiceNow connected');
    if (connectedServices.length === 0) {
      summaryElement.innerHTML = '⚠️ No services were connected yet. Go back and fill in at least one.';
    } else {
      summaryElement.innerHTML = connectedServices.join('<br>');
    }
  }

  async function submitSetup() {
    var submitButton = document.getElementById('submit-btn');
    var errorBanner  = document.getElementById('done-error');
    errorBanner.style.display = 'none';

    var hasAnyCredential = wizardData.jiraPat || wizardData.githubPat || wizardData.snowPassword;
    if (!hasAnyCredential) {
      errorBanner.textContent = 'Oops! Please go back and fill in at least one service.';
      errorBanner.style.display = 'block';
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';

    try {
      var response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wizardData),
      });
      if (response.ok || response.redirected) { window.location.href = '/'; return; }
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createSetupRouter;
