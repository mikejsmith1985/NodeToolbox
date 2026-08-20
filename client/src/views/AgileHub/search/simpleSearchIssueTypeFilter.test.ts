// simpleSearchIssueTypeFilter.test.ts — Narrowing a keyword search to one kind of issue.

import { describe, expect, it } from 'vitest';

import {
  ALL_ISSUE_TYPES,
  filterResultsByIssueType,
  readAvailableIssueTypes,
} from './simpleSearchIssueTypeFilter.ts';
import type { SimpleSearchResult } from './useSimpleSearchState.ts';

function result(key: string, issueType: string): SimpleSearchResult {
  return {
    key,
    summary: key,
    issueType,
    status: 'To Do',
    assigneeName: '',
    created: '',
    updated: '',
    hierarchyLevel: 'team',
    matchLocation: 'summary',
    projectKey: 'ENFCT',
  };
}

describe('readAvailableIssueTypes', () => {
  it('lists the types actually present, alphabetically', () => {
    // From the results, not from Jira's full catalogue: offering "Epic" on a search that returned
    // none is a control whose only possible outcome is an empty screen.
    const types = readAvailableIssueTypes([result('A-1', 'Story'), result('A-2', 'Defect'), result('A-3', 'Story')]);

    expect(types).toEqual(['Defect', 'Story']);
  });

  it('treats one type spelled two ways as one, keeping the first spelling Jira used', () => {
    // A filter labelled differently from the rows it filters reads as a bug.
    expect(readAvailableIssueTypes([result('A-1', 'Story'), result('A-2', 'story')])).toEqual(['Story']);
  });

  it('ignores a result with no type rather than offering a blank option', () => {
    expect(readAvailableIssueTypes([result('A-1', 'Story'), result('A-2', '  ')])).toEqual(['Story']);
  });

  it('is empty for no results', () => {
    expect(readAvailableIssueTypes([])).toEqual([]);
  });
});

describe('filterResultsByIssueType', () => {
  const RESULTS = [result('A-1', 'Story'), result('A-2', 'Defect'), result('A-3', 'Sub-task')];

  it('returns everything when no type is chosen', () => {
    expect(filterResultsByIssueType(RESULTS, ALL_ISSUE_TYPES)).toHaveLength(3);
  });

  it('keeps only the chosen type', () => {
    expect(filterResultsByIssueType(RESULTS, 'Defect').map((kept) => kept.key)).toEqual(['A-2']);
  });

  it('matches regardless of the case Jira reports', () => {
    expect(filterResultsByIssueType(RESULTS, 'sub-task').map((kept) => kept.key)).toEqual(['A-3']);
  });

  it('returns nothing for a type not present, rather than quietly returning everything', () => {
    // Ignoring a filter somebody set is how a screen shows rows that contradict the control above it.
    expect(filterResultsByIssueType(RESULTS, 'Epic')).toEqual([]);
  });

  it('does not hand back the caller\'s own array, so a sort cannot reorder the source', () => {
    const unfiltered = filterResultsByIssueType(RESULTS, ALL_ISSUE_TYPES);

    expect(unfiltered).not.toBe(RESULTS);
  });
});
