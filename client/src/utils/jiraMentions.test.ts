// jiraMentions.test.ts — Unit tests for detecting @-mentions of the current user.

import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../types/jira.ts';
import { bodyContainsUserMention, collectUserMentions, type MentionIdentity } from './jiraMentions.ts';

const IDENTITY: MentionIdentity = {
  accountId: '5b10ac8d82e05b22cc7d4ef5',
  name: 'jsmith',
  key: 'jsmith',
  displayName: 'Jane Smith',
};

describe('bodyContainsUserMention', () => {
  it('matches a Jira Server wiki-markup mention [~username]', () => {
    expect(bodyContainsUserMention('Hey [~jsmith] can you look at this?', IDENTITY)).toBe(true);
  });

  it('matches an Atlassian Document Format mention node by accountId', () => {
    const adfBody = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: '5b10ac8d82e05b22cc7d4ef5', text: '@Jane Smith' } },
            { type: 'text', text: ' please review' },
          ],
        },
      ],
    };
    expect(bodyContainsUserMention(adfBody, IDENTITY)).toBe(true);
  });

  it('matches an ADF mention by display-name text when ids differ in case', () => {
    const adfBody = { type: 'doc', content: [{ type: 'mention', attrs: { text: '@Jane Smith' } }] };
    expect(bodyContainsUserMention(adfBody, IDENTITY)).toBe(true);
  });

  it('does not match a mention of a different user', () => {
    expect(bodyContainsUserMention('Hey [~bjones] take a look', IDENTITY)).toBe(false);
  });

  it('does not match plain text that merely contains the username substring', () => {
    expect(bodyContainsUserMention('the jsmithsonian museum is closed', IDENTITY)).toBe(false);
  });
});

function buildIssueWithComments(
  issueKey: string,
  summary: string,
  comments: Array<{ id: string; author: string; body: unknown; created: string }>,
): JiraIssue {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-08T00:00:00.000Z',
      description: null,
      comment: {
        total: comments.length,
        comments: comments.map((comment) => ({
          id: comment.id,
          author: { displayName: comment.author },
          body: comment.body,
          created: comment.created,
        })),
      },
    },
  } as JiraIssue;
}

describe('collectUserMentions', () => {
  const windowStartMs = new Date('2025-01-05T00:00:00.000Z').getTime();
  const nowMs = new Date('2025-01-08T12:00:00.000Z').getTime();

  it('returns one mention per qualifying comment with a stable mentionKey', () => {
    const issues = [
      buildIssueWithComments('TBX-1', 'Fix login', [
        { id: '101', author: 'Bob Jones', body: 'Please advise [~jsmith]', created: '2025-01-06T10:00:00.000Z' },
      ]),
    ];

    const mentions = collectUserMentions(issues, IDENTITY, windowStartMs, nowMs);

    expect(mentions).toHaveLength(1);
    expect(mentions[0].mentionKey).toBe('TBX-1#101');
    expect(mentions[0].issueKey).toBe('TBX-1');
    expect(mentions[0].issueSummary).toBe('Fix login');
    expect(mentions[0].authorDisplayName).toBe('Bob Jones');
    expect(mentions[0].excerpt).toContain('Please advise');
  });

  it('ignores mentions whose comment falls outside the time window', () => {
    const issues = [
      buildIssueWithComments('TBX-2', 'Old ticket', [
        { id: '201', author: 'Bob Jones', body: 'old ping [~jsmith]', created: '2025-01-01T10:00:00.000Z' },
      ]),
    ];

    expect(collectUserMentions(issues, IDENTITY, windowStartMs, nowMs)).toHaveLength(0);
  });

  it('ignores comments that do not mention the user', () => {
    const issues = [
      buildIssueWithComments('TBX-3', 'Other', [
        { id: '301', author: 'Bob Jones', body: 'general update, no mention', created: '2025-01-06T10:00:00.000Z' },
      ]),
    ];

    expect(collectUserMentions(issues, IDENTITY, windowStartMs, nowMs)).toHaveLength(0);
  });

  it('collects multiple mentions across comments and issues', () => {
    const issues = [
      buildIssueWithComments('TBX-4', 'A', [
        { id: '401', author: 'Bob', body: '[~jsmith] one', created: '2025-01-06T10:00:00.000Z' },
        { id: '402', author: 'Amy', body: 'no mention here', created: '2025-01-06T11:00:00.000Z' },
      ]),
      buildIssueWithComments('TBX-5', 'B', [
        { id: '501', author: 'Cara', body: '[~jsmith] two', created: '2025-01-07T09:00:00.000Z' },
      ]),
    ];

    const mentions = collectUserMentions(issues, IDENTITY, windowStartMs, nowMs);
    expect(mentions.map((mention) => mention.mentionKey)).toEqual(['TBX-4#401', 'TBX-5#501']);
  });
});
