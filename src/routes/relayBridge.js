// src/routes/relayBridge.js — Server-mediated relay bridge for Chrome-compatible operation.
//
// The browser relay normally uses window.postMessage() to communicate between the
// NodeToolbox tab (localhost:5555) and the SNow/Jira bookmarklet tab. Chrome's strict
// enforcement of Cross-Origin-Opener-Policy (COOP) on service-now.com and atlassian.net
// silently severs both the outbound postMessage channel and the window.opener reference,
// making the relay non-functional in Chrome.
//
// This module implements an HTTP-based alternative that bypasses COOP entirely:
//   1. The bookmarklet POSTs to /api/relay-bridge/register to signal it is active.
//   2. The bookmarklet long-polls /api/relay-bridge/poll for pending requests.
//   3. When a request arrives, the bookmarklet executes fetch() with credentials:"include"
//      (same as the postMessage relay — browser session cookies are sent automatically).
//   4. The bookmarklet POSTs the result to /api/relay-bridge/result.
//   5. NodeToolbox front-end long-polls /api/relay-bridge/result/:id for the response.
//
// Chrome always treats http://localhost as a secure context regardless of the calling
// page's protocol, so bookmarklets on HTTPS SNow/Jira pages can freely fetch
// http://localhost:5555 without mixed-content or CORS restrictions.
//
// All state is in-process memory and resets on server restart — this is intentional.
// Bridge sessions are ephemeral (bookmarklet must be re-clicked each server start).

'use strict';

const express = require('express');

// ── Constants ────────────────────────────────────────────────────────────────

/** Systems the bridge supports — matches the sys identifiers used by the bookmarklet. */
const SUPPORTED_SYSTEMS = ['snow', 'jira', 'conf'];

/**
 * How long (ms) to hold a bookmarklet poll open before returning { request: null }.
 * Must be shorter than any proxy timeout so the connection does not appear stale.
 */
const POLL_TIMEOUT_MS = 28000;

/**
 * How long (ms) NodeToolbox waits for the bookmarklet to return a result before
 * giving up and responding with HTTP 408 to the front-end.
 */
const RESULT_TIMEOUT_MS = 30000;

// ── Bridge state ──────────────────────────────────────────────────────────────

/**
 * Creates a clean, empty bridge channel for one system (snow / jira / conf).
 * Isolated per system so SNow and Jira can be relayed independently.
 *
 * @returns {{ isActive: boolean, pendingRequests: Array, pendingResults: object,
 *             pollWaiters: Array, resultWaiters: object,
 *             lastRegisteredAt: number|null, lastDeregisteredAt: number|null,
 *             lastPolledAt: number|null }}
 */
function createBridgeChannel() {
  return {
    // True when the bookmarklet has registered and not yet deregistered
    isActive: false,
    // Requests queued by Toolbox waiting to be fetched by the bookmarklet
    pendingRequests: [],
    // Results posted by the bookmarklet, keyed by request id, waiting for Toolbox to read
    pendingResults: {},
    // Response objects held open by the bookmarklet's long-poll (idle — no request yet)
    pollWaiters: [],
    // Response objects held open by Toolbox's result long-poll, keyed by request id
    resultWaiters: {},
    // Timestamps for diagnostic reporting — null until the event has occurred
    lastRegisteredAt:    null,
    lastDeregisteredAt:  null,
    lastPolledAt:        null,
  };
}

/** Live bridge state for all supported systems — resets when the server restarts. */
const bridgeState = SUPPORTED_SYSTEMS.reduce(function(acc, sys) {
  acc[sys] = createBridgeChannel();
  return acc;
}, {});

// ── Router ────────────────────────────────────────────────────────────────────

const router = express.Router();

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Bookmarklet calls this on activation to register itself as active.
 * Clears any stale state from a previous bookmarklet session.
 *
 * POST /api/relay-bridge/register?sys=snow
 */
