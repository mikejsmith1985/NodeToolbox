// parseMsg.test.ts — Tests the Outlook .msg (CFBF) reader against SYNTHETIC compound-file fixtures built by
// test/helpers/makeMsgFixture.js (placeholder data only — no real email content is committed). The .msg
// format is fiddly, so exercising the real CFBF parse path against genuine compound-file bytes is the point;
// the fixtures just carry safe, made-up values.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGithubEmail } from './classifyGithubEmail.ts';
import { msgBytesToEmailSource, parseMsg } from './parseMsg.ts';

// The client test runner's cwd is the client/ directory; the fixtures live at the repo root.
const FIXTURE_PATH = resolve(process.cwd(), '../test/fixtures/github-emails/synthetic-review-requested.msg');
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

const KEYLESS_FIXTURE_PATH = resolve(process.cwd(), '../test/fixtures/github-emails/synthetic-commit-pushed-keyless.msg');
const keylessFixtureBytes = new Uint8Array(readFileSync(KEYLESS_FIXTURE_PATH));

describe('parseMsg', () => {
  it('extracts the transport headers from a compound-file .msg', () => {
    const parsed = parseMsg(fixtureBytes);
    expect(parsed.transportHeaders).not.toBeNull();
    expect(parsed.transportHeaders).toContain('X-GitHub-Sender: OCTOCAT_TEST');
    expect(parsed.transportHeaders).toContain('X-GitHub-Reason: review_requested');
    expect(parsed.transportHeaders).toContain('List-ID: testorg/testrepo');
  });

  it('returns nulls (never throws) for bytes that are not a compound file', () => {
    const parsed = parseMsg(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(parsed).toEqual({ transportHeaders: null, bodyText: null });
  });

  it('reconstructs an RFC-822 source without the original body Content-Type', () => {
    const source = msgBytesToEmailSource(fixtureBytes);
    expect(source).not.toBeNull();
    expect(source).toContain('X-GitHub-Sender: OCTOCAT_TEST');
    // The reconstructed body is already-decoded plain text, so the multipart Content-Type must be gone.
    expect(source).not.toMatch(/^content-type:/im);
  });
});

describe('parseMsg → classifier end to end', () => {
  it('classifies a .msg into the expected GitHub event via the existing classifier', () => {
    const source = msgBytesToEmailSource(fixtureBytes);
    const event = parseGithubEmail(source as string);

    expect(event.actor).toBe('OCTOCAT_TEST');
    expect(event.repo).toBe('testorg/testrepo');
    expect(event.jiraKey).toBe('TEST-123');
    expect(event.prNumber).toBe(7);
    expect(event.eventType).toBe('review_requested');
  });

  it('classifies a keyless push email as commit_pushed with no key and no junk branch', () => {
    // A PR title with no Jira key must classify by event but NOT invent a key or a junk branch from the
    // footer/commit prose — it should skip downstream as no-jira-key.
    const event = parseGithubEmail(msgBytesToEmailSource(keylessFixtureBytes) as string);

    expect(event.eventType).toBe('commit_pushed');
    expect(event.repo).toBe('testorg/testrepo');
    expect(event.prNumber).toBe(8);
    expect(event.jiraKey).toBeNull();
    expect(event.branch).toBeNull();
  });
});
