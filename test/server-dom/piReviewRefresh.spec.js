// piReviewRefresh.dom.spec.js — Invariant tests for the server-side PI Review refresh core. Runs on
// Node's native test runner with REAL linkedom (see the Jest/linkedom tooling note in tasks.md) and
// mocked Jira/Confluence request helpers, so the preserve-vs-refresh invariants are meaningful.
// Run: `npm run test:dom` (pretest builds the engine bundle first).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('linkedom');
const { refreshPiReviewPage } = require('../../src/services/piReviewRefresh.js');

const domParser = new DOMParser();
const NOW = '2026-07-14T18:00:00.000Z';
const TEAM = { productOwnerAssignee: 'C73130', piFieldId: 'customfield_10301' };
const PAGE = { pageUrlOrId: '12345', piName: 'PI 26.4' };

function config(overrides) {
  return {
    confluence: { baseUrl: 'https://acme.atlassian.net', username: 'u', apiToken: 't' },
    jira: { baseUrl: 'https://acme.atlassian.net', apiToken: 't' },
    sslVerify: true,
    ...(overrides || {}),
  };
}

// Build a PI Review page storage body with a capacity snapshot and the given data rows.
function pageStorage(dataRowsHtml) {
  return `
    <h1>NodeToolbox PI Review</h1>
    <h2>Team Capacity</h2>
    <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
    <p><strong>Plan:</strong> Existing Capacity</p>
    <p><strong>Date Range:</strong> 2026-05-21 to 2026-07-29</p>
    <p><strong>Work Days:</strong> 50</p>
    <p><strong>100% Capacity (pts):</strong> 549.5</p>
    <p><strong>80% Capacity (pts):</strong> 439</p>
    <ul><li><strong>Developer:</strong> 432 pts</li></ul>
    <table><tbody>
      <tr><th>YES - If this is a Carry-Over from a 26.2 Commit?</th><th>Priority</th><th>Feature</th>
      <th>Point Estimate</th><th>Dependency</th><th>Risks</th><th>Committed to PI?</th><th>Implementation Notes</th></tr>
      ${dataRowsHtml}
    </tbody></table>`;
}

function dataRow(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
}

// A mock deps object: Confluence GET returns the page; PUT returns queued statuses and records payloads.
// Jira: a "key in (...)" path returns the reconcile issue map; anything else returns the pulled features.
function makeMocks({ storageValue, features = [], issueMap = {}, putStatuses = [200] }) {
  const calls = { get: 0, put: 0, putPayloads: [], jiraPaths: [] };
  const makeConfluenceApiRequest = async (method, _path, body) => {
    if (method === 'GET') {
      calls.get += 1;
      return { status: 200, body: { title: 'PI Page', version: { number: 5 }, body: { storage: { value: storageValue } } } };
    }
    const status = putStatuses[Math.min(calls.put, putStatuses.length - 1)];
    calls.put += 1;
    calls.putPayloads.push(body);
    return { status, body: {} };
  };
  const makeJiraApiRequest = async (_method, path) => {
    calls.jiraPaths.push(path);
    if (path.includes('key%20in')) {
      return { status: 200, body: { issues: Object.keys(issueMap).map((key) => issueMap[key]) } };
    }
    return { status: 200, body: { issues: features.map((feature) => ({ key: feature.key, fields: { summary: feature.summary } })) } };
  };
  return { deps: { makeConfluenceApiRequest, makeJiraApiRequest, domParser, nowIso: () => NOW }, calls };
}

test('INV-1: an empty Feature query is a no-op — the page is never written or emptied', async () => {
  const { deps, calls } = makeMocks({
    storageValue: pageStorage(dataRow(['Yes', 'P1', 'ALPHA-9 - Kept Feature', '5', '', '', 'Yes', ''])),
    features: [],
  });

  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config() });

  assert.equal(result.status, 'no-op');
  assert.equal(calls.put, 0, 'must not PUT when there are no features');
  assert.match(result.message, /No Features found/);
});

test('INV-1b: features present but Jira produced no changes → no-op, no PUT (no idle version bump)', async () => {
  // The one feature is already on the page and Jira matches every reconciled cell exactly, so there
  // is nothing to append and nothing to change — the run must NOT write (would bump the page version).
  const unchangedRow = dataRow(['Yes', 'P1', 'ALPHA-1 - Feature One', '8', '', '', 'Yes', '']);
  const { deps, calls } = makeMocks({
    storageValue: pageStorage(unchangedRow),
    features: [{ key: 'ALPHA-1', summary: 'Feature One' }],
    issueMap: { 'ALPHA-1': { key: 'ALPHA-1', fields: { priority: { name: 'P1' }, customfield_10028: 8, issuelinks: [] } } },
  });

  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config() });

  assert.equal(result.status, 'no-op');
  assert.equal(calls.put, 0, 'must not PUT when nothing changed');
});

