// realMergeSample.test.ts — A REAL merge notification, kept verbatim as a fixture.
//
// Every marker in this file was invented from GitHub's documented format until now, with a standing
// note to "validate against real emails during rollout". This is that email (GH #375): the subject
// numbers the PR as "(PR #973)" rather than the "(#123)" the seed assumed, the corporate mail gateway
// prepends an external-sender banner ahead of the body, and the X-GitHub-Reason header says
// `review_requested` even though the message is a merge — so rule ORDER is load-bearing, not tidiness.
import { describe, expect, it } from 'vitest';
import { parseGithubEmail } from './classifyGithubEmail.ts';

const RAW = [
  'From: "Jones, Christen R" <notifications@github.com>',
  'Subject: Re: [zilvertonz/usmg-db-elements] Aq rel (PR #973)',
  'List-ID: <usmg-db-elements.zilvertonz.github.com>',
  'Message-ID: <real-1@github.com>',
  'Date: Tue, 19 Aug 2026 14:00:00 +0000',
  'X-GitHub-Reason: review_requested',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'This Message Is From an External Sender',
  'This message came from outside your organization.',
  'CAUTION: Do not click on links or open attachments unless you recognize the sender and know the content is safe.',
  'Report Suspicious',
  '',
  'Merged #973 into rel.',
  '',
  '\u2014',
  'Reply to this email directly, view it on GitHub, or unsubscribe.',
  'You are receiving this because your review was requested.',
].join('\r\n');

describe('a real merge email', () => {
  it('is classified as a merge into rel, banner and misleading reason header notwithstanding', () => {
    const event = parseGithubEmail(RAW);

    expect(event.eventType).toBe('pr_merged');
    // Not 'review-requested': that rule sits BELOW the merge rules, and this email would match it.
    expect(event.matchedRuleId).toBe('pr-merged-rel');
    expect(event.mergedIntoBranch).toBe('rel');
    expect(event.prNumber).toBe(973);
    expect(event.repo).toBe('zilvertonz/usmg-db-elements');
  });

  it('carries NO Jira key — the merge email alone cannot say which issue shipped', () => {
    // The blocker for acting on this signal, pinned here so it is not rediscovered. The body is one
    // sentence, the subject is a PR title with no key, and there is no source branch to read one
    // from. Attribution has to come from an earlier email about the same PR number.
    const event = parseGithubEmail(RAW);

    expect(event.jiraKey).toBeNull();
    expect(event.branch).toBeNull();
  });
});
