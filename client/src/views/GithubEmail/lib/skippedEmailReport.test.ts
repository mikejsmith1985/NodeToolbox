// skippedEmailReport.test.ts — Turning skipped emails into an answerable question.
//
// The intake skips an email it cannot classify, or one carrying no Jira key, and records only the
// file name and a one-word reason. That is enough to know something was skipped and nothing at all
// to know WHETHER IT SHOULD HAVE BEEN — which is why the only way to answer "does a review-request
// email name the branch?" has been to ask a human to open one (GH #375).

import { describe, expect, it } from 'vitest';

import {
  buildSkippedEmailRecord,
  formatSkippedEmailReport,
  summariseSkippedEmails,
  type SkippedEmailRecord,
} from './skippedEmailReport.ts';

function record(overrides: Partial<SkippedEmailRecord> = {}): SkippedEmailRecord {
  return {
    fileName: 'mail.eml',
    reason: 'no-jira-key',
    subject: '[zilvertonz/usmg-db-elements] Aq rel (PR #973)',
    reasonHeader: 'review_requested',
    repo: 'zilvertonz/usmg-db-elements',
    prNumber: 973,
    jiraKey: null,
    branch: null,
    mergedIntoBranch: 'rel',
    eventType: 'pr_merged',
    matchedRuleId: 'pr-merged-rel',
    bodyExcerpt: 'Merged #973 into rel.',
    ...overrides,
  };
}

describe('buildSkippedEmailRecord', () => {
  it('captures every signal that decides whether the skip was right', () => {
    const built = buildSkippedEmailRecord({
      fileName: 'mail.eml',
      reason: 'no-jira-key',
      subject: '[org/repo] Title (PR #12)',
      reasonHeader: 'review_requested',
      bodyText: 'Merged #12 into rel.',
      event: {
        repo: 'org/repo', prNumber: 12, jiraKey: null, branch: null,
        mergedIntoBranch: 'rel', eventType: 'pr_merged', matchedRuleId: 'pr-merged-rel',
      },
    });

    expect(built.repo).toBe('org/repo');
    expect(built.prNumber).toBe(12);
    expect(built.mergedIntoBranch).toBe('rel');
    expect(built.matchedRuleId).toBe('pr-merged-rel');
    expect(built.bodyExcerpt).toContain('Merged #12 into rel');
  });

  it('strips the HTML a mail gateway wraps the body in', () => {
    const built = buildSkippedEmailRecord({
      fileName: 'mail.eml', reason: 'unclassified', subject: 's', reasonHeader: null,
      bodyText: '<p dir="auto">jsmith&nbsp;approved this pull request.</p>',
      event: { repo: null, prNumber: null, jiraKey: null, branch: null, mergedIntoBranch: null, eventType: 'unknown', matchedRuleId: null },
    });

    expect(built.bodyExcerpt).toBe('jsmith approved this pull request.');
  });

  it('caps the excerpt so one enormous email cannot swamp the report', () => {
    const built = buildSkippedEmailRecord({
      fileName: 'mail.eml', reason: 'unclassified', subject: 's', reasonHeader: null,
      bodyText: 'x'.repeat(5_000),
      event: { repo: null, prNumber: null, jiraKey: null, branch: null, mergedIntoBranch: null, eventType: 'unknown', matchedRuleId: null },
    });

    expect(built.bodyExcerpt.length).toBeLessThanOrEqual(400);
  });
});

describe('summariseSkippedEmails', () => {
  it('collapses many emails of one shape into a single counted row', () => {
    // Two hundred rows is a list; five shapes with counts is an answer.
    const shapes = summariseSkippedEmails([
      record({ fileName: 'a.eml', prNumber: 1 }),
      record({ fileName: 'b.eml', prNumber: 2 }),
      record({ fileName: 'c.eml', prNumber: 3 }),
    ]);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].emailCount).toBe(3);
  });

  it('keeps genuinely different shapes apart', () => {
    const shapes = summariseSkippedEmails([
      record({ reason: 'no-jira-key', eventType: 'pr_merged' }),
      record({ reason: 'unclassified', eventType: 'unknown', matchedRuleId: null, bodyExcerpt: 'approved this pull request' }),
    ]);

    expect(shapes).toHaveLength(2);
  });

  it('keeps one real example per shape, so the shape can be inspected', () => {
    const shapes = summariseSkippedEmails([record({ fileName: 'first.eml' }), record({ fileName: 'second.eml' })]);

    expect(shapes[0].exampleRecord.fileName).toBe('first.eml');
  });

  it('orders the shapes by how often they occur', () => {
    const shapes = summariseSkippedEmails([
      record({ reason: 'unclassified', eventType: 'unknown', bodyExcerpt: 'rare' }),
      record({ fileName: 'b.eml' }), record({ fileName: 'c.eml' }), record({ fileName: 'd.eml' }),
    ]);

    expect(shapes[0].emailCount).toBe(3);
  });

  it('reports whether a shape ever carries a Jira key or a branch', () => {
    // The question the whole report exists to answer: can these emails be attributed at all?
    const shapes = summariseSkippedEmails([
      record({ jiraKey: null, branch: null }),
      record({ fileName: 'b.eml', jiraKey: null, branch: 'feature/ENFCT-1690' }),
    ]);

    expect(shapes[0].hasEverCarriedBranch).toBe(true);
    expect(shapes[0].hasEverCarriedJiraKey).toBe(false);
  });
});

describe('formatSkippedEmailReport', () => {
  it('states the totals and every shape, not just the first few', () => {
    const reportText = formatSkippedEmailReport([record(), record({ fileName: 'b.eml' })]);

    expect(reportText).toContain('2 skipped email');
    expect(reportText).toContain('no-jira-key');
    expect(reportText).toContain('Merged #973 into rel.');
  });

  it('says so plainly when nothing was skipped', () => {
    expect(formatSkippedEmailReport([])).toMatch(/no skipped emails/i);
  });
});
