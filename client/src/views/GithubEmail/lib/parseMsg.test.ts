// parseMsg.test.ts — Tests the Outlook .msg (CFBF) reader against a REAL captured GitHub notification
// email (test/fixtures/github-emails/gh-review-requested.msg). Proving it against genuine Outlook bytes is
// the whole point — the format is fiddly enough that a synthetic fixture would not build confidence. The
// reader must extract the transport headers so the existing classifier can run unchanged.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGithubEmail } from './classifyGithubEmail.ts';
import { msgBytesToEmailSource, parseMsg } from './parseMsg.ts';

// The client test runner's cwd is the client/ directory; the fixture lives at the repo root.
const FIXTURE_PATH = resolve(process.cwd(), '../test/fixtures/github-emails/gh-review-requested.msg');
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

const KEYLESS_FIXTURE_PATH = resolve(process.cwd(), '../test/fixtures/github-emails/gh-commit-pushed-keyless.msg');
const keylessFixtureBytes = new Uint8Array(readFileSync(KEYLESS_FIXTURE_PATH));

describe('parseMsg', () => {
  it('extracts the transport headers from a real Outlook .msg', () => {
    const parsed = parseMsg(fixtureBytes);
    expect(parsed.transportHeaders).not.toBeNull();
    expect(parsed.transportHeaders).toContain('X-GitHub-Sender: C13471_Zilver');
    expect(parsed.transportHeaders).toContain('X-GitHub-Reason: review_requested');
    expect(parsed.transportHeaders).toContain('List-ID: zilvertonz/usmg-facets-enroll');
  });

  it('returns nulls (never throws) for bytes that are not a compound file', () => {
    const parsed = parseMsg(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(parsed).toEqual({ transportHeaders: null, bodyText: null });
  });

  it('reconstructs an RFC-822 source without the original body Content-Type', () => {
    const source = msgBytesToEmailSource(fixtureBytes);
    expect(source).not.toBeNull();
    expect(source).toContain('X-GitHub-Sender: C13471_Zilver');
    // The reconstructed body is already-decoded plain text, so the multipart Content-Type must be gone.
    expect(source).not.toMatch(/^content-type:/im);
  });
});

describe('parseMsg → classifier end to end', () => {
  it('classifies the real .msg into the expected GitHub event via the existing classifier', () => {
    const source = msgBytesToEmailSource(fixtureBytes);
    const event = parseGithubEmail(source as string);

    expect(event.actor).toBe('C13471_Zilver');
    expect(event.repo).toBe('zilvertonz/usmg-facets-enroll');
    expect(event.jiraKey).toBe('ENFCT-1774');
    expect(event.prNumber).toBe(577);
    expect(event.eventType).toBe('review_requested');
  });

  it('classifies a real keyless push email as commit_pushed with no key and no junk branch', () => {
    // A real notification (GH #219) whose PR title carries no Jira key. It must classify by event but NOT
    // invent a key or a junk branch from the footer/commit prose — it should skip downstream as no-jira-key.
    const event = parseGithubEmail(msgBytesToEmailSource(keylessFixtureBytes) as string);

    expect(event.eventType).toBe('commit_pushed');
    expect(event.repo).toBe('zilvertonz/usmg-db-facets');
    expect(event.prNumber).toBe(2535);
    expect(event.jiraKey).toBeNull();
    expect(event.branch).toBeNull();
  });
});
