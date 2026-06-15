// src/services/rovoExchange.js — Server-mediated Rovo prompt exchange.
//
// Replaces the manual copy-paste in the hidden Rovo workflow: NodeToolbox POSTs a
// generated prompt + correlationId to the configured Atlassian Automation/Rovo
// webhook, then later reads Rovo's deterministic response back from a Confluence
// "parking" page keyed by that correlationId (write → read → delete). The caller
// feeds the returned text into the surface's existing response parser.
//
// Unlike report delivery, the prompt is NOT redacted — the Jira content it carries
// is exactly what the user wants Rovo to process. The Atlassian-host allow-list
// still applies so the prompt can only go to an Atlassian destination.

'use strict';

const { triggerWebhook, makeConfluenceApiRequest } = require('../utils/httpClient');
const { evaluateHost } = require('../utils/webhookHostPolicy');

/** Title prefix for the per-request Confluence parking page. */
const PARKING_TITLE_PREFIX = 'rovo-result-';

function getRovoConfig(configuration) {
  return (configuration && configuration.rovoAutomation) || {};
}

function shouldVerifyTls(configuration) {
  return !configuration || configuration.sslVerify !== false;
}

/**
 * Dispatches a generated prompt to the configured Rovo automation webhook.
 *
 * @param {object} configuration - Live server config (holds rovoAutomation + sslVerify).
 * @param {{ correlationId: string, prompt: string }} request
 * @param {{ triggerWebhook?: Function }} [deps] - Test seam.
 * @returns {Promise<object>} Structured result with httpStatus + code + message.
 */
async function dispatchPrompt(configuration, request, deps = {}) {
  const { correlationId, prompt } = request || {};
  const sendWebhook = deps.triggerWebhook || triggerWebhook;

  if (!correlationId || typeof correlationId !== 'string') {
    return { ok: false, httpStatus: 400, code: 'bad-correlation', message: 'correlationId is required.' };
  }
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return { ok: false, httpStatus: 400, code: 'empty-prompt', message: 'prompt is required.' };
  }

  const rovo = getRovoConfig(configuration);
  if (!rovo.webhookUrl) {
    return { ok: false, httpStatus: 409, code: 'not-configured', message: 'Rovo automation webhook is not configured.' };
  }

  const hostCheck = evaluateHost(rovo.webhookUrl);
  if (!hostCheck.allowed) {
    return { ok: false, httpStatus: 422, code: 'host-not-allowed', message: hostCheck.reason };
  }

  try {
    const result = await sendWebhook(rovo.webhookUrl, { correlationId, prompt }, shouldVerifyTls(configuration), rovo.webhookSecret || undefined);
    const webhookStatus = result && result.status;
    const isSuccess = webhookStatus >= 200 && webhookStatus < 300;
    if (isSuccess) {
      return { ok: true, httpStatus: 200, webhookStatus, code: 'dispatched', message: `Dispatched to Rovo (HTTP ${webhookStatus}).` };
    }
    return { ok: false, httpStatus: 502, webhookStatus, code: 'webhook-rejected', message: `Rovo webhook rejected the request (HTTP ${webhookStatus}).` };
  } catch (dispatchError) {
    const errorMessage = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
    return { ok: false, httpStatus: 502, code: 'dispatch-failed', message: `Rovo dispatch failed: ${errorMessage}` };
  }
}

/**
 * Reduces Confluence storage-format HTML to the plain-text response body so the
 * surface's existing parser can read the deterministic "KEY: value" lines.
 */
function stripStorageHtml(storageHtml) {
  return String(storageHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Reads Rovo's response for a correlationId from the Confluence parking page.
 * Returns ready:false while the page does not exist yet; on success returns the
 * plain-text response and deletes the page (ephemeral, best-effort).
 *
 * @param {object} configuration
 * @param {string} correlationId
 * @param {{ makeConfluenceApiRequest?: Function }} [deps] - Test seam.
 * @returns {Promise<object>} { ok, httpStatus, ready, response?, message? }
 */
async function fetchResult(configuration, correlationId, deps = {}) {
  const confluenceRequest = deps.makeConfluenceApiRequest || makeConfluenceApiRequest;

  if (!correlationId || typeof correlationId !== 'string') {
    return { ok: false, httpStatus: 400, code: 'bad-correlation', message: 'correlationId is required.' };
  }

  const rovo = getRovoConfig(configuration);
  if (!rovo.parkingSpaceKey) {
    return { ok: false, httpStatus: 409, code: 'not-configured', message: 'Rovo parking space is not configured.' };
  }

  const confluenceConfig = (configuration && configuration.confluence) || {};
  const title = PARKING_TITLE_PREFIX + correlationId;
  const searchPath = `/wiki/rest/api/content?spaceKey=${encodeURIComponent(rovo.parkingSpaceKey)}&title=${encodeURIComponent(title)}&expand=body.storage`;

  try {
    const searchResult = await confluenceRequest('GET', searchPath, null, confluenceConfig, shouldVerifyTls(configuration));
    const pages = (searchResult && searchResult.results) || [];
    if (pages.length === 0) {
      return { ok: true, httpStatus: 200, ready: false };
    }

    const page = pages[0];
    const rawBody = ((page.body || {}).storage || {}).value || '';
    const responseText = stripStorageHtml(rawBody);

    // Ephemeral: delete the parking page once read. Best-effort — a failed delete
    // must not block returning the result to the caller.
    confluenceRequest('DELETE', `/wiki/rest/api/content/${page.id}`, null, confluenceConfig, shouldVerifyTls(configuration)).catch(() => {});

    return { ok: true, httpStatus: 200, ready: true, response: responseText };
  } catch (fetchError) {
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    return { ok: false, httpStatus: 502, code: 'fetch-failed', message: `Failed to read Rovo result: ${errorMessage}` };
  }
}

module.exports = { dispatchPrompt, fetchResult, stripStorageHtml, PARKING_TITLE_PREFIX };