test('INV-2/INV-3: refreshes Jira-owned columns, preserves human-curated content + capacity', async () => {
  const existingRow = dataRow(['Yes', 'OLD-PRI', 'ALPHA-1 - Feature One', '8', 'ManualDep', 'ManualRisk', 'Committed', 'ManualNote']);
  const { deps, calls } = makeMocks({
    storageValue: pageStorage(existingRow),
    features: [{ key: 'ALPHA-1', summary: 'Feature One' }, { key: 'ALPHA-2', summary: 'Feature Two' }],
    issueMap: {
      'ALPHA-1': { key: 'ALPHA-1', fields: { summary: 'Feature One', priority: { name: 'P1' }, customfield_10028: 13, issuelinks: [] } },
      'ALPHA-2': { key: 'ALPHA-2', fields: { summary: 'Feature Two', priority: { name: 'P2' }, customfield_10028: 5, issuelinks: [] } },
    },
  });

  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config() });
  const written = calls.putPayloads[0].body.storage.value;

  assert.equal(result.status, 'success');
  assert.equal(result.featuresAppended, 1, 'ALPHA-2 appended');
  assert.equal(result.rowsReconciled, 1, 'ALPHA-1 reconciled');
  // Human-curated content preserved:
  assert.match(written, /ALPHA-1 - Feature One/, 'existing feature title untouched');
  assert.match(written, /Committed/, 'committed flag preserved');
  assert.match(written, /Existing Capacity/, 'capacity snapshot preserved');
  assert.match(written, /Manual/, 'manual carry-over/notes retained (dep/risk migrated into notes)');
  // Jira-owned columns refreshed + new feature appended:
  assert.match(written, />P1</, 'priority refreshed from Jira');
  assert.match(written, />13</, 'estimate refreshed from Jira');
  assert.match(written, /ALPHA-2 - Feature Two/, 'new feature appended');
  assert.doesNotMatch(written, /OLD-PRI/, 'stale priority replaced');
});

test('INV-5: a feature no longer matching the query is NOT removed; new one is appended once', async () => {
  const keptRow = dataRow(['No', 'P3', 'ALPHA-9 - Descoped But Kept', '3', '', '', '', '']);
  const { deps, calls } = makeMocks({
    storageValue: pageStorage(keptRow),
    features: [{ key: 'ALPHA-2', summary: 'Feature Two' }],
    issueMap: {
      'ALPHA-9': { key: 'ALPHA-9', fields: { priority: { name: 'P3' }, customfield_10028: 3, issuelinks: [] } },
      'ALPHA-2': { key: 'ALPHA-2', fields: { summary: 'Feature Two', priority: { name: 'P2' }, customfield_10028: 5, issuelinks: [] } },
    },
  });

  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config() });
  const written = calls.putPayloads[0].body.storage.value;

  assert.equal(result.status, 'success');
  assert.match(written, /ALPHA-9 - Descoped But Kept/, 'descoped row kept');
  // The feature cell renders as a hyperlink (key in href + full title as link text), so count the
  // full title — it appears once per appended row.
  assert.equal((written.match(/ALPHA-2 - Feature Two/g) || []).length, 1, 'appended exactly once');
});

test('INV-4: a version conflict retries once then succeeds (never clobbers)', async () => {
  const { deps, calls } = makeMocks({
    storageValue: pageStorage(dataRow(['', '', 'ALPHA-1 - One', '', '', '', '', ''])),
    features: [{ key: 'ALPHA-1', summary: 'One' }],
    issueMap: { 'ALPHA-1': { key: 'ALPHA-1', fields: { priority: { name: 'P1' }, customfield_10028: 8, issuelinks: [] } } },
    putStatuses: [409, 200],
  });

  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config() });

  assert.equal(result.status, 'success');
  assert.equal(calls.put, 2, 'PUT retried once');
  assert.equal(calls.get, 2, 're-fetched the newest version before retry');
});

test('INV-4: a persistent version conflict fails without clobbering', async () => {
  const { deps, calls } = makeMocks({
    storageValue: pageStorage(dataRow(['', '', 'ALPHA-1 - One', '', '', '', '', ''])),
    features: [{ key: 'ALPHA-1', summary: 'One' }],
    issueMap: { 'ALPHA-1': { key: 'ALPHA-1', fields: { priority: { name: 'P1' }, customfield_10028: 8, issuelinks: [] } } },
    putStatuses: [409, 409],
  });

  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config() });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /version conflict/i);
  assert.equal(calls.put, 2, 'exactly one retry then stop');
});

test('skip: no Product Owner configured → skipped, no writes', async () => {
  const { deps, calls } = makeMocks({ storageValue: pageStorage(''), features: [] });
  const result = await refreshPiReviewPage({ page: PAGE, team: { ...TEAM, productOwnerAssignee: '' }, deps, configuration: config() });
  assert.equal(result.status, 'skipped');
  assert.match(result.message, /No Product Owner/);
  assert.equal(calls.put, 0);
});

test('fail: Confluence not configured on the server → failed', async () => {
  const { deps } = makeMocks({ storageValue: pageStorage(''), features: [] });
  const result = await refreshPiReviewPage({ page: PAGE, team: TEAM, deps, configuration: config({ confluence: {} }) });
  assert.equal(result.status, 'failed');
  assert.match(result.message, /Confluence not configured/);
});

test('fail: invalid page reference → failed', async () => {
  const { deps } = makeMocks({ storageValue: pageStorage(''), features: [] });
  const result = await refreshPiReviewPage({ page: { pageUrlOrId: 'not-a-page', piName: 'PI 26.4' }, team: TEAM, deps, configuration: config() });
  assert.equal(result.status, 'failed');
  assert.match(result.message, /page URL is invalid/i);
});
