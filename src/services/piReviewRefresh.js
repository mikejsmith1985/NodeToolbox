// piReviewRefresh.js — The core of a single scheduled PI Review page refresh: fetch the Confluence
// page, re-pull the team's Features for its PI + Product Owner, reconcile the Jira-owned columns, and
// write the page back — preserving every human-curated column, capacity, boundary, grouping, and
// confidence vote. This is the manual "Save to Confluence" flow, run headless on the server. All I/O
// (Jira/Confluence request helpers, the DOM parser, the clock) is injected so it is fully testable,
// and it reuses the exact browser engine (bundled to CJS) so the two paths can never drift.

'use strict';

// The shared browser engine, bundled to CommonJS by `npm run build:pi-review-engine`. It is
// DOM-implementation-agnostic; the caller injects a DOMParser (linkedom on the server).
const defaultEngine = require('./generated/piReviewEngine.cjs');

// Fields the reconcile step reads from Jira — identical to the client's DEFAULT_LINK_FIELDS so the
// scheduled refresh and the manual save reconcile from the same data.
const RECONCILE_FIELDS = 'summary,priority,updated,status,labels,issuelinks,customfield_10111,duedate,fixVersions';
const FEATURE_KEY_BATCH_SIZE = 50;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 300;
const HTTP_CONFLICT = 409;
const MAX_WRITE_ATTEMPTS = 2; // one initial write + one retry on a version conflict
const DEFAULT_PI_FIELD_ID = 'customfield_10301';

/** Builds the structured run result the Admin Hub surfaces. */
function makeResult(status, pageUrlOrId, ranAtIso, message, extra) {
  return {
    status,
    pageUrlOrId,
    ranAtIso,
    message: message || '',
    featuresAppended: 0,
    rowsReconciled: 0,
    ...(extra || {}),
  };
}

/** True when an HTTP status is 2xx. */
function isSuccessStatus(httpStatus) {
  return httpStatus >= HTTP_OK_MIN && httpStatus < HTTP_OK_MAX;
}

/** Resolves a numeric Confluence page id from a raw id or a page URL; null when it cannot. */
function resolvePageId(pageReference) {
  const trimmedReference = String(pageReference || '').trim();
  if (trimmedReference === '') {
    return null;
  }
  if (/^\d+$/.test(trimmedReference)) {
    return trimmedReference;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedReference);
  } catch (_urlParseError) {
    return null;
  }
  const pageIdFromQuery = parsedUrl.searchParams.get('pageId');
  if (pageIdFromQuery && /^\d+$/.test(pageIdFromQuery.trim())) {
    return pageIdFromQuery.trim();
  }
  const pagePathMatch = parsedUrl.pathname.match(/\/pages\/(\d+)(?:\/|$)/i);
  return pagePathMatch ? pagePathMatch[1] : null;
}

/** GETs a Confluence page's version number, title, and storage body. */
async function fetchConfluencePage(deps, confluenceConfig, pageId, shouldVerifyTls) {
  const searchPath = `/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent('version,body.storage')}`;
  const response = await deps.makeConfluenceApiRequest('GET', searchPath, null, confluenceConfig, shouldVerifyTls);
  if (!response || !isSuccessStatus(response.status)) {
    throw new Error(`Confluence page fetch returned HTTP ${response && response.status}`);
  }
  const pageBody = response.body || {};
  return {
    title: pageBody.title || '',
    version: (pageBody.version && pageBody.version.number) || 0,
    storageValue: (pageBody.body && pageBody.body.storage && pageBody.body.storage.value) || '',
  };
}

