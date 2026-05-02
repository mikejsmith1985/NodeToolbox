// src/utils/staticFileServer.js — Static file discovery and safe serving middleware.
//
// Locates and serves the Toolbox HTML dashboard. Designed for three distribution
// modes:
//   1. Development / zip extract — file is at public/toolbox.html on disk.
//   2. pkg .exe bundle — file is in the snapshot virtual filesystem; existsSync is
//      NOT patched by @yao-pkg/pkg but readFileSync IS, so we pre-load at startup.
//   3. Fallback search — ~/Downloads, ~/Desktop, ~/Documents (legacy compatibility).
//
// Issue #22 root cause: @yao-pkg/pkg patches fs.readFile/readFileSync for snapshot
// assets but does NOT reliably patch fs.existsSync. findToolboxHtml() used existsSync
// which silently returned false in the exe, producing the "File Not Found" page
// immediately after the setup wizard. The fix is to read the HTML once at module
// load time (readFileSync IS intercepted) and cache it — every GET / thereafter
// serves from that cache without touching existsSync at all.

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

// Read toolbox.html at module load time using fs.readFileSync.
// In a pkg exe, readFileSync IS patched to serve from the snapshot even when
// existsSync (used by findToolboxHtml) would incorrectly return false.
// In development and zip distributions, readFileSync reads from the real disk.
// Either way a single synchronous read at startup avoids repeated per-request
// filesystem probing and eliminates the pkg existsSync gap entirely.

/**
 * Dashboard HTML pre-loaded from the snapshot or disk at startup.
 * Null only when public/toolbox.html is genuinely absent (e.g. a stripped CI image).
 * Exported so tests can verify the cache is populated without making an HTTP request.
 *
 * @type {string|null}
 */
let cachedDashboardHtml = null;
try {
  const dashboardHtmlPath = path.join(PUBLIC_DIRECTORY_PATH, TOOLBOX_HTML_FILENAME);
  cachedDashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf-8');
} catch (_readError) {
  // File absent at startup (e.g. CI, stripped container) — runtime fallback will run
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
 *   1. cachedDashboardHtml — pre-loaded at startup; works in both pkg exe and
 *      zip distributions without any per-request filesystem call. This is the
 *      primary path and fixes the pkg existsSync gap (Issue #22).
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
    // This is the only path that works inside a pkg exe because existsSync is
    // not patched for snapshot assets but readFileSync (used at init) is.
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

module.exports = { cachedDashboardHtml, findToolboxHtml, serveStaticFile };
