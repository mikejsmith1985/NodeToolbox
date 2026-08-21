// rollup.test.ts — Unit tests for Pipeline View pure rollup helpers.

import { describe, expect, it } from 'vitest';

import {
  calculateCompletionPercent,
  calculateStoryPointRollup,
  countCompletedChildren,
  normalizeStatusCategoryKey,
  readStoryPoints,
  STORY_POINTS_FIELD_FALLBACK,
  STORY_POINTS_FIELD_PREFERRED,
  type ChildIssue,
} from './rollup.ts';

const SAMPLE_CHILDREN: ChildIssue[] = [
  {
    key: 'TBX-11',
    summary: 'Build service',
    status: 'Done',
    statusCategoryKey: 'done',
    storyPoints: 5,
  },
  {
    key: 'TBX-12',
    summary: 'Build screen',
    status: 'In Dev',
    statusCategoryKey: 'indeterminate',
    storyPoints: 3,
  },
  {
    key: 'TBX-13',
    summary: 'Write copy',
    status: 'Open',
    statusCategoryKey: 'new',
    storyPoints: null,
  },
];

describe('Pipeline rollup helpers', () => {
  it('readStoryPoints prefers the modern Jira field when both known fields exist', () => {
    expect(readStoryPoints({ customfield_10028: 8, customfield_10016: 3 })).toBe(8);
  });

  it('readStoryPoints falls back to the legacy Jira field when the modern field is blank', () => {
    expect(readStoryPoints({ customfield_10028: null, customfield_10016: 5 })).toBe(5);
  });

  it('readStoryPoints returns null when no known story-point field has a number', () => {
    expect(readStoryPoints({ customfield_10028: null, customfield_10016: undefined })).toBeNull();
  });

  it('calculateStoryPointRollup sums loaded child story points and treats missing points as zero', () => {
    expect(calculateStoryPointRollup(SAMPLE_CHILDREN, 13)).toBe(8);
  });

  it('calculateStoryPointRollup falls back to the epic points before children are loaded', () => {
    expect(calculateStoryPointRollup(null, 13)).toBe(13);
    expect(calculateStoryPointRollup([], 8)).toBe(8);
  });

  it('calculateStoryPointRollup returns zero when neither epic nor children have story points', () => {
    expect(calculateStoryPointRollup(null, null)).toBe(0);
  });

  it('calculateCompletionPercent rounds done children over total children', () => {
    expect(calculateCompletionPercent(SAMPLE_CHILDREN)).toBe(33);
  });

  it('calculateCompletionPercent returns zero when children are not loaded or empty', () => {
    expect(calculateCompletionPercent(null)).toBe(0);
    expect(calculateCompletionPercent([])).toBe(0);
  });

  it('countCompletedChildren counts only Jira done-category children', () => {
    expect(countCompletedChildren(SAMPLE_CHILDREN)).toBe(1);
  });

  it('normalizeStatusCategoryKey keeps known categories and maps unknown values to in-progress', () => {
    expect(normalizeStatusCategoryKey('new')).toBe('new');
    expect(normalizeStatusCategoryKey('done')).toBe('done');
    expect(normalizeStatusCategoryKey('whatever')).toBe('indeterminate');
  });
});

describe('readStoryPoints — the shape Jira actually returns', () => {
  // This instance keeps story points in a SELECT field, so Jira returns { id, value }. A reader
  // accepting only `typeof === 'number'` missed every estimate and reported fully-pointed work as
  // unpointed, silently.

  it('reads a plain numeric field', () => {
    expect(readStoryPoints({ [STORY_POINTS_FIELD_PREFERRED]: 5 })).toBe(5);
  });

  it('reads a SELECT field, which is how this instance stores them', () => {
    expect(readStoryPoints({ [STORY_POINTS_FIELD_PREFERRED]: { id: '1', value: '5' } })).toBe(5);
  });

  it('falls back to the legacy field when the preferred one holds nothing', () => {
    expect(readStoryPoints({ [STORY_POINTS_FIELD_FALLBACK]: 8 })).toBe(8);
  });

  it('reports an unestimated issue as unestimated', () => {
    expect(readStoryPoints({})).toBeNull();
  });

  it('treats an explicitly cleared select as unestimated rather than as a value', () => {
    expect(readStoryPoints({ [STORY_POINTS_FIELD_PREFERRED]: { id: '1', value: 'None' } })).toBeNull();
  });
});
