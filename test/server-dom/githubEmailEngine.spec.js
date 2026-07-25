// githubEmailEngine.spec.js — Proves the shared GitHub email engine runs server-side from its bundled
// CommonJS build (no browser globals). Runs on Node's native test runner. Run: `npm run test:dom`
// (after `npm run build:github-email-engine`).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../../src/services/generated/githubEmailEngine.cjs');

const MERGE_EMAIL = [
  'List-ID: myorg/toolbox <toolbox.myorg.github.com>',
  'Subject: [myorg/toolbox] Add enrollment support (#123)',
  'Message-ID: <merge-1@github.com>',
  'Date: Thu, 24 Jul 2026 12:00:00 +0000',
  'X-GitHub-Sender: jsmith',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Merged #123 into main from feature/DENP-1414.',
].join('\r\n');

test('the bundled engine classifies a merge email server-side', () => {
  const event = engine.parseGithubEmail(MERGE_EMAIL);
  assert.equal(event.eventType, 'pr_merged');
  assert.equal(event.jiraKey, 'DENP-1414');
  assert.equal(event.repo, 'myorg/toolbox');
  assert.equal(event.prNumber, 123);
  assert.equal(event.sourceMessageId, '<merge-1@github.com>');
});

test('the bundled engine reads an Outlook .msg and classifies it server-side', () => {
  const msgBytes = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'github-emails', 'synthetic-review-requested.msg'));
  const emailSource = engine.msgBytesToEmailSource(msgBytes);
  assert.ok(emailSource, 'expected a reconstructed email source from the .msg');

  const event = engine.parseGithubEmail(emailSource);
  assert.equal(event.eventType, 'review_requested');
  assert.equal(event.actor, 'OCTOCAT_TEST');
  assert.equal(event.repo, 'testorg/testrepo');
  assert.equal(event.jiraKey, 'TEST-123');
  assert.equal(event.prNumber, 7);
});

test('the bundled engine exposes the ledger helpers', () => {
  const ledger = engine.appendProcessed([], { key: '<a@x>', processedAtIso: '', eventType: 'pr_merged', jiraKey: 'DENP-1', outcome: 'posted' });
  assert.equal(engine.isProcessed(ledger, '<a@x>'), true);
  assert.equal(engine.isProcessed(ledger, '<b@x>'), false);
});
