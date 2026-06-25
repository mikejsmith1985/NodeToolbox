// src/routes/aiAssistExchange.js — Endpoints for the automated AI Assist prompt exchange.
//
// POST /api/ai-assist/dispatch  — send a generated prompt + correlationId to the AI Assist webhook.
// GET  /api/ai-assist/result    — poll for AI Assist's deterministic response by correlationId.
//
// These remove the manual copy-paste step from the hidden AI Assist workflow; the client
// dispatches the prompt, polls for the result, then feeds it to the surface's
// existing response parser.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { dispatchPrompt, fetchResult } = require('../services/aiAssistExchange');

/**
 * Creates and returns the AI Assist exchange router.
 *
 * @param {object} configuration - Live server config reference.
 * @returns {import('express').Router}
 */
function createAiAssistExchangeRouter(configuration) {
  const router = express.Router();

  // GET /api/ai-assist/config — returns the AI Assist automation config. The config lives
  // behind the passphrase-gated Admin Hub section.
  router.get('/api/ai-assist/config', (req, res) => {
    const aiAssist = configuration.aiAssistAutomation || {};
    return res.json({
      webhookUrl:      aiAssist.webhookUrl      || '',
      webhookSecret:   aiAssist.webhookSecret   || '',
      parkingSpaceKey: aiAssist.parkingSpaceKey || '',
      parkingPageId:   aiAssist.parkingPageId   || '',
      isEnabled:       !!aiAssist.isEnabled,
    });
  });

  // POST /api/ai-assist/config — saves the AI Assist automation config to memory and disk.
  // Body: { webhookUrl, webhookSecret, parkingSpaceKey, isEnabled }
  router.post('/api/ai-assist/config', (req, res) => {
    const { webhookUrl, webhookSecret, parkingSpaceKey, parkingPageId, isEnabled } = req.body || {};
    configuration.aiAssistAutomation = {
      webhookUrl:      typeof webhookUrl      === 'string' ? webhookUrl.trim()      : '',
      webhookSecret:   typeof webhookSecret   === 'string' ? webhookSecret.trim()   : '',
      parkingSpaceKey: typeof parkingSpaceKey === 'string' ? parkingSpaceKey.trim() : '',
      parkingPageId:   typeof parkingPageId   === 'string' ? parkingPageId.trim()   : '',
      isEnabled:       !!isEnabled,
    };
    saveConfigToDisk(configuration);
    return res.json({ ok: true, config: configuration.aiAssistAutomation });
  });

  // POST /api/ai-assist/dispatch — Body: { correlationId: string, prompt: string }
  router.post('/api/ai-assist/dispatch', async (req, res) => {
    const { correlationId, prompt } = req.body || {};
    const result = await dispatchPrompt(configuration, { correlationId, prompt });

    // Log correlation + status only — never the prompt body or the secret.
    const loggedStatus = result.webhookStatus || result.httpStatus;
    console.log(`  [AI Assist] dispatch ${correlationId || '?'} → ${result.code} (HTTP ${loggedStatus})`);

    return res.status(result.httpStatus).json({ ok: result.ok, status: result.webhookStatus, message: result.message });
  });

  // GET /api/ai-assist/result?correlationId=... — returns { ready, response } or a not-ready poll.
  router.get('/api/ai-assist/result', async (req, res) => {
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

module.exports = createAiAssistExchangeRouter;
