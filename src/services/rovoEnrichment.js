// src/services/rovoEnrichment.js — Shared, non-blocking server-side Rovo text request.
//
// Schedulers (standup briefing, scope-change, feature-change) and the hygiene
// monitor all need the same thing: send a prompt to Rovo via the existing
// dispatch-and-poll exchange and get the response text back — but NEVER let a slow
// or unavailable Rovo block or fail the surrounding report. This helper wraps
// `dispatchPrompt` + `fetchResult` with a bounded poll and a non-throwing `null`
// fallback so callers can treat Rovo purely as an optional enrichment.

'use strict';

const crypto = require('crypto');
const { dispatchPrompt, fetchResult } = require('./rovoExchange');

// Bounded poll budget. Default ≈60s (20 × 3s) — enough for Rovo to answer without
// materially delaying a scheduler run (SC-001), short enough to fail fast when down.
const DEFAULT_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Resolves after the given delay. Extracted so the poll is injectable in tests. */
function delayMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Reports whether Rovo enrichment is configured and turned on. Enrichment is opt-in
 * via the existing `rovoAutomation.isEnabled` flag and requires a webhook URL.
 *
 * @param {object} configuration - Live server config.
 * @returns {boolean} True when a scheduler may attempt Rovo enrichment.
 */
function isRovoEnabled(configuration) {
  const rovo = (configuration && configuration.rovoAutomation) || {};
  return !!rovo.isEnabled && !!rovo.webhookUrl;
}

/**
 * Sends a prompt to Rovo and returns the response text, or `null` on any
 * failure/timeout. NEVER throws — the caller proceeds without the Rovo block when
 * this returns null, so a Rovo outage cannot break report delivery (SC-008).
 *
 * @param {object} configuration - Live server config (rovoAutomation + confluence + sslVerify).
 * @param {string} prompt - The prompt to send to Rovo.
 * @param {{ pollAttempts?: number, pollIntervalMs?: number, label?: string }} [options]
 * @param {{ dispatchPrompt?: Function, fetchResult?: Function, sleep?: Function, generateCorrelationId?: Function }} [deps] - Test seam.
 * @returns {Promise<string|null>} The Rovo response text, or null when skipped.
 */
async function requestRovoText(configuration, prompt, options = {}, deps = {}) {
  const dispatch = deps.dispatchPrompt || dispatchPrompt;
  const poll = deps.fetchResult || fetchResult;
  const sleep = deps.sleep || delayMs;
  const newCorrelationId = deps.generateCorrelationId || (() => crypto.randomUUID());
  const attempts = options.pollAttempts || DEFAULT_POLL_ATTEMPTS;
  const intervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const label = options.label ? `${options.label} ` : '';

  if (!isRovoEnabled(configuration)) {
    return null; // not configured/enabled — silently skip
  }
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return null;
  }

  const correlationId = newCorrelationId();

  try {
    const dispatchResult = await dispatch(configuration, { correlationId, prompt });
    if (!dispatchResult || !dispatchResult.ok) {
      console.log(`  [Rovo] ${label}enrichment skipped (dispatch ${(dispatchResult && dispatchResult.code) || 'failed'})`);
      return null;
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await poll(configuration, correlationId);
      if (result && result.ok && result.ready && result.response) {
        return result.response;
      }
      // A hard error (not just "not ready yet") means stop polling and skip.
      if (result && result.ok === false) {
        console.log(`  [Rovo] ${label}enrichment skipped (result ${result.code || 'error'})`);
        return null;
      }
      if (attempt < attempts - 1) {
        await sleep(intervalMs);
      }
    }

    console.log(`  [Rovo] ${label}enrichment skipped (timeout)`);
    return null;
  } catch (enrichmentError) {
    const reason = enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
    console.log(`  [Rovo] ${label}enrichment skipped (${reason})`);
    return null;
  }
}

module.exports = { requestRovoText, isRovoEnabled };
