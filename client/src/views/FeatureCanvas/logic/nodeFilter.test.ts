// nodeFilter.test.ts — Verifies the legend focus-filter matcher and equality helper.

import { describe, expect, it } from 'vitest';

import { isSameFilter, nodeMatchesFilter } from './nodeFilter.ts';

describe('nodeMatchesFilter', () => {
  it('matches everything when there is no filter', () => {
    expect(nodeMatchesFilter({ statusCategoryKey: 'done', health: 'red' }, null)).toBe(true);
  });

  it('matches on status category, treating a null category as "new"', () => {
    expect(nodeMatchesFilter({ statusCategoryKey: 'indeterminate', health: 'green' }, { dimension: 'status', value: 'indeterminate' })).toBe(true);
    expect(nodeMatchesFilter({ statusCategoryKey: 'done', health: 'green' }, { dimension: 'status', value: 'indeterminate' })).toBe(false);
    expect(nodeMatchesFilter({ statusCategoryKey: null, health: 'green' }, { dimension: 'status', value: 'new' })).toBe(true);
  });

  it('matches on health', () => {
    expect(nodeMatchesFilter({ statusCategoryKey: 'new', health: 'red' }, { dimension: 'health', value: 'red' })).toBe(true);
    expect(nodeMatchesFilter({ statusCategoryKey: 'new', health: 'green' }, { dimension: 'health', value: 'red' })).toBe(false);
  });
});

describe('isSameFilter', () => {
  it('treats identical dimension+value as the same, and null==null', () => {
    expect(isSameFilter({ dimension: 'status', value: 'done' }, { dimension: 'status', value: 'done' })).toBe(true);
    expect(isSameFilter(null, null)).toBe(true);
  });

  it('treats different dimension/value or null-vs-set as different', () => {
    expect(isSameFilter({ dimension: 'status', value: 'done' }, { dimension: 'health', value: 'done' })).toBe(false);
    expect(isSameFilter({ dimension: 'status', value: 'done' }, { dimension: 'status', value: 'new' })).toBe(false);
    expect(isSameFilter(null, { dimension: 'status', value: 'done' })).toBe(false);
  });
});
