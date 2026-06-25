// src/services/aiAssistExchange.js — Server-mediated AI Assist prompt exchange.
//
// Replaces the manual copy-paste in the hidden AI Assist workflow: NodeToolbox POSTs a
// generated prompt + correlationId to the configured Atlassian Automation/AI Assist
// webhook, then later reads AI Assist's deterministic response back from a Confluence
// "parking" page keyed by that correlationId (write → read → delete). The caller
// feeds the returned text into the surface's existing response parser.
//
// Unlike report delivery, the prompt is NOT redacted — the Jira content it carries
// is exactly what the user wants AI Assist to process. The Atlassian-host allow-list
// still applies so the prompt can only go to an Atlassian destination.

'use strict';

const { triggerWebhook, makeConfluenceApiRequest } = require('../utils/httpClient');
const { evaluateHost } = require('../utils/webhookHostPolicy');

// Title prefix for the per-request Confluence parking page. The literal value
// 'rovo-result-' is an external Atlassian Automation contract and is preserved
// exactly for compatibility — do NOT rename the value even though the feature is
// now called "AI Assist".
const PARKING_TITLE_PREFIX = 'rovo-result-';

function getAiAssistConfig(configuration) {
  return (configuration && configuration.aiAssistAutomation) || {};
}

function shouldVerifyTls(configuration) {
  return !configuration || configuration.sslVerify !== false;
}

/**
 * Dispatches a generated prompt to the configured AI Assist automation webhook.
 *
 * @param {object} configuration - Live server config (holds aiAssistAutomation + sslVerify).
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

  const aiAssist = getAiAssistConfig(configuration);
  if (!aiAssist.webhookUrl) {
    return { ok: false, httpStatus: 409, code: 'not-configured', message: 'AI Assist automation webhook is not configured.' };
  }

  const hostCheck = evaluateHost(aiAssist.webhookUrl);
  if (!hostCheck.allowed) {
    return { ok: false, httpStatus: 422, code: 'host-not-allowed', message: hostCheck.reason };
  }

  try {
    const result = await sendWebhook(aiAssist.webhookUrl, { correlationId, prompt }, shouldVerifyTls(configuration), aiAssist.webhookSecret || undefined);
    const webhookStatus = result && result.status;
    const isSuccess = webhookStatus >= 200 && webhookStatus < 300;
    if (isSuccess) {
      return { ok: true, httpStatus: 200, webhookStatus, code: 'dispatched', message: `Dispatched to AI Assist (HTTP ${webhookStatus}).` };
    }
    return { ok: false, httpStatus: 502, webhookStatus, code: 'webhook-rejected', message: `AI Assist webhook rejected the request (HTTP ${webhookStatus}).` };
  } catch (dispatchError) {
    const errorMessage = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
    return { ok: false, httpStatus: 502, code: 'dispatch-failed', message: `AI Assist dispatch failed: ${errorMessage}` };
  }
}

/**
 * Reduces Confluence storage-format HTML to the plain-text response body so the
 * surface's existing parser can read the deterministic "KEY: value" lines.
 */
function stripStorageHtml(storageHtml) {
  return String(storageHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n') // block tags end a line in the rendered view too
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ') // rendered view uses non-breaking spaces between label and value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Unwraps the Confluence JSON payload from makeConfluenceApiRequest's response.
 *
 * The shared HTTP helper resolves `{ status, body: <Confluence JSON> }` — the real
 * page/search object is nested under `.body`. (The working schedulers read it the
 * same way, e.g. `result.body.body.storage.value`.) Tests may inject the Confluence
 * JSON directly, so we detect the envelope by its numeric `status` and pass other
 * shapes through unchanged.
 *
 * @param {object} response - The value returned by the confluence request function.
 * @returns {object} The Confluence JSON payload (page or search result).
 */
function unwrapConfluence(response) {
  if (response && typeof response.status === 'number' && response.body && typeof response.body === 'object') {
    return response.body;
  }
  return response || {};
}

/** True when a line is a "correlationId: <id>" marker stamped by the AI Assist rule. */
function isCorrelationMarker(line) {
  return line.trimStart().toLowerCase().startsWith('correlationid:');
}

/**
 * Lists the correlationId value(s) actually stamped on a parking page. Used only
 * for diagnostics: comparing what we are waiting for against what the page holds
 * instantly distinguishes a wrong-page-id (no markers found) from a stale-result
 * (a different id found) when a "Run via AI Assist (auto)" times out.
 *
 * @param {string} pageText - Plain-text body of the parking page.
 * @returns {string[]} The id portion of every correlationId marker line found.
 */
function listCorrelationMarkers(pageText) {
  if (!pageText) {
    return [];
  }
  return pageText
    .split('\n')
    .filter(isCorrelationMarker)
    .map((line) => line.slice(line.indexOf(':') + 1).trim())
    .filter(Boolean);
}

/**
 * Extracts this request's response from the parking page's text.
 *
 * The Confluence rule stamps a "correlationId: <id>" marker line ahead of AI Assist's
 * output. When the rule *appends* (rather than replaces), the page accumulates
 * one marked block per run, so we must return ONLY the block belonging to THIS
 * request and ignore older results. We locate this request's marker line and
 * return everything between it and the next marker (or end of page); the marker
 * line itself is dropped so the surface's parser receives clean "KEY: value" text.
 * Returns null when this request's marker is not on the page yet (still pending).
 *
 * @param {string} pageText - Plain-text body of the parking page.
 * @param {string} correlationId - The id we are waiting for.
 * @returns {string|null} The cleaned response for this request, or null when not present.
 */
function extractStaticResult(pageText, correlationId) {
  if (!pageText) {
    return null;
  }

  const lines = pageText.split('\n');

  // Find this request's marker. If the page accumulates multiple runs, take the
  // last occurrence of our id so a re-run supersedes any earlier identical block.
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isCorrelationMarker(lines[i]) && lines[i].includes(correlationId)) {
      blockStart = i + 1; // response text begins on the line after the marker
    }
  }
  if (blockStart === -1) {
    return null; // our result has not been written to the page yet
  }

  // Collect lines until the next run's marker (start of a later block) or the end.
  const blockLines = [];
  for (let i = blockStart; i < lines.length; i++) {
    if (isCorrelationMarker(lines[i])) {
      break;
    }
    blockLines.push(lines[i]);
  }
  return blockLines.join('\n').trim();
}

