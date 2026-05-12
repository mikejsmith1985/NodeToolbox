// server.js — NodeToolbox Express entry point.
//
// Wires together all middleware, route modules, and background services.
// Starts the proxy server on the configured port (default: 5555) and prints
// a startup banner so users know where to open the dashboard.

'use strict';

const path        = require('path');
const fs          = require('fs');
const express     = require('express');
const compression = require('compression');

const { loadConfig, createConfigTemplate, isServiceConfigured } = require('./src/config/loader');
const { applyCorsHeaders }                  = require('./src/middleware/cors');
const createProxyRouter                     = require('./src/routes/proxy');
const createApiRouter                       = require('./src/routes/api');
const createSchedulerRouter                 = require('./src/routes/scheduler');
const createSetupRouter                     = require('./src/routes/setup');
const relayBridgeRouter                     = require('./src/routes/relayBridge');

const { startSchedulerLoop }                = require('./src/services/repoMonitor');
const { isPortInUse, resolvePortConflict }  = require('./src/utils/portManager');
const { installConsoleInterceptor }         = require('./src/utils/logBuffer');

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

// Intercept console output so the Dev Panel's Server Logs tab can show
// server-side activity without requiring a separate WebSocket or log file.
// Must be installed before loadConfig() so early startup messages are captured.
installConsoleInterceptor();

/** Live configuration loaded from toolbox-proxy.json + environment variables */
const configuration = loadConfig();

// ── Express Application ───────────────────────────────────────────────────────

const app = express();

// Compress all responses with gzip/deflate — reduces React bundle + API response sizes.
// Must be registered before any route or middleware that sends responses.
app.use(compression());

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

// ── Static File Serving ───────────────────────────────────────────────────────
//
// Serves the React SPA from client/dist/ — built by `npm run build:client`.
// All non-API paths return index.html so React Router handles client-side
// navigation.
//
// Three serving strategies depending on how NodeToolbox was launched:
//
//   1. Pkg-bundled exe (process.pkg truthy):
//      Files are embedded directly in the JavaScript bytecode via
//      src/embeddedClient.js (generated at release time). The static middleware
//      looks up each request in this in-memory map. This is bulletproof —
//      pkg always bundles JS source, so the SPA cannot be missing.
//
//   2. ZIP / dev (process.pkg falsy):
//      Standard express.static against client/dist/ on real disk.
//
// The embedded-client module is only required() in pkg mode so dev/ZIP
// installs don't pay the cost of loading several MB of base64.

/**
 * Lazy-loaded embedded-client module — only required when running as a pkg exe.
 * In dev/ZIP mode this stays null and we use express.static against real disk.
 *
 * @type {Object<string, Buffer>|null}
 */
let embeddedClientFiles = null;

if (process.pkg) {
  // The generated module ships in the repo as src/embeddedClient.js. It must
  // exist before pkg builds the exe — local-release.ps1 generates it as
  // step [3.5/6] right after the React build completes. If it is missing in
  // dev (no exe), the pkg branch never runs so this require is fine.
  embeddedClientFiles = require('./src/embeddedClient');
}

const clientDistDir       = path.join(__dirname, 'client', 'dist');
const clientDistIndexPath = path.join(__dirname, 'client', 'dist', 'index.html');

// Content-type map for React SPA asset extensions.
const STATIC_CONTENT_TYPES = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.eot':   'application/vnd.ms-fontobject',
  '.map':   'application/json',
};

/**
 * Returns the HTTP Content-Type header value for a given file path.
 * Defaults to application/octet-stream for unknown extensions.
 *
 * @param {string} filePath - Absolute or relative file path with an extension
 * @returns {string} Content-Type header value
 */
function getStaticContentType(filePath) {
  const fileExtension = path.extname(filePath).toLowerCase();
  return STATIC_CONTENT_TYPES[fileExtension] || 'application/octet-stream';
}

/**
 * Normalises an HTTP request path to an embeddedClientFiles key.
 * Strips the leading slash and any query string so '/assets/index-X.js?v=1'
 * becomes 'assets/index-X.js' which matches the keys generated by
 * scripts/generate-embedded-client.js.
 *
 * @param {string} requestPath - The req.path value from Express
 * @returns {string} The normalised key, or '' for the root path
 */
function normaliseEmbeddedKey(requestPath) {
  let lookupKey = requestPath.replace(/^\/+/, '');
  const queryStart = lookupKey.indexOf('?');
  if (queryStart !== -1) lookupKey = lookupKey.slice(0, queryStart);
  return lookupKey;
}

if (process.pkg) {
  // Pkg exe mode: serve from the in-memory embedded-client map.
  // This is guaranteed to work because the file contents are part of the
  // JavaScript module bytecode that pkg always bundles — no asset virtual
  // filesystem dependency.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const lookupKey         = normaliseEmbeddedKey(req.path);
    const embeddedFileBytes = embeddedClientFiles[lookupKey];
    if (!embeddedFileBytes) return next();
    res.setHeader('Content-Type', getStaticContentType(lookupKey));
    res.end(embeddedFileBytes);
  });
} else {
  // Standard express.static for dev (node server.js) and ZIP distributions.
  app.use(express.static(clientDistDir));
}

// SPA fallback — send index.html for any path React Router should handle.
// API and proxy routes registered above match before this catch-all, so
// backend endpoints are never accidentally swallowed by the React app.
app.get('*', (_req, res) => {
  if (process.pkg) {
    // Pkg mode: serve index.html from the embedded map.
    const indexHtmlBytes = embeddedClientFiles['index.html'];
    if (indexHtmlBytes) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(indexHtmlBytes);
    }
    return res.status(503).send(buildClientNotBuiltPage());
  }
  // Dev/ZIP: read from disk.
  if (!fs.existsSync(clientDistIndexPath)) {
    return res.status(503).send(buildClientNotBuiltPage());
  }
  res.sendFile(clientDistIndexPath);
});

// ── Start Server ──────────────────────────────────────────────────────────────

/**
 * Builds a minimal HTML error page shown when client/dist/ has not been built.
 * Gives the operator actionable guidance rather than a generic 503.
 *
 * @returns {string} HTML string
 */
function buildClientNotBuiltPage() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>NodeToolbox — Build Required</title>',
    '<style>body{font-family:monospace;padding:2rem;background:#1e1e1e;color:#d4d4d4}</style></head>',
    '<body>',
    '<h2>⚠ React build not found</h2>',
    '<p>Run <code>npm run build:client</code> to build the React UI, then restart the server.</p>',
    '<p>Expected build output: <code>client/dist/index.html</code></p>',
    '</body></html>',
  ].join('\n');
}

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
    //   --open      : passed explicitly by Launch Toolbox.bat (zip distribution)
    //   process.pkg : bundled exe; but only when NOT launched by the VBS launcher.
    //                 The VBS passes --no-open so it can open the browser itself
    //                 after polling confirms the port is ready — preventing the
    //                 double-tab that occurs when both the exe and the VBS open
    //                 the browser at the same time.
    const shouldOpenBrowser =
      process.argv.includes('--open') ||
      (!!process.pkg && !process.argv.includes('--no-open'));
    if (shouldOpenBrowser) {
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
