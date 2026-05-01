// server.js — NodeToolbox Express entry point.
//
// Wires together all middleware, route modules, and background services.
// Starts the proxy server on the configured port (default: 5555) and prints
// a startup banner so users know where to open the dashboard.

'use strict';

const path    = require('path');
const express = require('express');

const { loadConfig, createConfigTemplate, isServiceConfigured } = require('./src/config/loader');
const { applyCorsHeaders }                  = require('./src/middleware/cors');
const createProxyRouter                     = require('./src/routes/proxy');
const createApiRouter                       = require('./src/routes/api');
const createSchedulerRouter                 = require('./src/routes/scheduler');
const createSetupRouter                     = require('./src/routes/setup');
const { serveStaticFile }                   = require('./src/utils/staticFileServer');
const { startSchedulerLoop }                = require('./src/services/repoMonitor');

// ── Constants ────────────────────────────────────────────────────────────────

/** Default TCP port for the proxy server — matches the original ToolBox server for bookmark compatibility */
const DEFAULT_PORT = 5555;

/** Version string shown in the startup banner and /api/proxy-status response */
const APP_VERSION = '1.0.0';

// ── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Ensures the configuration file exists on first run.
 * Creates a blank template if toolbox-proxy.json is absent so the server
 * starts cleanly and redirects the user to the setup wizard.
 */
createConfigTemplate();

/** Live configuration loaded from toolbox-proxy.json + environment variables */
const configuration = loadConfig();

// ── Express Application ───────────────────────────────────────────────────────

const app = express();

// Parse JSON request bodies — required for POST /api/proxy-config and /api/snow-session
app.use(express.json({ limit: '1mb' }));

// Apply CORS headers to every response — must run before route handlers
app.use(applyCorsHeaders);

// ── Routes ────────────────────────────────────────────────────────────────────

// All service proxies: /jira-proxy/*, /snow-proxy/*, /github-proxy/*
app.use(createProxyRouter(configuration));

// Setup wizard: GET /setup, POST /api/setup
app.use(createSetupRouter(configuration));

// Internal APIs: /api/proxy-status, /api/proxy-config, /api/snow-session
app.use(createApiRouter(configuration));

// Scheduler APIs: /api/scheduler/*
app.use(createSchedulerRouter(configuration));

// First-run detection: GET / redirects to /setup when no service is configured.
// Placed before the static file middleware so misconfigured instances always see
// the wizard instead of a non-functional dashboard.
app.get('/', (req, res, next) => {
  const isAnyServiceConfigured =
    isServiceConfigured(configuration.jira)   ||
    isServiceConfigured(configuration.snow)   ||
    !!(configuration.github && configuration.github.pat);

  if (!isAnyServiceConfigured) {
    return res.redirect(302, '/setup');
  }
  next();
});

// Static dashboard: GET / → serves public/toolbox.html
app.use(serveStaticFile());

// ── Start Server ──────────────────────────────────────────────────────────────

const listenPort = configuration.port || DEFAULT_PORT;

// Only bind a TCP port when the file is executed directly (node server.js).
// When required by tests, only the Express app object is needed — no port binding.
let server = null;
if (require.main === module) {
  server = app.listen(listenPort, '127.0.0.1', () => {
    printStartupBanner(listenPort);
    startSchedulerLoop(configuration);

    if (process.argv.includes('--open')) {
      openBrowserToDashboard(listenPort);
    }
  });
}

// ── Exports (for testing) ─────────────────────────────────────────────────────

module.exports = { app, server };

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Prints the startup banner to stdout using box-drawing characters.
 * Gives end users a clear visual confirmation that the server is running
 * and shows the URL to open in their browser.
 *
 * @param {number} port - The TCP port the server is listening on
 */
function printStartupBanner(port) {
  const dashboardUrl = 'http://localhost:' + port;
  const jiraReady    = !!(configuration.jira && configuration.jira.baseUrl);
  const snowReady    = !!(configuration.snow && configuration.snow.baseUrl);
  const githubReady  = !!(configuration.github && configuration.github.pat);

  const serviceStatusLines = [
    '  Jira    ' + (jiraReady   ? '✅ configured' : '⚠  not configured'),
    '  GitHub  ' + (githubReady ? '✅ configured' : '⚠  not configured'),
    '  SNow    ' + (snowReady   ? '✅ configured' : '⚠  not configured'),
  ];

  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║     NodeToolbox v' + APP_VERSION + ' — Proxy Server     ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║                                              ║');
  console.log('  ║  Dashboard → ' + dashboardUrl + '          ║');
  console.log('  ║                                              ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  serviceStatusLines.forEach((line) => console.log(line));
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
}

/**
 * Opens the Toolbox dashboard in the user's default browser.
 * Uses the `start` command on Windows and `open` on macOS/Linux.
 *
 * @param {number} port - The TCP port the server is listening on
 */
function openBrowserToDashboard(port) {
  const { exec } = require('child_process');
  const dashboardUrl = 'http://localhost:' + port;
  const openCommand  = process.platform === 'win32'
    ? 'start "" "' + dashboardUrl + '"'
    : process.platform === 'darwin'
      ? 'open "' + dashboardUrl + '"'
      : 'xdg-open "' + dashboardUrl + '"';

  exec(openCommand, (openError) => {
    if (openError) {
      console.log('  ⚠  Could not open browser automatically: ' + openError.message);
    }
  });
}