/**
 * Reads AI Assist's response for a correlationId from the Confluence parking page.
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

  const aiAssist = getAiAssistConfig(configuration);
  if (!aiAssist.parkingPageId && !aiAssist.parkingSpaceKey) {
    return { ok: false, httpStatus: 409, code: 'not-configured', message: 'AI Assist parking page or space is not configured.' };
  }

  const confluenceConfig = (configuration && configuration.confluence) || {};
  const shouldVerify = shouldVerifyTls(configuration);

  // Preferred: a fixed "parking page" the rule edits each run. Fetching by id is a
  // direct lookup (no search index, no space-scoped query), so it works even in a
  // personal ("~") space where the content search returns nothing. The rule stamps
  // the correlationId into the body so we only accept the result for THIS request.
  if (aiAssist.parkingPageId) {
    try {
      // Request BOTH the legacy storage body and the rendered view body. Pages
      // authored in Confluence's modern (ADF) editor often return an EMPTY
      // body.storage while their text is only present in body.view, so we fall
      // back to the rendered body when storage comes back blank.
      const page = await confluenceRequest('GET', `/wiki/rest/api/content/${encodeURIComponent(aiAssist.parkingPageId)}?expand=body.storage,body.view`, null, confluenceConfig, shouldVerify);
      // The page's content lives at <confluenceJson>.body.storage / .body.view.
      const contentBody = (unwrapConfluence(page).body) || {};
      const storageBody = ((contentBody.storage || {}).value) || '';
      const viewBody = ((contentBody.view || {}).value) || '';
      const usedView = storageBody.trim() === '' && viewBody.trim() !== '';
      const pageText = stripStorageHtml(usedView ? viewBody : storageBody);
      const freshResponse = extractStaticResult(pageText, correlationId);
      // Log what we want vs what the page holds: no markers found ⇒ wrong page id
      // or the rule writes elsewhere; a different id ⇒ a stale/previous result.
      const markersOnPage = listCorrelationMarkers(pageText);
      console.log(`  [AI Assist] result lookup [page ${aiAssist.parkingPageId}] want=${correlationId} page-has=[${markersOnPage.join(', ') || 'none'}] source=${usedView ? 'view' : 'storage'} match=${freshResponse !== null}`);
      if (freshResponse === null) {
        // No marker matched. Dump the storage/view lengths and a snippet so we can
        // see whether the page is empty in BOTH representations (an unpublished
        // draft) or just in storage (handled by the view fallback above).
        console.log(`  [AI Assist] page ${aiAssist.parkingPageId} read: storage=${storageBody.length}B view=${viewBody.length}B stripped=${pageText.length}B snippet=${JSON.stringify(pageText.slice(0, 300))}`);
        return { ok: true, httpStatus: 200, ready: false };
      }
      return { ok: true, httpStatus: 200, ready: true, response: freshResponse };
    } catch (pageError) {
      const errorMessage = pageError instanceof Error ? pageError.message : String(pageError);
      console.error(`  [AI Assist] result lookup FAILED (page ${aiAssist.parkingPageId}): ${errorMessage}`);
      return { ok: false, httpStatus: 502, code: 'fetch-failed', message: `Failed to read AI Assist parking page: ${errorMessage}` };
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
    { name: 'space-listing', path: `/wiki/rest/api/content?spaceKey=${encodeURIComponent(aiAssist.parkingSpaceKey)}&type=page&expand=body.storage&limit=100` },
  ];

  try {
    for (const strategy of lookupStrategies) {
      const searchResult = await confluenceRequest('GET', strategy.path, null, confluenceConfig, shouldVerify);
      const pages = (unwrapConfluence(searchResult).results) || [];
      const matched = pages.find((candidate) => candidate.title === title);
      console.log(`  [AI Assist] result lookup [${strategy.name}] title="${title}" → ${pages.length} page(s), ${matched ? 'MATCH' : 'no match'}`);

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
    console.error(`  [AI Assist] result lookup FAILED title="${title}": ${errorMessage}`);
    return { ok: false, httpStatus: 502, code: 'fetch-failed', message: `Failed to read AI Assist result: ${errorMessage}` };
  }
}

module.exports = { dispatchPrompt, fetchResult, stripStorageHtml, extractStaticResult, listCorrelationMarkers, PARKING_TITLE_PREFIX };
