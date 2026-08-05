// githubCommentAudit.test.ts — Unit tests for the GitHub-automation comment audit: the JQL that
// finds candidate issues, the signature match that identifies the automation's own comments, and
// the sweep that flattens them into reviewable rows.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./jiraApi.ts', () => ({
  jiraGet: vi.fn(),
}));

import { jiraGet } from './jiraApi.ts';
import {
  buildGithubCommentAuditJql,
  collectAutomationComments,
  fetchGithubAutomationComments,
  isAutomationComment,
} from './githubCommentAudit.ts';

const mockJiraGet = vi.mocked(jiraGet);

beforeEach(() => {
  mockJiraGet.mockReset();
});

describe('buildGithubCommentAuditJql', () => {
  it('searches comments for the GitHub token within the lookback window', () => {
    expect(buildGithubCommentAuditJql([], 30)).toBe(
      'comment ~ "GitHub" AND updated >= -30d ORDER BY updated DESC',
    );
  });

  it('scopes to the configured project keys when present', () => {
    expect(buildGithubCommentAuditJql(['DENP', 'enfct'], 14)).toBe(
      'project in (DENP, ENFCT) AND comment ~ "GitHub" AND updated >= -14d ORDER BY updated DESC',
    );
  });
});

describe('isAutomationComment', () => {
  it.each([
    '🔀 GitHub: branch created and work has started.',
    '✅ GitHub: new commit pushed to feature branch. (PR #1310 by @jdoe)',
    '🎉 GitHub: pull request has been merged. (PR #2681)',
    '🔔 GitHub: custom rule event.',
  ])('matches the automation template "%s"', (commentBody) => {
    expect(isAutomationComment(commentBody)).toBe(true);
  });

  it('does not match a human comment that merely mentions GitHub later in the text', () => {
    expect(isAutomationComment('I pushed this to GitHub yesterday, see the repo.')).toBe(false);
    expect(isAutomationComment('See GitHub for details')).toBe(false);
  });
});

describe('collectAutomationComments', () => {
  it('flattens matching comments into rows, newest first, skipping human comments', () => {
    const issues = [
      {
        key: 'DENP-1',
        fields: {
          summary: 'First story',
          comment: {
            comments: [
              { body: '🔀 GitHub: branch created and work has started.', created: '2026-08-01T10:00:00.000Z', author: { displayName: 'Svc Account' } },
              { body: 'Human reply about GitHub stuff', created: '2026-08-02T10:00:00.000Z', author: { displayName: 'Jane Doe' } },
            ],
          },
        },
      },
      {
        key: 'DENP-2',
        fields: {
          summary: 'Second story',
          comment: {
            comments: [
              { body: '🎉 GitHub: pull request has been merged. (PR #9)', created: '2026-08-03T10:00:00.000Z', author: { displayName: 'Svc Account' } },
            ],
          },
        },
      },
    ];

    const auditRows = collectAutomationComments(issues);

    expect(auditRows).toHaveLength(2);
    expect(auditRows[0]).toMatchObject({ issueKey: 'DENP-2', commentBody: '🎉 GitHub: pull request has been merged. (PR #9)' });
    expect(auditRows[1]).toMatchObject({ issueKey: 'DENP-1', authorDisplayName: 'Svc Account', issueSummary: 'First story' });
  });
});

describe('fetchGithubAutomationComments', () => {
  it('issues the audit search and returns flattened rows plus the scanned count', async () => {
    mockJiraGet.mockResolvedValueOnce({
      issues: [
        {
          key: 'DENP-7',
          fields: {
            summary: 'Story',
            comment: { comments: [{ body: '📬 GitHub: pull request opened for review.', created: '2026-08-04T09:00:00.000Z', author: { displayName: 'Svc' } }] },
          },
        },
      ],
    });

    const auditResult = await fetchGithubAutomationComments(['DENP'], 30);

    const requestedPath = decodeURIComponent(String(mockJiraGet.mock.calls[0][0]));
    expect(requestedPath).toContain('project in (DENP) AND comment ~ "GitHub" AND updated >= -30d');
    expect(requestedPath).toContain('fields=summary,comment');
    expect(auditResult.scannedIssueCount).toBe(1);
    expect(auditResult.rows[0]).toMatchObject({ issueKey: 'DENP-7', commentBody: '📬 GitHub: pull request opened for review.' });
  });
});