router.post('/register', (req, res) => {
  const sys = req.query.sys || 'snow';
  if (!bridgeState[sys]) {
    return res.status(400).json({ error: 'Unknown sys: ' + sys });
  }

  const channel = bridgeState[sys];
  channel.isActive = true;
  channel.lastRegisteredAt = Date.now();
  // Flush stale queued items — they were meant for the previous bookmarklet session
  channel.pendingRequests = [];
  channel.pendingResults  = {};

  res.json({ ok: true, sys });
});

/**
 * Bookmarklet calls this on pagehide (via navigator.sendBeacon) to signal it is gone.
 * Releases any poll waiters that would otherwise hang until their own timeout fires.
 *
 * POST /api/relay-bridge/deregister?sys=snow
 */
router.post('/deregister', (req, res) => {
  const sys = req.query.sys || 'snow';
  const channel = bridgeState[sys];

  if (channel) {
    channel.isActive = false;
    channel.lastDeregisteredAt = Date.now();
    // Immediately release any bookmarklet long-polls — they will never get a request now
    channel.pollWaiters.forEach(waiter => {
      clearTimeout(waiter.timer);
      waiter.res.json({ request: null });
    });
    channel.pollWaiters = [];
  }

  res.json({ ok: true });
});

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * NodeToolbox front-end polls this to detect when the bookmarklet has registered.
 * Also used by the 30-second keep-alive check to detect if the bookmarklet navigated away.
 *
 * GET /api/relay-bridge/status?sys=snow
 */
router.get('/status', (req, res) => {
  const sys = req.query.sys || 'snow';
  const channel = bridgeState[sys];
  if (!channel) return res.json({ active: false, sys });
  res.json({
    active:              channel.isActive,
    sys,
    lastRegisteredAt:    channel.lastRegisteredAt,
    lastDeregisteredAt:  channel.lastDeregisteredAt,
    lastPolledAt:        channel.lastPolledAt,
  });
});

// ── Request queuing ───────────────────────────────────────────────────────────

/**
 * NodeToolbox front-end enqueues a request for the bookmarklet to execute.
 * If the bookmarklet is already waiting in a long-poll, delivers the request immediately.
 *
 * POST /api/relay-bridge/request
 * Body: { sys, id, method, path, body, authHeader }
 */
router.post('/request', (req, res) => {
  const { sys = 'snow', id, method, path: apiPath, body, authHeader } = req.body;

  if (!bridgeState[sys]) {
    return res.status(400).json({ error: 'Unknown sys: ' + sys });
  }
  if (!id) {
    return res.status(400).json({ error: 'Missing request id' });
  }

  const channel = bridgeState[sys];
  const entry = {
    id,
    sys,
    method:     method     || 'GET',
    path:       apiPath,
    body:       body       || null,
    authHeader: authHeader || null,
  };

  if (channel.pollWaiters.length > 0) {
    // Bookmarklet is already waiting — deliver the request without queueing
    const waiter = channel.pollWaiters.shift();
    clearTimeout(waiter.timer);
    waiter.res.json({ request: entry });
  } else {
    channel.pendingRequests.push(entry);
  }

  res.json({ ok: true, id });
});

// ── Bookmarklet long-poll ─────────────────────────────────────────────────────

/**
 * Bookmarklet calls this to receive its next pending request.
 * Returns immediately if a request is waiting; otherwise holds the HTTP connection
 * open for up to POLL_TIMEOUT_MS before returning { request: null }.
 *
 * GET /api/relay-bridge/poll?sys=snow
 */
router.get('/poll', (req, res) => {
  const sys = req.query.sys || 'snow';
  const channel = bridgeState[sys];

  if (!channel) return res.json({ request: null });

  // Track when the bookmarklet last checked in — used by diagnostic reports
  channel.lastPolledAt = Date.now();

  // Serve immediately if a request is already queued
  if (channel.pendingRequests.length > 0) {
    return res.json({ request: channel.pendingRequests.shift() });
  }

  // Enter long-poll: hold the connection until a request arrives or timeout
  const waiter = { res, timer: null };
  waiter.timer = setTimeout(() => {
    const idx = channel.pollWaiters.indexOf(waiter);
    if (idx >= 0) channel.pollWaiters.splice(idx, 1);
    res.json({ request: null });
  }, POLL_TIMEOUT_MS);

  channel.pollWaiters.push(waiter);
});

