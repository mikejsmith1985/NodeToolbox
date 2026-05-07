// dsuFormat.test.ts — Unit tests for DSU Daily pure formatting helpers.

import { describe, expect, it } from 'vitest';

import { buildBulletList, classifyByDate, formatStandupText, type DsuIssue } from './dsuFormat.ts';

function buildIssue(
  issueKey: string,
  summary: string,
  updated: string,
  statusCategoryKey: string,
): DsuIssue {
  return {
    key: issueKey,
    fields: {
      summary,
      updated,
      status: { statusCategory: { key: statusCategoryKey } },
    },
  };
}

describe('buildBulletList', () => {
  it('formats each issue as a Jira bullet with key and summary', () => {
    const issues = [
      buildIssue('TBX-1', 'Prepare release notes', '2026-05-06T09:00:00.000Z', 'indeterminate'),
      buildIssue('TBX-2', 'Review support ticket', '2026-05-06T10:00:00.000Z', 'new'),
    ];

    expect(buildBulletList(issues)).toBe('• TBX-1 - Prepare release notes\n• TBX-2 - Review support ticket');
  });

  it('uses the default empty fallback when no issues exist', () => {
    expect(buildBulletList([])).toBe('• (no items)');
  });

  it('uses a caller-provided empty fallback for DSU-specific wording', () => {
    expect(buildBulletList([], '• (nothing updated yesterday)')).toBe('• (nothing updated yesterday)');
  });
});

describe('formatStandupText', () => {
  it('formats the three standup sections exactly', () => {
    expect(
      formatStandupText({
        yesterday: '• TBX-1 - Shipped panel',
        today: '• TBX-2 - Polish tests',
        blockers: 'Need VPN access',
      }),
    ).toBe('*Yesterday*\n• TBX-1 - Shipped panel\n\n*Today*\n• TBX-2 - Polish tests\n\n*Blockers*\nNeed VPN access');
  });

  it('uses None when blockers are empty', () => {
    expect(formatStandupText({ yesterday: 'Done', today: 'Doing', blockers: '' })).toBe(
      '*Yesterday*\nDone\n\n*Today*\nDoing\n\n*Blockers*\nNone',
    );
  });

  it('uses None when blockers contain only whitespace', () => {
    expect(formatStandupText({ yesterday: 'Done', today: 'Doing', blockers: '   \n  ' })).toContain(
      '*Blockers*\nNone',
    );
  });
});

describe('classifyByDate', () => {
  it('splits yesterday updates and current non-done issues', () => {
    const issues = [
      buildIssue('TBX-1', 'Yesterday update', '2026-05-06T16:45:00.000Z', 'done'),
      buildIssue('TBX-2', 'Active today', '2026-05-07T08:00:00.000Z', 'indeterminate'),
      buildIssue('TBX-3', 'Backlog item', '2026-05-01T08:00:00.000Z', 'new'),
    ];

    const classifiedIssues = classifyByDate(issues, '2026-05-07');

    expect(classifiedIssues.yesterdayList.map((issue) => issue.key)).toEqual(['TBX-1']);
    expect(classifiedIssues.todayList.map((issue) => issue.key)).toEqual(['TBX-2', 'TBX-3']);
  });

  it('treats midnight timestamps as belonging to that calendar day', () => {
    const issues = [
      buildIssue('TBX-4', 'Midnight boundary', '2026-05-06T00:00:00.000Z', 'indeterminate'),
      buildIssue('TBX-5', 'Previous day before midnight', '2026-05-05T23:59:59.999Z', 'indeterminate'),
    ];

    const classifiedIssues = classifyByDate(issues, '2026-05-07');

    expect(classifiedIssues.yesterdayList.map((issue) => issue.key)).toEqual(['TBX-4']);
  });
});
