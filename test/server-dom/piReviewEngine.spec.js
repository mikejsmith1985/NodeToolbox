// piReviewEngine.domtest.js — Proves the shared PI Review save engine runs server-side under the REAL
// production headless DOM (linkedom). Runs on Node's native test runner (`node --test`), not Jest,
// because linkedom's transitive `css-select` ships ESM that Jest's CommonJS runtime cannot load —
// whereas Node loads it natively. Run: `npm run test:dom` (after `npm run build:pi-review-engine`).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('linkedom');
const engine = require('../../src/services/generated/piReviewEngine.cjs');

// Inject linkedom's DOMParser so the engine's buildStorageDocument uses it instead of the absent browser one.
engine.setPiReviewDomParser(new DOMParser());

// A minimal but structurally-real PI Review page: intro, ONE capacity block, and the 8-column table.
const PI_REVIEW_STORAGE = `
  <h1>NodeToolbox PI Review</h1>
  <p>This page section is managed by NodeToolbox so PI Review data can sync reliably.</p>
  <h2>Team Capacity</h2>
  <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
  <p><strong>Plan:</strong> Existing Capacity</p>
  <p><strong>Date Range:</strong> 2026-05-21 to 2026-07-29</p>
  <p><strong>Work Days:</strong> 50</p>
  <p><strong>100% Capacity (pts):</strong> 549.5</p>
  <p><strong>80% Capacity (pts):</strong> 439</p>
  <ul><li><strong>Developer:</strong> 432 pts</li></ul>
  <table>
    <tbody>
      <tr>
        <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
        <th>Priority</th>
        <th>Feature</th>
        <th>Point Estimate</th>
        <th>Dependency</th>
        <th>Risks</th>
        <th>Committed to PI?</th>
        <th>Implementation Notes</th>
      </tr>
      <tr>
        <td>Yes</td>
        <td>P1</td>
        <td>ALPHA-1 - Feature One</td>
        <td>8</td>
        <td>Platform</td>
        <td>Vendor delay</td>
        <td>Yes</td>
        <td>Manual note kept</td>
      </tr>
    </tbody>
  </table>
`;

test('parses the PI Review table server-side (rows classified by tag, not instanceof)', () => {
  const parsed = engine.parsePiReviewTable(PI_REVIEW_STORAGE);
  assert.ok(parsed, 'expected a parse result');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].feature, 'ALPHA-1 - Feature One');
  assert.equal(parsed.rows[0].committed, 'Yes');
  assert.equal(parsed.rows[0].notes, 'Manual note kept');
});

test('parses the saved Team Capacity snapshot server-side', () => {
  const capacity = engine.parsePiReviewCapacitySummary(PI_REVIEW_STORAGE);
  assert.ok(capacity, 'expected a capacity summary');
  assert.equal(capacity.summaryLabel, 'Existing Capacity');
  assert.equal(capacity.workDayCount, 50);
  assert.equal(capacity.totalCapacityPoints, 549.5);
});

test('collapses stacked duplicate Team Capacity blocks to one on write (FR-012, server path)', () => {
  const stacked = `
    <h1>NodeToolbox PI Review</h1>
    <h2>Team Capacity</h2>
    <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
    <p><strong>Plan:</strong> Legacy One</p>
    <p><strong>Date Range:</strong> Not set to Not set</p>
    <p><strong>Work Days:</strong> 0</p>
    <p><strong>100% Capacity (pts):</strong> 0</p>
    <p><strong>80% Capacity (pts):</strong> 0</p>
    <ul><li><strong>Dev:</strong> 0 pts</li></ul>
    <h2>Team Capacity</h2>
    <p>Capacity from the Toolbox Capacity tab appears here after you save from NodeToolbox.</p>
    <table><tbody><tr>
      <th>YES - If this is a Carry-Over from a 26.2 Commit?</th><th>Priority</th><th>Feature</th>
      <th>Point Estimate</th><th>Dependency</th><th>Risks</th><th>Committed to PI?</th><th>Implementation Notes</th>
    </tr></tbody></table>
  `;

  const nextStorage = engine.writePiReviewCapacitySummary(stacked, {
    summaryLabel: 'Fresh Capacity',
    startDate: '2026-05-21',
    endDate: '2026-07-29',
    workDayCount: 50,
    totalCapacityPoints: 549.5,
    recommendedCapacityPoints: 439,
    roleCapacities: { Developer: 432 },
  });

  assert.equal((nextStorage.match(/Team Capacity/g) || []).length, 1);
  assert.match(nextStorage, /Fresh Capacity/);
  assert.doesNotMatch(nextStorage, /Legacy One/);
  assert.doesNotMatch(nextStorage, /appears here after you save/);
});

test('exposes the pure Jira helpers (project-clause-free JQL + key extraction)', () => {
  const jql = engine.buildDirectFeatureJql('PI 26.4', ['C73130'], 'customfield_10301');
  assert.equal(jql, 'issuetype = Feature AND assignee = "C73130" AND cf[10301] = "PI 26.4"');
  assert.equal(engine.extractPiReviewFeatureKey('ALPHA-1 - Feature One'), 'ALPHA-1');
});
