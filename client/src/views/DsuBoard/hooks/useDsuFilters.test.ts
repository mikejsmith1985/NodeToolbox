// useDsuFilters.test.ts — Unit tests for DSU Board multi-criteria filter helpers.

import { describe, expect, it } from 'vitest';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  DEFAULT_MULTI_CRITERIA_FILTERS,
  applyMultiCriteriaFilters,
  buildFilterOptions,
  hasActiveMultiCriteriaFilters,
} from './useDsuFilters.ts';

type DsuTestIssue = JiraIssue & {
  fields: JiraIssue['fields'] & {
    customfield_10301?: { value?: string; name?: string } | string | null;
  };
};

interface CreateIssueOptions {
  key: string;
  summary?: string;
  issueTypeName?: string;
  priorityName?: string | null;
  statusName?: string;
  statusCategoryKey?: string;
  assigneeName?: string | null;
  fixVersionNames?: string[];
  piValue?: { value?: string; name?: string } | string | null;
}

function createIssue({
  key,
  summary = 'Example issue',
  issueTypeName = 'Story',
  priorityName = 'Medium',
  statusName = 'In Progress',
  statusCategoryKey = 'indeterminate',
  assigneeName = 'Alice',
  fixVersionNames = [],
  piValue = null,
}: CreateIssueOptions): DsuTestIssue {
  return {
    id: key,
    key,
    fields: {
      summary,
      status: { name: statusName, statusCategory: { key: statusCategoryKey } },
      priority: priorityName ? { name: priorityName, iconUrl: '' } : null,
      assignee: assigneeName
        ? { accountId: assigneeName, displayName: assigneeName, emailAddress: `${assigneeName}@example.com`, avatarUrls: {} }
        : null,
      reporter: null,
      issuetype: { name: issueTypeName, iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: null,
      fixVersions: fixVersionNames.map((fixVersionName) => ({ name: fixVersionName })),
      customfield_10301: piValue,
    },
  };
}

describe('useDsuFilters', () => {
  it('hasActiveMultiCriteriaFilters returns false for the default filters', () => {
    expect(hasActiveMultiCriteriaFilters(DEFAULT_MULTI_CRITERIA_FILTERS)).toBe(false);
  });

  it('hasActiveMultiCriteriaFilters returns true when any filter group is active', () => {
    expect(
      hasActiveMultiCriteriaFilters({
        ...DEFAULT_MULTI_CRITERIA_FILTERS,
        priorities: ['High'],
      }),
    ).toBe(true);
  });

  it('buildFilterOptions collects unique values and sorts priorities by severity', () => {
    const issues = [
      createIssue({ key: 'TBX-1', issueTypeName: 'Bug', priorityName: 'Low', statusName: 'To Do', assigneeName: 'Bob', fixVersionNames: ['2025.02'], piValue: 'PI-2' }),
      createIssue({ key: 'TBX-2', issueTypeName: 'Story', priorityName: 'Critical', statusName: 'In Progress', assigneeName: 'Alice', fixVersionNames: ['2025.01'], piValue: { value: 'PI-1' } }),
      createIssue({ key: 'TBX-3', issueTypeName: 'Task', priorityName: 'High', statusName: 'Done', assigneeName: 'Cara', fixVersionNames: ['2025.02'], piValue: { name: 'PI-3' } }),
    ];

    expect(buildFilterOptions(issues)).toEqual({
      issueTypes: ['Bug', 'Story', 'Task'],
      priorities: ['Critical', 'High', 'Low'],
      statuses: ['Done', 'In Progress', 'To Do'],
      fixVersions: ['2025.01', '2025.02'],
      piValues: ['PI-1', 'PI-2', 'PI-3'],
      assignees: ['Alice', 'Bob', 'Cara'],
    });
  });

  it('applyMultiCriteriaFilters uses AND logic across groups and OR logic within groups', () => {
    const matchingIssue = createIssue({
      key: 'TBX-1',
      issueTypeName: 'Bug',
      priorityName: 'High',
      statusName: 'In Progress',
      assigneeName: 'Alice',
      fixVersionNames: ['2025.01'],
      piValue: 'PI-2',
    });
    const wrongPriorityIssue = createIssue({
      key: 'TBX-2',
      issueTypeName: 'Bug',
      priorityName: 'Low',
      statusName: 'In Progress',
      assigneeName: 'Alice',
      fixVersionNames: ['2025.01'],
      piValue: 'PI-2',
    });
    const wrongPiIssue = createIssue({
      key: 'TBX-3',
      issueTypeName: 'Story',
      priorityName: 'High',
      statusName: 'In Progress',
      assigneeName: 'Bob',
      fixVersionNames: ['2025.01'],
      piValue: 'PI-1',
    });

    const filteredIssues = applyMultiCriteriaFilters(
      [matchingIssue, wrongPriorityIssue, wrongPiIssue],
      {
        issueTypes: ['Bug', 'Story'],
        priorities: ['High'],
        statuses: ['In Progress'],
        fixVersion: '2025.01',
        piValue: 'PI-2',
      },
      ['Alice', 'Bob'],
    );

    expect(filteredIssues).toEqual([matchingIssue]);
  });

  it('applyMultiCriteriaFilters returns all issues when no filters are active', () => {
    const issues = [
      createIssue({ key: 'TBX-1', assigneeName: 'Alice' }),
      createIssue({ key: 'TBX-2', assigneeName: 'Bob', priorityName: null }),
    ];

    expect(
      applyMultiCriteriaFilters(issues, DEFAULT_MULTI_CRITERIA_FILTERS, []),
    ).toEqual(issues);
  });
});
