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
 * Extracts this request's response from a static parking page's text. The rule
 * stamps a "correlationId: <id>" marker line into the page; we only accept the
 * body when that marker matches THIS request (so a stale/previous result is
 * ignored), and we strip the marker line so the surface's parser gets clean output.
 *
 * @param {string} pageText - Plain-text body of the parking page.
 * @param {string} correlationId - The id we are waiting for.
 * @returns {string|null} The cleaned response, or null when the page is not yet ours.
 */
function extractStaticResult(pageText, correlationId) {
  if (!pageText || !pageText.includes(correlationId)) {
    return null;
  }
  return pageText
    .split('\n')
    .filter((line) => !line.trimStart().toLowerCase().startsWith('correlationid:'))
    .join('\n')
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
  if (!rovo.parkingPageId && !rovo.parkingSpaceKey) {
    return { ok: false, httpStatus: 409, code: 'not-configured', message: 'Rovo parking page or space is not configured.' };
  }

  const confluenceConfig = (configuration && configuration.confluence) || {};
  const shouldVerify = shouldVerifyTls(configuration);

  // Preferred: a fixed "parking page" the rule edits each run. Fetching by id is a
  // direct lookup (no search index, no space-scoped query), so it works even in a
  // personal ("~") space where the content search returns nothing. The rule stamps
  // the correlationId into the body so we only accept the result for THIS request.
  if (rovo.parkingPageId) {
    try {
      const page = await confluenceRequest('GET', `/wiki/rest/api/content/${encodeURIComponent(rovo.parkingPageId)}?expand=body.storage`, null, confluenceConfig, shouldVerify);
      const rawBody = (((page || {}).body || {}).storage || {}).value || '';
      const freshResponse = extractStaticResult(stripStorageHtml(rawBody), correlationId);
      console.log(`  [Rovo] result lookup [page ${rovo.parkingPageId}] correlationId present: ${freshResponse !== null}`);
      if (freshResponse === null) {
        return { ok: true, httpStatus: 200, ready: false };
      }
      return { ok: true, httpStatus: 200, ready: true, response: freshResponse };
    } catch (pageError) {
      const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
      console.error(`  [Rovo] result lookup FAILED (page ${rovo.parkingPageId}): ${errorMessage}`);
      return { ok: false, httpStatus: 502, code: 'fetch-failed', message: `Failed to read Rovo parking page: ${errorMessage}` };
    }
  }

  const title = PARKING_TITLE_PREFIX + correlationId;

  // The parking page title is a unique UUID, so several lookups can find it.
  // Confluence's `spaceKey + title` filter does not reliably return pages in a
  // personal ("~") space, so we also try a global title search and a space
  // listing, always matching the exact title in code. First strategy that finds
  // it wins; each is logged so the working path is visible in Server Logs.
  const lookupStrategies = [
    { name: 'global-title', path: `/wiki/rest/api/content?title=${encodeURIComponent(title)}&type=page&expand=body.storage&limit=10` },
    { name: 'space-listing', path: `/wiki/rest/api/content?spaceKey=${encodeURIComponent(rovo.parkingSpaceKey)}&type=page&expand=body.storage&limit=100` },
  ];

  try {
    for (const strategy of lookupStrategies) {
      const searchResult = await confluenceRequest('GET', strategy.path, null, confluenceConfig, shouldVerify);
      const pages = (searchResult && searchResult.results) || [];
      const matched = pages.find((candidate) => candidate.title === title);
      console.log(`  [Rovo] result lookup [${strategy.name}] title="${title}" → ${pages.length} page(s), ${matched ? 'MATCH' : 'no match'}`);

      if (matched) {
        const rawBody = ((matched.body || {}).storage || {}).value || '';
        const responseText = stripStorageHtml(rawBody);
        // Ephemeral: delete the parking page once read. Best-effort — a failed
        // delete must not block returning the result to the caller.
        confluenceRequest('DELETE', `/wiki/rest/api/content/${matched.id}`, null, confluenceConfig, shouldVerify).catch(() => {});
        return { ok: true, httpStatus: 200, ready: true, response: responseText };
      }
    }

    return { ok: true, httpStatus: 200, ready: false };
  } catch (fetchError) {
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`  [Rovo] result lookup FAILED title="${title}": ${errorMessage}`);
    return { ok: false, httpStatus: 502, code: 'fetch-failed', message: `Failed to read Rovo result: ${errorMessage}` };
  }
}

module.exports = { dispatchPrompt, fetchResult, stripStorageHtml, extractStaticResult, PARKING_TITLE_PREFIX };
