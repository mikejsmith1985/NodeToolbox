// boardStats.test.ts — Unit coverage for Standup Board age, blocker, and flow metrics.

import { describe, expect, it } from 'vitest';

import { ageInDays, classifyAge, computeFlowStats, isBlocked, type StandupIssue } from './boardStats.ts';

const FIXED_NOW = new Date('2026-01-10T12:00:00.000Z');

function buildIssue(overrides: Partial<StandupIssue> = {}): StandupIssue {
  return {
    key: 'TBX-101',
    summary: 'Review blocker',
    status: 'In Progress',
    statusCategoryKey: 'indeterminate',
    assignee: 'Alex',
    ageDays: 4,
    isBlocked: false,
    ...overrides,
  };
}

describe('ageInDays', () => {
  it('returns zero before the first full day has elapsed', () => {
    expect(ageInDays('2026-01-09T12:00:01.000Z', FIXED_NOW)).toBe(0);
  });

  it('returns exact whole days at a day boundary', () => {
    expect(ageInDays('2026-01-08T12:00:00.000Z', FIXED_NOW)).toBe(2);
  });

  it('returns zero for invalid or future dates', () => {
    expect(ageInDays('not-a-date', FIXED_NOW)).toBe(0);
    expect(ageInDays('2026-01-11T12:00:00.000Z', FIXED_NOW)).toBe(0);
  });
});

describe('isBlocked', () => {
  it('detects inward block-type Jira links case-insensitively', () => {
    const jiraIssue = { fields: { issuelinks: [{ type: { name: 'Blocks' }, inwardIssue: { key: 'TBX-1' } }] } };

    expect(isBlocked(jiraIssue)).toBe(true);
  });

  it('ignores outward blockers because the current issue is not blocked by them', () => {
    const jiraIssue = { fields: { issuelinks: [{ type: { name: 'blocks' }, outwardIssue: { key: 'TBX-2' } }] } };

    expect(isBlocked(jiraIssue)).toBe(false);
  });

  it('returns false for missing links and non-blocking link types', () => {
    expect(isBlocked({ fields: {} })).toBe(false);
    expect(isBlocked({ fields: { issuelinks: [{ type: { name: 'Relates' }, inwardIssue: { key: 'TBX-3' } }] } })).toBe(false);
  });
});

describe('classifyAge', () => {
  it('uses green for two days or less', () => {
    expect(classifyAge(2)).toBe('ok');
  });

  it('uses warning through five days', () => {
    expect(classifyAge(3)).toBe('warn');
    expect(classifyAge(5)).toBe('warn');
  });

  it('uses old for more than five days', () => {
    expect(classifyAge(6)).toBe('old');
  });
});

describe('computeFlowStats', () => {
  it('counts WIP, stale, blockers, and non-done average age', () => {
    const issues = [
      buildIssue({ key: 'TBX-1', ageDays: 8, isBlocked: true }),
      buildIssue({ key: 'TBX-2', ageDays: 2, statusCategoryKey: 'indeterminate' }),
      buildIssue({ key: 'TBX-3', ageDays: 4, statusCategoryKey: 'new' }),
      buildIssue({ key: 'TBX-4', ageDays: 20, statusCategoryKey: 'done', isBlocked: true }),
    ];

    expect(computeFlowStats(issues)).toEqual({ wip: 2, stale: 1, blocked: 2, avgAgeDays: 4.7 });
  });
});
