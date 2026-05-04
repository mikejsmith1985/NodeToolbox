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
const relayBridgeRouter                     = require('./src/routes/relayBridge');
const { serveStaticFile }                   = require('./src/utils/staticFileServer');
const { startSchedulerLoop }                = require('./src/services/repoMonitor');
const { isPortInUse, resolvePortConflict }  = require('./src/utils/portManager');

// ── Constants ────────────────────────────────────────────────────────────────

/** Default TCP port for the proxy server — matches the original ToolBox server for bookmark compatibility */
const DEFAULT_PORT = 5555;

/** Version string read from package.json — single source of truth shared with api.js */
const APP_VERSION = require('./package.json').version;

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

// Relay bridge: /api/relay-bridge/* — HTTP-based relay for Chrome (bypasses COOP)
app.use('/api/relay-bridge', relayBridgeRouter);

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

/**
 * Async startup wrapper that handles port conflicts before binding the listener.
 *
 * Startup sequence:
 *   1. Check if the port is already occupied (isPortInUse).
 *   2. If occupied → resolvePortConflict: kills the occupant, waits for OS
 *        to release the port, then falls through.
 *   3. Bind app.listen() — EADDRINUSE handler still catches any remaining failure.
 *
 * Keeping this logic async allows the pre-flight port check without restructuring
 * the rest of the startup (banner, scheduler, browser open) which stay synchronous
 * inside the listen callback.
 *
 * @returns {Promise<void>}
 */
async function launchServer() {
  const portIsCurrentlyBusy = await isPortInUse(listenPort);

  if (portIsCurrentlyBusy) {
    // resolvePortConflict kills the occupant and waits for the OS to release
    // the port binding. Falls through to app.listen() regardless.
    // If the port is still occupied after the kill, EADDRINUSE handles it.
    await resolvePortConflict(listenPort, openBrowserToDashboard);
  }

  server = app.listen(listenPort, '127.0.0.1', () => {
    printStartupBanner(listenPort);
    startSchedulerLoop(configuration);

    // Open the dashboard automatically when:
    //   --open  : passed explicitly by Launch Toolbox.bat
    //   process.pkg : the server is running as the bundled .exe (double-click)
    if (process.argv.includes('--open') || !!process.pkg) {
      openBrowserToDashboard(listenPort);
    }
  });

  // Handle server-level errors — most importantly EADDRINUSE (port already in use).
  // Without this handler the error throws as an unhandled exception: the console
  // window closes instantly and the user sees nothing at all.
  server.on('error', (serverError) => {
    console.error('');
    if (serverError.code === 'EADDRINUSE') {
      console.error('  ❌ Port ' + listenPort + ' is already in use by another program.');
      console.error('     To fix this, either:');
      console.error('       1. Close whatever is already running on port ' + listenPort + ',');
      console.error('          then re-launch NodeToolbox.');
      console.error('       2. Change the "port" value in your toolbox-proxy.json config');
      console.error('          (found in %APPDATA%\\NodeToolbox\\toolbox-proxy.json)');
      console.error('          and re-launch NodeToolbox.');
    } else {
      console.error('  ❌ Server startup error: ' + serverError.message);
    }
    console.error('');
    // Keep the console window open so the user can read the message before it
    // disappears — critical for the .exe (double-click) distribution where there
    // is no parent terminal to scroll back through.
    process.stdin.resume();
    console.error('  Press Ctrl+C or close this window to exit.');
  });
}

if (require.main === module) {
  launchServer();
}

// ── Exports (for testing) ─────────────────────────────────────────────────────

module.exports = { app, server };

// ── Uncaught-Exception Safety Net ─────────────────────────────────────────────

// Catches any throw that escapes all other error handlers — e.g., a missing
// npm package (Cannot find module) on a fresh install where npm ci was skipped.
// Without this the console window closes instantly. With it the user sees the
// error and can diagnose the problem.
if (require.main === module) {
  process.on('uncaughtException', (unexpectedError) => {
    console.error('');
    console.error('  ❌ Unexpected startup error: ' + unexpectedError.message);
    if (unexpectedError.code === 'MODULE_NOT_FOUND') {
      console.error('');
      console.error('  This usually means Node.js modules are not installed.');
      console.error('  Try running: npm ci --omit=dev');
      console.error('  in the NodeToolbox folder, then re-launch.');
    }
    console.error('');
    process.stdin.resume();
    console.error('  Press Ctrl+C or close this window to exit.');
  });
}

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
