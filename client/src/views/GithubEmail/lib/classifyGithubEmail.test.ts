// classifyGithubEmail.test.ts — Classification of GitHub notification emails into normalized events.
//
// The fixtures below follow GitHub's documented notification conventions (List-ID host, X-GitHub-Reason,
// "[owner/repo] Title (#N)" subject, body markers). They are the reference the seed rules target; the
// real regexes are confirmed/refined against the team's actual emails during the dry-run rollout.

import { describe, expect, it } from 'vitest';

import { parseGithubEmail } from './classifyGithubEmail.ts';

function email(headers: Record<string, string>, body: string): string {
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  return [...headerLines, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
}

const BASE_HEADERS = {
  'List-ID': 'myorg/toolbox <toolbox.myorg.github.com>',
  'Message-ID': '<abc-1@github.com>',
  'Date': 'Thu, 24 Jul 2026 12:00:00 +0000',
  'X-GitHub-Sender': 'jsmith',
};

describe('classifyGithubEmail', () => {
  it('reads repo, PR number, Jira key, actor, time, and message id from a merge email', () => {
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] Add enrollment support (#123)' },
      'Merged #123 into main from feature/DENP-1414.',
    ));

    expect(event.eventType).toBe('pr_merged');
    expect(event.matchedRuleId).toBe('pr-merged');
    expect(event.repo).toBe('myorg/toolbox');
    expect(event.prNumber).toBe(123);
    expect(event.jiraKey).toBe('DENP-1414');
    expect(event.branch).toBe('feature/DENP-1414');
    expect(event.actor).toBe('jsmith');
    expect(event.subjectTitle).toBe('Add enrollment support');
    expect(event.sourceMessageId).toBe('<abc-1@github.com>');
    expect(event.occurredAtIso).toBe('2026-07-24T12:00:00.000Z');
  });

  it('classifies a PR-opened email', () => {
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] Add enrollment support (#123)' },
      '@jsmith opened this pull request from feature/DENP-1414.',
    ));

    expect(event.eventType).toBe('pr_opened');
    expect(event.jiraKey).toBe('DENP-1414');
    expect(event.prNumber).toBe(123);
  });

  it('classifies a push email via the X-GitHub-Reason header', () => {
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] feature/DENP-1414', 'X-GitHub-Reason': 'push' },
      'jsmith pushed 2 commits to feature/DENP-1414',
    ));

    expect(event.eventType).toBe('commit_pushed');
    expect(event.jiraKey).toBe('DENP-1414');
  });

  it('classifies a branch-created email', () => {
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] new branch' },
      'jsmith created the branch feature/DENP-1414',
    ));

    expect(event.eventType).toBe('branch_created');
    expect(event.jiraKey).toBe('DENP-1414');
  });

  it('classifies a review-requested email via the reason header', () => {
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] Add enrollment support (#123)', 'X-GitHub-Reason': 'review_requested' },
      'jsmith requested your review on feature/DENP-1414',
    ));

    expect(event.eventType).toBe('review_requested');
  });

  it('returns unknown (and no crash) when nothing matches', () => {
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] a discussion comment' },
      'Just a comment with no actionable marker, ref DENP-1414.',
    ));

    expect(event.eventType).toBe('unknown');
    expect(event.matchedRuleId).toBeNull();
    // A key mentioned only in body prose is NOT trusted — it would risk attaching to the wrong ticket.
    expect(event.jiraKey).toBeNull();
  });

  it('prefers the key in the PR title over a different key referenced in the body', () => {
    // The PR is FIX-100; a commit message references FIX-999. The event must attach to the PR's own ticket.
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] [FIX-100] Repair login (#42)', 'X-GitHub-Reason': 'push' },
      'jsmith pushed 1 commit. abc1234 revert change from FIX-999',
    ));

    expect(event.eventType).toBe('commit_pushed');
    expect(event.jiraKey).toBe('FIX-100');
  });

  it('does not invent a junk branch from footer/commit prose', () => {
    // A greedy "from <word>" match used to turn "unsubscribe from an email" into branch "an" and could turn
    // "from PROJ-9" into a wrong key. Neither may happen now.
    const event = parseGithubEmail(email(
      { ...BASE_HEADERS, 'Subject': '[myorg/toolbox] 07242026 clcl (#2535)', 'X-GitHub-Reason': 'push' },
      'jsmith pushed 1 commit. View it on GitHub or unsubscribe from an email. Reverted change from PROJ-9.',
    ));

    expect(event.eventType).toBe('commit_pushed');
    expect(event.branch).toBeNull();
    expect(event.jiraKey).toBeNull(); // no key in subject/branch, and the body ref must not be trusted as the branch
  });

  it('falls back to the [owner/repo] subject when List-ID is absent, and flattens an HTML body', () => {
    const raw = [
      'Subject: [acme/widgets] Ship it (#7)',
      'Message-ID: <h-1@github.com>',
      'Content-Type: text/html; charset=UTF-8',
      '',
      '<p>Merged #7 into main from <b>feature/ACME-9</b>.</p>',
    ].join('\r\n');

    const event = parseGithubEmail(raw);
    expect(event.repo).toBe('acme/widgets');
    expect(event.eventType).toBe('pr_merged');
    expect(event.jiraKey).toBe('ACME-9');
  });
});
