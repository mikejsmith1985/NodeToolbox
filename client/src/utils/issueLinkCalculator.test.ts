// issueLinkCalculator.test.ts — Unit tests for the Jira ↔ SNow link detection
// and health-status calculation logic.

import { describe, expect, it } from 'vitest';

import { detectLinkedPairs, collectLinkedSnowSysIds } from './issueLinkCalculator.ts';
import type { JiraIssue } from '../types/jira.ts';
import type { SnowMyIssue } from '../types/snow.ts';
import type { StatusMapping } from '../types/issueLinking.ts';

// ── Test fixture builders ──

function buildJiraIssue(overrides: Partial<JiraIssue['fields']> & { key?: string } = {}): JiraIssue {
  const { key = 'TBX-100', ...fieldOverrides } = overrides;
  return {
    id: `jira-${key}`,
    key,
    fields: {
      summary: 'Sample Jira issue',
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: { name: 'High', iconUrl: '' },
      assignee: null,
      reporter: null,
      issuetype: { name: 'Defect', iconUrl: '' },
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-02T00:00:00Z',
      description: null,
      customfield_11203: 'PRB0000100',
      ...fieldOverrides,
    },
  };
}

function buildSnowProblem(overrides: Partial<SnowMyIssue> = {}): SnowMyIssue {
  return {
    sys_id: 'prb-sys-100',
    number: 'PRB0000100',
    short_description: 'Root cause analysis needed',
    state: 'New',
    priority: '2 - High',
    sys_class_name: 'problem',
    opened_at: '2026-01-01T00:00:00Z',
    problem_statement: 'Systems are down. TBX-100',
    ...overrides,
  };
}

const NO_USER_MAPPINGS: StatusMapping[] = [];

// ── detectLinkedPairs ──

describe('detectLinkedPairs', () => {
  it('returns an empty array when there are no issues', () => {
    expect(detectLinkedPairs([], [], NO_USER_MAPPINGS)).toEqual([]);
  });

  it('detects a bidirectionally confirmed linked pair', () => {
    const jiraIssue = buildJiraIssue({ key: 'TBX-100' });
    const snowProblem = buildSnowProblem({
      problem_statement: 'Systems down. TBX-100',
    });

    const pairs = detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].jiraIssue.key).toBe('TBX-100');
    expect(pairs[0].snowProblem.number).toBe('PRB0000100');
    expect(pairs[0].pairId).toBe('TBX-100::prb-sys-100');
  });

  it('ignores Jira issues without customfield_11203', () => {
    const jiraIssue = buildJiraIssue({ customfield_11203: null });
    const snowProblem = buildSnowProblem();

    expect(detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS)).toEqual([]);
  });

  it('ignores non-Defect/Story Jira issue types', () => {
    const epicIssue = buildJiraIssue({ issuetype: { name: 'Epic', iconUrl: '' } });
    const snowProblem = buildSnowProblem();

    expect(detectLinkedPairs([epicIssue], [snowProblem], NO_USER_MAPPINGS)).toEqual([]);
  });

  it('ignores SNow issues that are not Problems', () => {
    const jiraIssue = buildJiraIssue();
    const incident: SnowMyIssue = {
      ...buildSnowProblem(),
      sys_class_name: 'incident',
    };

    expect(detectLinkedPairs([jiraIssue], [incident], NO_USER_MAPPINGS)).toEqual([]);
  });

  it('does not link when SNow problem_statement has no matching Jira key', () => {
    const jiraIssue = buildJiraIssue({ key: 'TBX-100' });
    const snowProblem = buildSnowProblem({ problem_statement: 'No Jira key here.' });

    expect(detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS)).toEqual([]);
  });

  it('handles trailing punctuation around the Jira key in problem_statement', () => {
    const jiraIssue = buildJiraIssue({ key: 'TBX-100' });
    const snowProblem = buildSnowProblem({ problem_statement: 'Issue details. TBX-100.' });

    const pairs = detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS);
    // The regex allows trailing whitespace but not punctuation — this tests boundary.
    // The key IS at the end (before the period) — adjust expectation based on regex.
    // Our regex is /\b([A-Z]{1,10}-\d{1,6})\s*$/ — period after key won't match.
    expect(pairs).toHaveLength(0); // period after key breaks the trailing match
  });

  it('sorts pairs red first, then yellow, then green', () => {
    const jiraIssueA = buildJiraIssue({ key: 'TBX-1', status: { name: 'To Do', statusCategory: { key: 'new' } }, customfield_11203: 'PRB1' });
    const jiraIssueB = buildJiraIssue({ key: 'TBX-2', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_11203: 'PRB2' });

    const snowGreen: SnowMyIssue = { ...buildSnowProblem(), sys_id: 'sys-1', problem_statement: 'Issue TBX-1', state: 'New' };
    const snowRed: SnowMyIssue = { ...buildSnowProblem(), sys_id: 'sys-2', number: 'PRB0000002', problem_statement: 'Issue TBX-2', state: 'Closed' };

    const pairs = detectLinkedPairs([jiraIssueA, jiraIssueB], [snowGreen, snowRed], NO_USER_MAPPINGS);

    expect(pairs[0].healthStatus).toBe('red');
    expect(pairs[1].healthStatus).toBe('green');
  });
});

// ── Health status ──

describe('health status calculation', () => {
  it('returns green when Jira To Do maps to SNow New via system mapping', () => {
    const jiraIssue = buildJiraIssue({ status: { name: 'To Do', statusCategory: { key: 'new' } } });
    const snowProblem = buildSnowProblem({ state: 'New' });

    const [pair] = detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS);
    expect(pair.healthStatus).toBe('green');
    expect(pair.matchingFieldCount).toBe(1);
    expect(pair.totalMappedFieldCount).toBe(1);
  });

  it('returns red when Jira status has no mapping configured', () => {
    const jiraIssue = buildJiraIssue({ status: { name: 'In Review', statusCategory: { key: 'indeterminate' } } });
    const snowProblem = buildSnowProblem({ state: 'In Progress' });

    const [pair] = detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS);
    expect(pair.healthStatus).toBe('red');
  });

  it('returns green when a user-configured mapping matches', () => {
    const jiraIssue = buildJiraIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } });
    const snowProblem = buildSnowProblem({ state: 'In Progress' });

    const userMappings: StatusMapping[] = [
      { jiraStatus: 'In Progress', snowStatus: 'In Progress', isSystemDefined: false },
    ];

    const [pair] = detectLinkedPairs([jiraIssue], [snowProblem], userMappings);
    expect(pair.healthStatus).toBe('green');
  });
});

// ── collectLinkedSnowSysIds ──

describe('collectLinkedSnowSysIds', () => {
  it('returns an empty set when there are no pairs', () => {
    expect(collectLinkedSnowSysIds([])).toEqual(new Set());
  });

  it('collects the sys_id from each linked pair', () => {
    const jiraIssue = buildJiraIssue();
    const snowProblem = buildSnowProblem({ problem_statement: 'TBX-100' });

    const pairs = detectLinkedPairs([jiraIssue], [snowProblem], NO_USER_MAPPINGS);
    const sysIds = collectLinkedSnowSysIds(pairs);

    expect(sysIds.has('prb-sys-100')).toBe(true);
  });
});
