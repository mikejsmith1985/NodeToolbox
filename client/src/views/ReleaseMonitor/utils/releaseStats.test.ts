// releaseStats.test.ts — Unit tests for Release Monitor status and summary calculations.

import { describe, expect, it } from 'vitest';

import {
  classifyVersion,
  computeStats,
  isBlocker,
  isOverdue,
  type JiraVersion,
  type ReleaseIssue,
} from './releaseStats.ts';

const TODAY = '2026-02-10';

function buildVersion(overrides: Partial<JiraVersion> = {}): JiraVersion {
  return {
    id: '10000',
    name: '0.6.1',
    released: false,
    archived: false,
    releaseDate: '2026-02-11',
    ...overrides,
  };
}

function buildIssue(overrides: Partial<ReleaseIssue> = {}): ReleaseIssue {
  return {
    key: 'TBX-101',
    summary: 'Prepare release notes',
    statusName: 'In Progress',
    statusCategoryKey: 'indeterminate',
    assigneeName: 'Alex Morgan',
    priorityName: 'Medium',
    duedate: '2026-02-11',
    isBlocker: false,
    isOverdue: false,
    ...overrides,
  };
}

describe('classifyVersion', () => {
  it('returns released when Jira marks the version released', () => {
    expect(classifyVersion(buildVersion({ released: true, releaseDate: '2026-02-01' }), TODAY)).toBe('released');
  });

  it('returns overdue when the release date is before today and unreleased', () => {
    expect(classifyVersion(buildVersion({ releaseDate: '2026-02-09' }), TODAY)).toBe('overdue');
  });

  it('returns on-track when an unreleased version is today or later', () => {
    expect(classifyVersion(buildVersion({ releaseDate: TODAY }), TODAY)).toBe('on-track');
    expect(classifyVersion(buildVersion({ releaseDate: '2026-02-12' }), TODAY)).toBe('on-track');
  });

  it('returns unknown when no Jira version is selected', () => {
    expect(classifyVersion(null, TODAY)).toBe('unknown');
  });
});

describe('isBlocker', () => {
  it('returns true for Highest priority', () => {
    expect(isBlocker({ priorityName: 'Highest', labels: [] })).toBe(true);
  });

  it('returns true for Critical priority', () => {
    expect(isBlocker({ priorityName: 'Critical', labels: [] })).toBe(true);
  });

  it('returns true for a blocker label regardless of case', () => {
    expect(isBlocker({ priorityName: 'Medium', labels: ['Release', 'BLOCKER'] })).toBe(true);
  });

  it('returns false when priority and labels are not blocker signals', () => {
    expect(isBlocker({ priorityName: 'Low', labels: ['documentation'] })).toBe(false);
  });
});

describe('isOverdue', () => {
  it('returns true only when due date is before today and status is not done', () => {
    expect(isOverdue({ duedate: '2026-02-09', statusCategoryKey: 'indeterminate' }, TODAY)).toBe(true);
  });

  it('returns false when due date is today or later', () => {
    expect(isOverdue({ duedate: TODAY, statusCategoryKey: 'new' }, TODAY)).toBe(false);
    expect(isOverdue({ duedate: '2026-02-11', statusCategoryKey: 'new' }, TODAY)).toBe(false);
  });

  it('returns false for done issues even when the due date has passed', () => {
    expect(isOverdue({ duedate: '2026-02-01', statusCategoryKey: 'done' }, TODAY)).toBe(false);
  });

  it('returns false when Jira has no due date', () => {
    expect(isOverdue({ duedate: null, statusCategoryKey: 'new' }, TODAY)).toBe(false);
  });
});

describe('computeStats', () => {
  it('computes totals, completion percentage, blocker count, and overdue count', () => {
    const issues = [
      buildIssue({ statusCategoryKey: 'done' }),
      buildIssue({ key: 'TBX-102', isBlocker: true }),
      buildIssue({ key: 'TBX-103', isOverdue: true }),
      buildIssue({ key: 'TBX-104', statusCategoryKey: 'done', isBlocker: true }),
    ];

    expect(computeStats(issues)).toEqual({ total: 4, done: 2, completionPct: 50, blockers: 2, overdue: 1 });
  });

  it('returns zero completion for an empty issue list', () => {
    expect(computeStats([])).toEqual({ total: 0, done: 0, completionPct: 0, blockers: 0, overdue: 0 });
  });
});
