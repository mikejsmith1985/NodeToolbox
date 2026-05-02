// src/utils/staticFileServer.js — Static file discovery and safe serving middleware.
//
// Locates and serves the Toolbox HTML dashboard. Designed for three distribution
// modes:
//   1. pkg .exe bundle — HTML is pre-compiled as a JS module into the snapshot.
//      require('../generated/dashboardHtmlContent') ALWAYS works inside the exe
//      because JS modules are compiled directly into the binary, unlike fs assets
//      which rely on path interception that is build-machine-specific.
//   2. Development / zip extract — generated module may not exist; falls back to
//      fs.readFileSync reading public/toolbox.html from the real disk.
//   3. Fallback search — ~/Downloads, ~/Desktop, ~/Documents (legacy compatibility).
//
// Issue #22 root cause (confirmed): after the setup wizard on a corporate PC, the
// browser is redirected to GET /. On the build machine, readFileSync resolved
// C:\...\public\toolbox.html from the real disk (not the pkg snapshot) so it
// appeared to work. On any other machine that path doesn't exist, readFileSync
// throws, cachedDashboardHtml stays null, and the "File Not Found" page is returned.
//
// Fix (v0.0.11): local-release.ps1 runs scripts/generate-dashboard-module.js
// BEFORE the pkg build. That script converts toolbox.html into
// src/generated/dashboardHtmlContent.js. pkg compiles JS modules into the snapshot
// so require() works identically on every machine, bypassing fs interception entirely.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

/** Filename of the Toolbox HTML dashboard */
const TOOLBOX_HTML_FILENAME = 'toolbox.html';

/** Absolute path to the public/ directory at the project root */
const PUBLIC_DIRECTORY_PATH = path.join(__dirname, '..', '..', 'public');

/** Standard content-type for HTML responses */
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

// ── Startup pre-load (pkg snapshot fix) ──────────────────────────────────────

// Priority 1: require the pre-compiled JS module.
//   local-release.ps1 runs scripts/generate-dashboard-module.js before the pkg
//   build. That script writes src/generated/dashboardHtmlContent.js which pkg
//   compiles into the snapshot as code. require() is ALWAYS intercepted for JS
//   modules in pkg — no fs path matching involved. This is the only approach
//   that is guaranteed to work on every machine, not just the build machine.
//
// Priority 2: fs.readFileSync fallback.
//   In development and zip distributions the generated module does not exist,
//   so we fall back to reading from the real disk. This works because the
//   developer has the full project directory with public/toolbox.html present.
//
// Either way the result is cached once at module load time. Every GET /
// thereafter serves from the cache without any per-request filesystem I/O.

/**
 * Dashboard HTML pre-loaded from the generated JS module (pkg snapshot) or
 * from disk (development/zip). Null only when neither source is available.
 * Exported so tests can verify the cache is populated without making HTTP requests.
 *
 * @type {string|null}
 */
let cachedDashboardHtml = null;

/**
 * Records which code path successfully populated cachedDashboardHtml.
 * 'require'      → loaded from the pkg snapshot (production .exe path, v0.0.11+ fix)
 * 'readFileSync' → loaded from disk (development or ZIP distribution path)
 * null           → neither source was available at startup
 *
 * Exposed by GET /api/diagnostic so corporate-PC failures can be triaged
 * without physical access to the machine.
 *
 * @type {'require'|'readFileSync'|null}
 */
let cachedHtmlLoadMethod = null;

