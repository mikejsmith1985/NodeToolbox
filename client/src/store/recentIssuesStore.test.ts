// recentIssuesStore.test.ts — Unit tests for the recents reducer, storage tolerance, and store action.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRecentIssues, readStoredRecentIssues, useRecentIssuesStore } from './recentIssuesStore.ts';

const A = { key: 'ABC-1', summary: 'First' };
const B = { key: 'ABC-2', summary: 'Second' };

describe('buildRecentIssues', () => {
  it('adds to an empty list', () => {
    expect(buildRecentIssues([], A)).toEqual([A]);
  });

  it('caps the list at 5, dropping the oldest (last, since the list is most-recent-first)', () => {
    const seed = [1, 2, 3, 4, 5].map((n) => ({ key: `K-${n}`, summary: `S${n}` }));
    const result = buildRecentIssues(seed, { key: 'K-6', summary: 'S6' });
    expect(result).toHaveLength(5);
    expect(result[0].key).toBe('K-6');
    expect(result.some((entry) => entry.key === 'K-5')).toBe(false);
  });

  it('moves a re-viewed key to the top and refreshes its summary', () => {
    const result = buildRecentIssues([A, B], { key: 'ABC-1', summary: 'First (updated)' });
    expect(result).toEqual([{ key: 'ABC-1', summary: 'First (updated)' }, B]);
  });
});

describe('readStoredRecentIssues', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns [] when nothing is stored', () => {
    expect(readStoredRecentIssues()).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    window.localStorage.setItem('tbxRecentIssueKeys', '{not json');
    expect(readStoredRecentIssues()).toEqual([]);
  });

  it('drops entries missing key/summary', () => {
    window.localStorage.setItem('tbxRecentIssueKeys', JSON.stringify([A, { key: 'X' }, 'bad']));
    expect(readStoredRecentIssues()).toEqual([A]);
  });
});

describe('useRecentIssuesStore.recordRecent', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useRecentIssuesStore.setState({ entries: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('records an entry and mirrors it to localStorage', () => {
    useRecentIssuesStore.getState().recordRecent(A);
    expect(useRecentIssuesStore.getState().entries).toEqual([A]);
    expect(JSON.parse(window.localStorage.getItem('tbxRecentIssueKeys') ?? '[]')).toEqual([A]);
  });

  it('still updates in memory when storage write throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => useRecentIssuesStore.getState().recordRecent(B)).not.toThrow();
    expect(useRecentIssuesStore.getState().entries).toEqual([B]);
  });
});
