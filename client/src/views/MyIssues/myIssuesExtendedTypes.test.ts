// myIssuesExtendedTypes.test.ts — Tests for My Issues extended type helpers.

import { describe, expect, it } from 'vitest';

import {
  AGING_STALE_THRESHOLD_DAYS,
  AGING_WARN_THRESHOLD_DAYS,
  STALE_SM_THRESHOLD_DAYS,
  classifyIssueZone,
  computeAttentionReasons,
} from './myIssuesExtendedTypes.ts';
import type { ExtendedJiraIssue } from './myIssuesExtendedTypes.ts';

function createIssue(overrides: Partial<ExtendedJiraIssue['fields']> = {}): ExtendedJiraIssue {
  return {
    id: 'TEST-1',
    key: 'TEST-1',
    fields: {
      summary: 'A test issue',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Medium', iconUrl: '' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
      ...overrides,
    },
  };
}

// ── computeAttentionReasons ──

describe('computeAttentionReasons', () => {
  it('returns empty array for a normal in-progress issue', () => {
    const issue = createIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } });
    expect(computeAttentionReasons(issue)).toEqual([]);
  });

  it('returns Blocked when status name contains "block"', () => {
    const issue = createIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } });
    expect(computeAttentionReasons(issue)).toContain('Blocked');
  });

  it('returns Blocked when status name contains "impede"', () => {
    const issue = createIssue({ status: { name: 'Impeded', statusCategory: { key: 'indeterminate' } } });
    expect(computeAttentionReasons(issue)).toContain('Blocked');
  });

  it('returns Blocked when status name contains "hold"', () => {
    const issue = createIssue({ status: { name: 'On Hold', statusCategory: { key: 'indeterminate' } } });
    expect(computeAttentionReasons(issue)).toContain('Blocked');
  });

  it('returns Critical Priority when priority is Blocker', () => {
    const issue = createIssue({ priority: { name: 'Blocker', iconUrl: '' } });
    expect(computeAttentionReasons(issue)).toContain('Critical Priority');
  });

  it('returns Critical Priority when priority is Critical', () => {
    const issue = createIssue({ priority: { name: 'Critical', iconUrl: '' } });
    expect(computeAttentionReasons(issue)).toContain('Critical Priority');
  });

  it('returns Critical Priority when priority is Highest', () => {
    const issue = createIssue({ priority: { name: 'Highest', iconUrl: '' } });
    expect(computeAttentionReasons(issue)).toContain('Critical Priority');
  });

  it('returns Past Due when duedate is in the past', () => {
    const issue = createIssue({ duedate: '2020-01-01' });
    expect(computeAttentionReasons(issue)).toContain('Past Due');
  });

  it('does not return Past Due when duedate is null', () => {
    const issue = createIssue({ duedate: null });
    expect(computeAttentionReasons(issue)).not.toContain('Past Due');
  });

  it('can return multiple reasons for one issue', () => {
    const issue = createIssue({
      status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'Blocker', iconUrl: '' },
      duedate: '2020-01-01',
    });
    const reasons = computeAttentionReasons(issue);
    expect(reasons).toContain('Blocked');
    expect(reasons).toContain('Critical Priority');
    expect(reasons).toContain('Past Due');
  });
});

// ── classifyIssueZone ──

describe('classifyIssueZone', () => {
  it('returns "attn" for a blocked issue', () => {
    const issue = createIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } });
    expect(classifyIssueZone(issue)).toBe('attn');
  });

  it('returns "inrev" for an In Review issue', () => {
    const issue = createIssue({ status: { name: 'In Review', statusCategory: { key: 'indeterminate' } } });
    expect(classifyIssueZone(issue)).toBe('inrev');
  });

  it('returns "inrev" for a Code Review issue', () => {
    const issue = createIssue({ status: { name: 'Code Review', statusCategory: { key: 'indeterminate' } } });
    expect(classifyIssueZone(issue)).toBe('inrev');
  });

  it('returns "done" for a done-category issue', () => {
    const issue = createIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } });
    expect(classifyIssueZone(issue)).toBe('done');
  });

  it('returns "todo" for a to-do-category issue', () => {
    const issue = createIssue({ status: { name: 'To Do', statusCategory: { key: 'new' } } });
    expect(classifyIssueZone(issue)).toBe('todo');
  });

  it('returns "inprog" for a normal in-progress issue', () => {
    const issue = createIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } });
    expect(classifyIssueZone(issue)).toBe('inprog');
  });
});

// ── Constants ──

describe('aging threshold constants', () => {
  it('exports AGING_WARN_THRESHOLD_DAYS as 5', () => {
    expect(AGING_WARN_THRESHOLD_DAYS).toBe(5);
  });

  it('exports AGING_STALE_THRESHOLD_DAYS as 10', () => {
    expect(AGING_STALE_THRESHOLD_DAYS).toBe(10);
  });

  it('exports STALE_SM_THRESHOLD_DAYS as 3', () => {
    expect(STALE_SM_THRESHOLD_DAYS).toBe(3);
  });
});