// ── Result submission and collection ─────────────────────────────────────────

/**
 * Bookmarklet posts the result of executing a request.
 * If NodeToolbox is already waiting for this result via long-poll, delivers immediately.
 *
 * POST /api/relay-bridge/result
 * Body: { id, sys, ok, status, data, error }
 */
router.post('/result', (req, res) => {
  const { id, sys = 'snow', ok, status, data, error } = req.body;

  if (!id) return res.status(400).json({ error: 'Missing id' });

  const channel = bridgeState[sys];
  if (!channel) return res.status(400).json({ error: 'Unknown sys: ' + sys });

  const result = { id, ok, status, data, error };
  const waiter  = channel.resultWaiters[id];

  if (waiter) {
    // NodeToolbox is already waiting — deliver immediately
    clearTimeout(waiter.timer);
    delete channel.resultWaiters[id];
    waiter.res.json({ result });
  } else {
    // Store for NodeToolbox to collect when it next polls
    channel.pendingResults[id] = result;
  }

  res.json({ ok: true });
});

/**
 * NodeToolbox front-end long-polls for the result of a specific request.
 * Returns immediately if the bookmarklet has already posted the result; otherwise
 * holds the connection until it arrives or RESULT_TIMEOUT_MS elapses (HTTP 408).
 *
 * GET /api/relay-bridge/result/:id?sys=snow
 */
router.get('/result/:id', (req, res) => {
  const id      = req.params.id;
  const sys     = req.query.sys || 'snow';
  const channel = bridgeState[sys];

  if (!channel) return res.status(400).json({ error: 'Unknown sys: ' + sys });

  // Result already posted by the bookmarklet — return it immediately
  if (channel.pendingResults[id]) {
    const result = channel.pendingResults[id];
    delete channel.pendingResults[id];
    return res.json({ result });
  }

  // Long-poll: wait for the bookmarklet to post the result
  const waiter = { res, timer: null };
  waiter.timer = setTimeout(() => {
    delete channel.resultWaiters[id];
    res.status(408).json({
      error: 'Relay bridge timed out (30s). The relay bookmarklet may have navigated away or closed.',
    });
  }, RESULT_TIMEOUT_MS);

  channel.resultWaiters[id] = waiter;
});

module.exports = router;

// ── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Returns whether the relay bridge is active for a given system identifier.
 * Used by the /api/snow-diag endpoint so diagnostic reports can include relay state
 * without making an internal HTTP request to /api/relay-bridge/status/:sys.
 *
 * @param {string} sys - System identifier: 'snow', 'jira', or 'conf'
 * @returns {boolean} True when the bookmarklet has registered and not deregistered
 */
module.exports.getBridgeStatus = function getBridgeStatus(sys) {
  return !!(bridgeState[sys] && bridgeState[sys].isActive);
};

/**
 * Returns a safe diagnostic snapshot for the given system — active state and
 * registration timestamps but no queued request bodies or result data.
 * Used by /api/snow-diag so the diagnostic report can show connection history.
 *
 * @param {string} sys - System identifier: 'snow', 'jira', or 'conf'
 * @returns {{ active: boolean, lastRegisteredAt: number|null, lastDeregisteredAt: number|null, lastPolledAt: number|null }}
 */
module.exports.getBridgeDiag = function getBridgeDiag(sys) {
  const channel = bridgeState[sys];
  if (!channel) return { active: false, lastRegisteredAt: null, lastDeregisteredAt: null, lastPolledAt: null };
  return {
    active:              channel.isActive,
    lastRegisteredAt:    channel.lastRegisteredAt,
    lastDeregisteredAt:  channel.lastDeregisteredAt,
    lastPolledAt:        channel.lastPolledAt,
  };
};

// Exposed only for unit testing — resets all bridge channels to a clean state.
// Never call this in production code.
module.exports._resetBridgeStateForTests = function() {
  SUPPORTED_SYSTEMS.forEach(function(sys) {
    bridgeState[sys] = createBridgeChannel();
  });
};
