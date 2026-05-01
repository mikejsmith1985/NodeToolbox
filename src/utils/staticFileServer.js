// src/utils/staticFileServer.js — Static file discovery and safe serving middleware.
//
// Locates and serves the Toolbox HTML dashboard. Designed for both the development
// flow (file at public/toolbox.html) and the standalone end-user distribution where
// the HTML file may be in the user's Downloads, Desktop, or Documents folder.

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

// ── Constants ────────────────────────────────────────────────────────────────

/** Filename of the Toolbox HTML dashboard */
const TOOLBOX_HTML_FILENAME = 'toolbox.html';

/** Absolute path to the public/ directory at the project root */
const PUBLIC_DIRECTORY_PATH = path.join(__dirname, '..', '..', 'public');

/** Standard content-type for HTML responses */
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

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
 * Resolves the file path fresh on every request so that swapping the file
 * does not require a server restart.
 *
 * Security: Only serves files that are explicitly located by findToolboxHtml().
 * There is no general file system traversal — callers cannot request arbitrary paths.
 *
 * @returns {import('express').RequestHandler}
 */
function serveStaticFile() {
  return (req, res, next) => {
    // Only intercept GET / — all other paths fall through to Express 404 handling
    if (req.method !== 'GET' || req.path !== '/') {
      return next();
    }

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

module.exports = { findToolboxHtml, serveStaticFile };
