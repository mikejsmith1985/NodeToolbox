// src/services/aiAssistEnrichment.js — Shared, non-blocking server-side AI Assist text request.
//
// Schedulers (standup briefing, scope-change, feature-change) and the hygiene
// monitor all need the same thing: send a prompt to AI Assist via the existing
// dispatch-and-poll exchange and get the response text back — but NEVER let a slow
// or unavailable AI Assist block or fail the surrounding report. This helper wraps
// `dispatchPrompt` + `fetchResult` with a bounded poll and a non-throwing `null`
// fallback so callers can treat AI Assist purely as an optional enrichment.

'use strict';

const crypto = require('crypto');
const { dispatchPrompt, fetchResult } = require('./aiAssistExchange');

// Bounded poll budget. Default ≈6s (3 × 3s) — a report must never be held hostage by a
// slow or dead AI Assist backend. When Rovo is turned off nothing ever writes the parking
// page, so every attempt times out; keeping the budget small means that costs ~6s, not
// ~60s, per report. A caller (or a future Copilot-backed setup) can pass a larger
// `pollAttempts` if its backend genuinely needs longer to answer.
const DEFAULT_POLL_ATTEMPTS = 3;
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Resolves after the given delay. Extracted so the poll is injectable in tests. */
function delayMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Reports whether AI Assist enrichment is configured and turned on. Enrichment is opt-in
 * via the existing `aiAssistAutomation.isEnabled` flag and requires a webhook URL.
 *
 * @param {object} configuration - Live server config.
 * @returns {boolean} True when a scheduler may attempt AI Assist enrichment.
 */
function isAiAssistEnabled(configuration) {
  const aiAssist = (configuration && configuration.aiAssistAutomation) || {};
  return !!aiAssist.isEnabled && !!aiAssist.webhookUrl;
}

/**
 * Sends a prompt to AI Assist and returns the response text, or `null` on any
 * failure/timeout. NEVER throws — the caller proceeds without the AI Assist block when
 * this returns null, so an AI Assist outage cannot break report delivery (SC-008).
 *
 * @param {object} configuration - Live server config (aiAssistAutomation + confluence + sslVerify).
 * @param {string} prompt - The prompt to send to AI Assist.
 * @param {{ pollAttempts?: number, pollIntervalMs?: number, label?: string }} [options]
 * @param {{ dispatchPrompt?: Function, fetchResult?: Function, sleep?: Function, generateCorrelationId?: Function }} [deps] - Test seam.
 * @returns {Promise<string|null>} The AI Assist response text, or null when skipped.
 */
async function requestAiAssistText(configuration, prompt, options = {}, deps = {}) {
  const dispatch = deps.dispatchPrompt || dispatchPrompt;
  const poll = deps.fetchResult || fetchResult;
  const sleep = deps.sleep || delayMs;
  const newCorrelationId = deps.generateCorrelationId || (() => crypto.randomUUID());
  const attempts = options.pollAttempts || DEFAULT_POLL_ATTEMPTS;
  const intervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  const label = options.label ? `${options.label} ` : '';

  if (!isAiAssistEnabled(configuration)) {
    return null; // not configured/enabled — silently skip
  }
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return null;
  }

  const correlationId = newCorrelationId();

  try {
    const dispatchResult = await dispatch(configuration, { correlationId, prompt });
    if (!dispatchResult || !dispatchResult.ok) {
      console.log(`  [AI Assist] ${label}enrichment skipped (dispatch ${(dispatchResult && dispatchResult.code) || 'failed'})`);
      return null;
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await poll(configuration, correlationId);
      if (result && result.ok && result.ready && result.response) {
        return result.response;
      }
      // A hard error (not just "not ready yet") means stop polling and skip.
      if (result && result.ok === false) {
        console.log(`  [AI Assist] ${label}enrichment skipped (result ${result.code || 'error'})`);
        return null;
      }
      if (attempt < attempts - 1) {
        await sleep(intervalMs);
      }
    }

    console.log(`  [AI Assist] ${label}enrichment skipped (timeout)`);
    return null;
  } catch (enrichmentError) {
    const reason = enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
    console.log(`  [AI Assist] ${label}enrichment skipped (${reason})`);
    return null;
  }
}

module.exports = { requestAiAssistText, isAiAssistEnabled };
