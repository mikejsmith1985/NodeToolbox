// boardFilters.test.ts — Proves the quick filters narrow what is shown and nothing more.
//
// The distinction that matters here is between "the viewer has not filtered" and "the board has
// hidden everything". An empty type-filter set means the former; treating it as the latter would
// blank the board the moment someone cleared a filter.

import { describe, expect, it } from 'vitest';

import { EMPTY_QUICK_FILTER_STATE, hasActiveFilters, selectMatchingItems } from './boardFilters.ts';
import type { IssueTypeBucket, RollupBoardItem } from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

interface BuildItemInput {
  key: string;
  typeBucket?: IssueTypeBucket;
  assigneeAccountId?: string | null;
  fixVersionNames?: string[];
}

function buildItem({ key, typeBucket = 'story', assigneeAccountId = null, fixVersionNames = [] }: BuildItemInput): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket,
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId: 'col-todo',
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId,
    assigneeDisplayName: null,
    fixVersionNames,
    storyPoints: null,
    checklistCompletion: null,
  };
}

const ALL_ITEMS = [
  buildItem({ key: 'DEV-1', typeBucket: 'story', assigneeAccountId: 'acct-a', fixVersionNames: ['26.4'] }),
  buildItem({ key: 'BUG-1', typeBucket: 'defect', assigneeAccountId: 'acct-a', fixVersionNames: ['26.5'] }),
  buildItem({ key: 'SUB-1', typeBucket: 'subtask', assigneeAccountId: 'acct-b', fixVersionNames: [] }),
  buildItem({ key: 'SPIKE-1', typeBucket: 'other', assigneeAccountId: null, fixVersionNames: [] }),
];

describe('selectMatchingItems', () => {
  it('returns everything when no filter is active', () => {
    expect(selectMatchingItems(ALL_ITEMS, EMPTY_QUICK_FILTER_STATE)).toHaveLength(4);
  });

  it('treats an empty type set as "no type filter", not as "match nothing"', () => {
    // Getting this backwards would blank the board the instant someone cleared a filter.
    expect(selectMatchingItems(ALL_ITEMS, { ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set() })).toHaveLength(4);
  });

  it('narrows to one type', () => {
    const matched = selectMatchingItems(ALL_ITEMS, {
      ...EMPTY_QUICK_FILTER_STATE,
      typeBuckets: new Set(['defect' as const]),
    });

    expect(matched.map((item) => item.key)).toEqual(['BUG-1']);
  });

  it('accepts several types at once', () => {
    const matched = selectMatchingItems(ALL_ITEMS, {
      ...EMPTY_QUICK_FILTER_STATE,
      typeBuckets: new Set(['defect' as const, 'subtask' as const]),
    });

    expect(matched.map((item) => item.key)).toEqual(['BUG-1', 'SUB-1']);
  });

  it('hides neutral-type issues whenever a type filter is active, since no filter selects them', () => {
    const matched = selectMatchingItems(ALL_ITEMS, {
      ...EMPTY_QUICK_FILTER_STATE,
      typeBuckets: new Set(['story' as const]),
    });

    expect(matched.map((item) => item.key)).not.toContain('SPIKE-1');
  });

  it('narrows to one person', () => {
    const matched = selectMatchingItems(ALL_ITEMS, { ...EMPTY_QUICK_FILTER_STATE, assigneeAccountId: 'acct-b' });

    expect(matched.map((item) => item.key)).toEqual(['SUB-1']);
  });

  it('excludes unassigned work when a person is chosen', () => {
    const matched = selectMatchingItems(ALL_ITEMS, { ...EMPTY_QUICK_FILTER_STATE, assigneeAccountId: 'acct-a' });

    expect(matched.map((item) => item.key)).not.toContain('SPIKE-1');
  });

  it('narrows to one fix version', () => {
    const matched = selectMatchingItems(ALL_ITEMS, { ...EMPTY_QUICK_FILTER_STATE, fixVersionName: '26.4' });

    expect(matched.map((item) => item.key)).toEqual(['DEV-1']);
  });

  it('combines filters with AND, so one person\'s defects is two clicks', () => {
    const matched = selectMatchingItems(ALL_ITEMS, {
      typeBuckets: new Set(['defect' as const]),
      assigneeAccountId: 'acct-a',
      fixVersionName: null,
    });

    expect(matched.map((item) => item.key)).toEqual(['BUG-1']);
  });

  it('returns nothing when the combination genuinely matches nothing', () => {
    const matched = selectMatchingItems(ALL_ITEMS, {
      typeBuckets: new Set(['defect' as const]),
      assigneeAccountId: 'acct-b',
      fixVersionName: null,
    });

    expect(matched).toEqual([]);
  });

  it('never mutates the list it was given', () => {
    const originalOrder = ALL_ITEMS.map((item) => item.key);

    selectMatchingItems(ALL_ITEMS, { ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set(['defect' as const]) });

    expect(ALL_ITEMS.map((item) => item.key)).toEqual(originalOrder);
  });
});

describe('hasActiveFilters', () => {
  it('is false when nothing is filtered, so lanes report a plain item count', () => {
    expect(hasActiveFilters(EMPTY_QUICK_FILTER_STATE)).toBe(false);
  });

  it('is true for a type filter', () => {
    expect(hasActiveFilters({ ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set(['story' as const]) })).toBe(true);
  });

  it('is true for an assignee filter', () => {
    expect(hasActiveFilters({ ...EMPTY_QUICK_FILTER_STATE, assigneeAccountId: 'acct-a' })).toBe(true);
  });

  it('is true for a fix version filter', () => {
    expect(hasActiveFilters({ ...EMPTY_QUICK_FILTER_STATE, fixVersionName: '26.4' })).toBe(true);
  });
});
