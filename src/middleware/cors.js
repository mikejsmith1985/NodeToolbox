// src/middleware/cors.js — Express middleware that adds CORS headers to every response.
//
// Toolbox uses credentials:'omit' for all proxy requests, so a wildcard origin (*) is
// safe and correct. This also handles file:// origins (Origin: null) which occur when
// users open toolbox.html directly from their filesystem before the setup wizard runs.

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

/** How long browsers should cache the preflight response (24 hours in seconds). */
const PREFLIGHT_CACHE_MAX_AGE_SECONDS = '86400';

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Express middleware that writes standard CORS headers on every response.
 * Must be mounted before all routes so OPTIONS preflight requests are handled
 * before any route-specific logic runs.
 *
 * @param {import('express').Request}  req  - The incoming request
 * @param {import('express').Response} res  - The outgoing response
 * @param {import('express').NextFunction} next - Calls the next middleware
 */
function applyCorsHeaders(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age',       PREFLIGHT_CACHE_MAX_AGE_SECONDS);

  // Respond immediately to OPTIONS preflight — no further processing needed
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return next();
}

module.exports = { applyCorsHeaders };
