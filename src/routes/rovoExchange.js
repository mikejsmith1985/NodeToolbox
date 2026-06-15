// src/routes/rovoExchange.js — Endpoints for the automated Rovo prompt exchange.
//
// POST /api/rovo/dispatch  — send a generated prompt + correlationId to the Rovo webhook.
// GET  /api/rovo/result    — poll for Rovo's deterministic response by correlationId.
//
// These remove the manual copy-paste step from the hidden Rovo workflow; the client
// dispatches the prompt, polls for the result, then feeds it to the surface's
// existing response parser.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { dispatchPrompt, fetchResult } = require('../services/rovoExchange');

/**
 * Creates and returns the Rovo exchange router.
 *
 * @param {object} configuration - Live server config reference.
 * @returns {import('express').Router}
 */
function createRovoExchangeRouter(configuration) {
  const router = express.Router();

  // GET /api/rovo/config — returns the Rovo automation config. The config lives
  // behind the passphrase-gated Admin Hub section.
  router.get('/api/rovo/config', (req, res) => {
    const rovo = configuration.rovoAutomation || {};
    return res.json({
      webhookUrl:      rovo.webhookUrl      || '',
      webhookSecret:   rovo.webhookSecret   || '',
      parkingSpaceKey: rovo.parkingSpaceKey || '',
      isEnabled:       !!rovo.isEnabled,
    });
  });

  // POST /api/rovo/config — saves the Rovo automation config to memory and disk.
  // Body: { webhookUrl, webhookSecret, parkingSpaceKey, isEnabled }
  router.post('/api/rovo/config', (req, res) => {
    const { webhookUrl, webhookSecret, parkingSpaceKey, isEnabled } = req.body || {};
    configuration.rovoAutomation = {
      webhookUrl:      typeof webhookUrl      === 'string' ? webhookUrl.trim()      : '',
      webhookSecret:   typeof webhookSecret   === 'string' ? webhookSecret.trim()   : '',
      parkingSpaceKey: typeof parkingSpaceKey === 'string' ? parkingSpaceKey.trim() : '',
      isEnabled:       !!isEnabled,
    };
    saveConfigToDisk(configuration);
    return res.json({ ok: true, config: configuration.rovoAutomation });
  });

  // POST /api/rovo/dispatch — Body: { correlationId: string, prompt: string }
  router.post('/api/rovo/dispatch', async (req, res) => {
    const { correlationId, prompt } = req.body || {};
    const result = await dispatchPrompt(configuration, { correlationId, prompt });

    // Log correlation + status only — never the prompt body or the secret.
    const loggedStatus = result.webhookStatus || result.httpStatus;
    console.log(`  [Rovo] dispatch ${correlationId || '?'} → ${result.code} (HTTP ${loggedStatus})`);

    return res.status(result.httpStatus).json({ ok: result.ok, status: result.webhookStatus, message: result.message });
  });

  // GET /api/rovo/result?correlationId=... — returns { ready, response } or a not-ready poll.
  router.get('/api/rovo/result', async (req, res) => {
    const correlationId = (req.query || {}).correlationId;
    const result = await fetchResult(configuration, correlationId);

    return res.status(result.httpStatus).json({
      ok: result.ok,
      ready: result.ready || false,
      response: result.response,
      message: result.message,
    });
  });

  return router;
}

module.exports = createRovoExchangeRouter;