try {
  // Primary: generated module compiled into the pkg snapshot.
  // eslint-disable-next-line import/no-unresolved
  cachedDashboardHtml = require('../generated/dashboardHtmlContent');
  cachedHtmlLoadMethod = 'require';
} catch (_requireError) {
  // Generated module not present in this environment (development / CI).
  // Fall back to reading the HTML from disk — works when public/ is accessible.
  try {
    const dashboardHtmlPath = path.join(PUBLIC_DIRECTORY_PATH, TOOLBOX_HTML_FILENAME);
    cachedDashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf-8');
    cachedHtmlLoadMethod = 'readFileSync';
  } catch (_readError) {
    // File genuinely absent — runtime fallback search will run on each request.
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Locates toolbox.html by searching a priority-ordered list of directories.
 * Returns the absolute file path if found, or null if not found anywhere.
 *
 * Search order:
 * 1. public/toolbox.html   (project public directory — primary location)
 * 2. ~/Downloads/          (typical end-user download location)
 * 3. ~/Desktop/            (common distribution drop location)
 * 4. ~/Documents/          (fallback user-content location)
 *
 * @returns {string|null} Absolute file path or null
 */
function findToolboxHtml() {
  const homeDirectory = process.env.HOME || process.env.USERPROFILE || '';

  const searchPaths = [
    path.join(PUBLIC_DIRECTORY_PATH, TOOLBOX_HTML_FILENAME),
    path.join(homeDirectory, 'Downloads',  TOOLBOX_HTML_FILENAME),
    path.join(homeDirectory, 'Desktop',    TOOLBOX_HTML_FILENAME),
    path.join(homeDirectory, 'Documents',  TOOLBOX_HTML_FILENAME),
  ];

  for (const candidatePath of searchPaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

/**
 * Returns an Express middleware that serves toolbox.html for GET / requests.
 *
 * Serving priority:
 *   1. cachedDashboardHtml — pre-loaded at startup from the generated JS module
 *      (pkg snapshot, always works) or from disk (development/zip). This is the
 *      primary path and the ONLY path that works reliably in the bundled .exe
 *      on any machine (not just the build machine).
 *   2. findToolboxHtml() filesystem search — legacy fallback for edge cases
 *      where the file was absent at startup (e.g. hot-swap without restart).
 *   3. 404 "File Not Found" page — only when neither path has the file.
 *
 * Security: Only serves files explicitly located by the two methods above.
 * There is no general filesystem traversal — callers cannot request arbitrary paths.
 *
 * @returns {import('express').RequestHandler}
 */
function serveStaticFile() {
  return (req, res, next) => {
    // Only intercept GET / — all other paths fall through to Express 404 handling
    if (req.method !== 'GET' || req.path !== '/') {
      return next();
    }

    // Primary path: serve from the pre-loaded cache.
    // In the pkg exe this is the only path that works — cachedDashboardHtml is
    // populated from the generated JS module (compiled into the snapshot), not
    // from fs which would fail on any machine other than the build machine.
    if (cachedDashboardHtml !== null) {
      res.setHeader('Content-Type', HTML_CONTENT_TYPE);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(cachedDashboardHtml);
    }

    // Fallback: file was absent at startup — try finding it on disk now.
    // Covers cases where toolbox.html was placed in user directories after startup.
    const htmlFilePath = findToolboxHtml();

    if (!htmlFilePath) {
      return res.status(404).send(buildHtmlNotFoundPage());
    }

    // fs.readFile is used instead of pipe/stream so the 404 page can be served
    // inline if the file disappears between findToolboxHtml() and the read.
    fs.readFile(htmlFilePath, (readError, fileContents) => {
      if (readError) {
        console.warn('  ⚠  Could not read toolbox.html: ' + readError.message);
        return res.status(404).send(buildHtmlNotFoundPage());
      }

      res.setHeader('Content-Type', HTML_CONTENT_TYPE);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).end(fileContents);
    });
  };
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Builds a minimal HTML page to display when toolbox.html cannot be found.
 * Gives the user actionable guidance rather than a raw 404 response.
 *
 * @returns {string} HTML string
 */
function buildHtmlNotFoundPage() {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>NodeToolbox — File Not Found</title>',
    '<style>body{font-family:monospace;padding:2rem;background:#1e1e1e;color:#d4d4d4}</style></head>',
    '<body>',
    '<h2>⚠ toolbox.html not found</h2>',
    '<p>NodeToolbox is running, but the dashboard file (<code>toolbox.html</code>) could not be located.</p>',
    '<p>Expected location: <code>public/toolbox.html</code></p>',
    '<p>Ensure you have run the installation steps in the README, or place <code>toolbox.html</code>',
    ' in the project <code>public/</code> directory.</p>',
    '</body></html>',
  ].join('\n');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { cachedDashboardHtml, cachedHtmlLoadMethod, findToolboxHtml, serveStaticFile };