/** Runs the PO + PI Feature query and returns discovered {key, summary} pairs. */
async function pullFeatures(deps, jiraConfig, featureJql, shouldVerifyTls) {
  const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(featureJql)}&fields=summary&maxResults=200`;
  const response = await deps.makeJiraApiRequest('GET', searchPath, null, jiraConfig, shouldVerifyTls);
  if (!response || !isSuccessStatus(response.status)) {
    throw new Error(`Jira feature query returned HTTP ${response && response.status}`);
  }
  const issues = (response.body && response.body.issues) || [];
  return issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields && typeof issue.fields.summary === 'string' ? issue.fields.summary : '',
  }));
}

/** Batch-fetches the Jira issues for the given keys, keyed by issue key. Failed batches are skipped. */
async function fetchIssueMap(deps, jiraConfig, featureKeys, shouldVerifyTls) {
  const issueMap = {};
  for (let batchStart = 0; batchStart < featureKeys.length; batchStart += FEATURE_KEY_BATCH_SIZE) {
    const batchKeys = featureKeys.slice(batchStart, batchStart + FEATURE_KEY_BATCH_SIZE);
    const batchJql = `key in (${batchKeys.join(',')})`;
    const searchPath = `/rest/api/2/search?jql=${encodeURIComponent(batchJql)}`
      + `&fields=${encodeURIComponent(RECONCILE_FIELDS)}&maxResults=${Math.max(200, batchKeys.length)}`;
    const response = await deps.makeJiraApiRequest('GET', searchPath, null, jiraConfig, shouldVerifyTls);
    if (response && isSuccessStatus(response.status)) {
      for (const issue of (response.body && response.body.issues) || []) {
        issueMap[issue.key] = issue;
      }
    }
  }
  return issueMap;
}

/** Turns a discovered Feature into an appended row whose feature cell carries "KEY - summary". */
function buildAppendedRow(engine, feature) {
  const newRow = engine.createEmptyPiReviewRow();
  const trimmedSummary = (feature.summary || '').trim();
  newRow.feature = trimmedSummary === '' ? feature.key : `${feature.key} - ${trimmedSummary}`;
  return newRow;
}

/**
 * Applies the refresh to one fetched page body: append newly-matched Features, reconcile the
 * Jira-owned columns for all rows, and rewrite the table + capacity — preserving everything else.
 * Returns the next storage HTML plus counts. Throws if the page has no recognizable PI Review table.
 */
async function applyRefresh(engine, deps, jiraConfig, storageValue, features, shouldVerifyTls) {
  const parsed = engine.parsePiReviewTable(storageValue);
  if (!parsed || !parsed.tableBinding) {
    throw new Error('No PI Review table found on the page.');
  }

  const existingKeys = new Set(
    parsed.rows
      .map((row) => engine.extractPiReviewFeatureKey(row.feature))
      .filter(Boolean)
      .map((featureKey) => featureKey.toUpperCase()),
  );
  const appendedRows = features
    .filter((feature) => !existingKeys.has(feature.key.toUpperCase()))
    .map((feature) => buildAppendedRow(engine, feature));

  const allRows = [...parsed.rows, ...appendedRows];
  const allKeys = allRows
    .map((row) => engine.extractPiReviewFeatureKey(row.feature))
    .filter(Boolean);
  const issueMap = await fetchIssueMap(deps, jiraConfig, allKeys, shouldVerifyTls);
  const reconciliation = engine.reconcilePiReviewRowsWithJira(allRows, issueMap);

  let nextStorage = engine.writePiReviewTable(
    storageValue,
    parsed.tableBinding,
    reconciliation.rows,
    parsed.commitmentBoundaryIndex,
    parsed.customGroupingLines,
  );
  // Preserve the existing capacity snapshot verbatim; the write also collapses any duplicate blocks
  // (FR-012). If the page has no real capacity snapshot, leave it untouched (never add a placeholder).
  const existingCapacity = engine.parsePiReviewCapacitySummary(storageValue);
  if (existingCapacity) {
    nextStorage = engine.writePiReviewCapacitySummary(nextStorage, existingCapacity);
  }

  return { nextStorage, featuresAppended: appendedRows.length, rowsReconciled: parsed.rows.length };
}

/** PUTs the rebuilt storage body with the next version number; returns the HTTP status. */
async function writeConfluencePage(deps, confluenceConfig, pageId, title, nextVersion, storageValue, shouldVerifyTls) {
  const payload = {
    id: pageId,
    type: 'page',
    title,
    version: { number: nextVersion },
    body: { storage: { value: storageValue, representation: 'storage' } },
  };
  const response = await deps.makeConfluenceApiRequest(
    'PUT',
    `/wiki/rest/api/content/${encodeURIComponent(pageId)}`,
    payload,
    confluenceConfig,
    shouldVerifyTls,
  );
  return response ? response.status : 0;
}

/**
 * Refreshes one configured PI Review page from Jira and saves it back to Confluence.
 * @returns {Promise<object>} a PiReviewRunResult (status/message/counts/timestamp).
 */
async function refreshPiReviewPage({ page, team, deps, configuration }) {
  const engine = deps.engine || defaultEngine;
  const now = () => (deps.nowIso ? deps.nowIso() : new Date().toISOString());
  const productOwner = String((team && team.productOwnerAssignee) || '').trim();
  const pageReference = String((page && page.pageUrlOrId) || '').trim();
  const piName = String((page && page.piName) || '').trim();
  const piFieldId = String((team && team.piFieldId) || '').trim() || DEFAULT_PI_FIELD_ID;
  const shouldVerifyTls = !(configuration && configuration.sslVerify === false);
  const confluenceConfig = (configuration && configuration.confluence) || {};
  const jiraConfig = (configuration && configuration.jira) || {};

  // Preconditions — fail/skip clearly rather than run an unscoped or unauthenticated query.
  if (!productOwner) {
    return makeResult('skipped', pageReference, now(), 'No Product Owner configured — run skipped.');
  }
  if (!confluenceConfig.baseUrl) {
    return makeResult('failed', pageReference, now(), 'Confluence not configured.');
  }
  const pageId = resolvePageId(pageReference);
  if (!pageId) {
    return makeResult('failed', pageReference, now(), 'PI Review page URL is invalid.');
  }
  const featureJql = engine.buildDirectFeatureJql(piName, [productOwner], piFieldId);
  if (!featureJql) {
    return makeResult('skipped', pageReference, now(), 'PI or Product Owner missing — cannot scope the pull.');
  }

  engine.setPiReviewDomParser(deps.domParser);

  // The Feature query is independent of the page version, so run it once.
  let features;
  try {
    features = await pullFeatures(deps, jiraConfig, featureJql, shouldVerifyTls);
  } catch (queryError) {
    return makeResult('failed', pageReference, now(), `Jira feature query failed: ${queryError.message}`);
  }
  if (features.length === 0) {
    return makeResult('no-op', pageReference, now(), 'No Features found for this PO and PI — page left unchanged.');
  }

  // Write with optimistic concurrency: GET → rebuild → PUT; retry once on a version conflict.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    let currentPage;
    let applied;
    try {
      currentPage = await fetchConfluencePage(deps, confluenceConfig, pageId, shouldVerifyTls);
      applied = await applyRefresh(engine, deps, jiraConfig, currentPage.storageValue, features, shouldVerifyTls);
    } catch (refreshError) {
      return makeResult('failed', pageReference, now(), refreshError.message);
    }

    const putStatus = await writeConfluencePage(
      deps, confluenceConfig, pageId, currentPage.title, currentPage.version + 1, applied.nextStorage, shouldVerifyTls,
    );

    if (isSuccessStatus(putStatus)) {
      const didNothing = applied.featuresAppended === 0 && applied.rowsReconciled === 0;
      return makeResult(
        didNothing ? 'no-op' : 'success',
        pageReference,
        now(),
        didNothing ? 'Nothing to update.' : '',
        { featuresAppended: applied.featuresAppended, rowsReconciled: applied.rowsReconciled },
      );
    }
    // Only a version conflict earns a retry; anything else fails immediately.
    if (putStatus === HTTP_CONFLICT && attempt + 1 < MAX_WRITE_ATTEMPTS) {
      continue;
    }
    const conflictMessage = putStatus === HTTP_CONFLICT
      ? 'Confluence version conflict — try again.'
      : `Confluence write returned HTTP ${putStatus}.`;
    return makeResult('failed', pageReference, now(), conflictMessage);
  }

  // Unreachable in practice (the loop always returns), but keeps the function total.
  return makeResult('failed', pageReference, now(), 'PI Review refresh did not complete.');
}

module.exports = { refreshPiReviewPage, resolvePageId };
