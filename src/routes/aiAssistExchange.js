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
  // Security: the webhook secret is NEVER returned, matching how /api/proxy-config reports its
  // credentials. The Admin Hub only needs to know WHETHER one is set in order to render the form, and a
  // config read that echoes a secret turns every reader of this endpoint into a way to lift it.
  router.get('/api/ai-assist/config', (req, res) => {
    const aiAssist = configuration.aiAssistAutomation || {};
    return res.json({
      webhookUrl:       aiAssist.webhookUrl      || '',
      hasWebhookSecret: !!aiAssist.webhookSecret,
      parkingSpaceKey:  aiAssist.parkingSpaceKey || '',
      parkingPageId:    aiAssist.parkingPageId   || '',
      isEnabled:        !!aiAssist.isEnabled,
    });
  });

  // POST /api/ai-assist/config — saves the AI Assist automation config to memory and disk.
  // Body: { webhookUrl, webhookSecret, parkingSpaceKey, parkingPageId, isEnabled }
  //
  // The secret MERGES rather than overwrites, mirroring /api/proxy-config. This pairs with the GET above:
  // since the form is never sent the existing secret, it cannot send one back, and a blind overwrite
  // would wipe the secret every time anyone saved an unrelated field. An omitted or blank secret
  // therefore means "leave it alone"; clearing one is an explicit action (see the clearWebhookSecret flag).
  router.post('/api/ai-assist/config', (req, res) => {
    const { webhookUrl, webhookSecret, parkingSpaceKey, parkingPageId, isEnabled, clearWebhookSecret } = req.body || {};
    const existingAiAssist = configuration.aiAssistAutomation || {};
    const suppliedSecret = typeof webhookSecret === 'string' ? webhookSecret.trim() : '';

    let resolvedWebhookSecret;
    if (clearWebhookSecret === true) {
      resolvedWebhookSecret = '';
    } else if (suppliedSecret !== '') {
      resolvedWebhookSecret = suppliedSecret;
    } else {
      resolvedWebhookSecret = existingAiAssist.webhookSecret || '';
    }

    configuration.aiAssistAutomation = {
      webhookUrl:      typeof webhookUrl      === 'string' ? webhookUrl.trim()      : '',
      webhookSecret:   resolvedWebhookSecret,
      parkingSpaceKey: typeof parkingSpaceKey === 'string' ? parkingSpaceKey.trim() : '',
      parkingPageId:   typeof parkingPageId   === 'string' ? parkingPageId.trim()   : '',
      isEnabled:       !!isEnabled,
    };
    saveConfigToDisk(configuration);

    // The response echoes the config back for the form to re-render from — with the secret withheld,
    // for the same reason the GET withholds it.
    return res.json({
      ok: true,
      config: {
        webhookUrl:       configuration.aiAssistAutomation.webhookUrl,
        hasWebhookSecret: !!configuration.aiAssistAutomation.webhookSecret,
        parkingSpaceKey:  configuration.aiAssistAutomation.parkingSpaceKey,
        parkingPageId:    configuration.aiAssistAutomation.parkingPageId,
        isEnabled:        configuration.aiAssistAutomation.isEnabled,
      },
    });
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
