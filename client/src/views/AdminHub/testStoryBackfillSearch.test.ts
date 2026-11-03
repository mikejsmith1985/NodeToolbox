// testStoryBackfillSearch.test.ts — Proves the backfill's search survives a struggling gateway without losing issues.
//
// A missed source issue could make the clean-up copy text from the wrong tier, so the rules tested here are
// about completeness: smaller pages never skip rows, a short page is not mistaken for the end, and a failure
// that cannot be retried stops the run and says where it stopped.

import { describe, expect, it, vi } from 'vitest';

import {
  fetchSearchAdaptively,
  isGatewayFailure,
  type AdaptiveSearchPage,
} from './testStoryBackfillSearch.ts';

const GATEWAY_FAILURE = 'Jira GET /rest/api/2/search failed: 502';
const SEARCH_OPTIONS = { initialPageSize: 20, minimumPageSize: 5, ceiling: 1000 };

/** Builds issues numbered from an offset, standing in for one page of a search. */
function makeIssues(startAt: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => startAt + i);
}

/** A fake search over `total` issues that refuses any page larger than `largestAllowedPage`. */
function makeSearch(total: number, largestAllowedPage = total): (startAt: number, pageSize: number) => Promise<AdaptiveSearchPage<number>> {
  return async (startAt, pageSize) => {
    if (pageSize > largestAllowedPage) throw new Error(GATEWAY_FAILURE);
    return { issues: makeIssues(startAt, Math.min(pageSize, Math.max(total - startAt, 0))), total };
  };
}

describe('isGatewayFailure', () => {
  it('recognises a 502, 503 or 504, with or without detail', () => {
    expect(isGatewayFailure(GATEWAY_FAILURE)).toBe(true);
    expect(isGatewayFailure('Jira GET /x failed: 504 — Proxy error: socket hang up')).toBe(true);
    expect(isGatewayFailure('Jira GET /x failed: 503')).toBe(true);
  });

  it('ignores failures a smaller page cannot fix', () => {
    expect(isGatewayFailure('Jira GET /x failed: 400 — bad JQL')).toBe(false);
    expect(isGatewayFailure('Jira GET /x failed: 502 — Service not configured: Set the base URL')).toBe(false);
    expect(isGatewayFailure('Jira GET /x failed: 502 — Invalid target URL: bad')).toBe(false);
  });

  it('is not fooled by a 502 inside an issue key in the url', () => {
    expect(isGatewayFailure('Jira GET /rest/api/2/issue/ENCUC-502 failed: 404')).toBe(false);
  });
});

describe('fetchSearchAdaptively', () => {
  it('reads every page of a search', async () => {
    const outcome = await fetchSearchAdaptively(makeSearch(45), SEARCH_OPTIONS);
    expect(outcome.issues).toEqual(makeIssues(0, 45));
    expect(outcome.isTruncated).toBe(false);
    expect(outcome.smallestPageSize).toBe(20);
  });

  it('halves the page after a gateway failure and still returns every issue, in order', async () => {
    const onPageSizeReduced = vi.fn();
    const outcome = await fetchSearchAdaptively(makeSearch(45, 7), { ...SEARCH_OPTIONS, onPageSizeReduced });
    expect(outcome.issues).toEqual(makeIssues(0, 45));
    expect(outcome.smallestPageSize).toBe(5);
    expect(onPageSizeReduced).toHaveBeenCalledTimes(2);
  });

  it('keeps going past a short page when Jira says more issues exist', async () => {
    // Jira may cap maxResults below what was asked for; treating that as the end would silently lose issues.
    const cappedSearch = async (startAt: number): Promise<AdaptiveSearchPage<number>> => (
      { issues: makeIssues(startAt, Math.min(3, Math.max(10 - startAt, 0))), total: 10 }
    );
    const outcome = await fetchSearchAdaptively(cappedSearch, SEARCH_OPTIONS);
    expect(outcome.issues).toEqual(makeIssues(0, 10));
  });

  it('stops on an empty page even when the total promises more', async () => {
    const lyingSearch = vi.fn(async (): Promise<AdaptiveSearchPage<number>> => ({ issues: [], total: 10 }));
    const outcome = await fetchSearchAdaptively(lyingSearch, SEARCH_OPTIONS);
    expect(lyingSearch).toHaveBeenCalledTimes(1);
    expect(outcome.isTruncated).toBe(true);
  });

  it('treats a short page as the end when Jira gives no total', async () => {
    const noTotalSearch = vi.fn(async (): Promise<AdaptiveSearchPage<number>> => ({ issues: [1, 2] }));
    const outcome = await fetchSearchAdaptively(noTotalSearch, SEARCH_OPTIONS);
    expect(noTotalSearch).toHaveBeenCalledTimes(1);
    expect(outcome.issues).toEqual([1, 2]);
  });

  it('reports truncation when the ceiling leaves issues behind', async () => {
    const outcome = await fetchSearchAdaptively(makeSearch(45), { ...SEARCH_OPTIONS, ceiling: 20 });
    expect(outcome.issues).toHaveLength(20);
    expect(outcome.totalMatchingCount).toBe(45);
    expect(outcome.isTruncated).toBe(true);
  });

  it('gives up at the minimum page and says where it stopped', async () => {
    const alwaysFailing = async (): Promise<AdaptiveSearchPage<number>> => { throw new Error(GATEWAY_FAILURE); };
    await expect(fetchSearchAdaptively(alwaysFailing, SEARCH_OPTIONS))
      .rejects.toThrow(`at row 0 with page size 5: ${GATEWAY_FAILURE}`);
  });

  it('does not retry a failure a smaller page cannot fix', async () => {
    const rejectedSearch = vi.fn(async (): Promise<AdaptiveSearchPage<number>> => { throw new Error('Jira GET /x failed: 400 — bad JQL'); });
    await expect(fetchSearchAdaptively(rejectedSearch, SEARCH_OPTIONS)).rejects.toThrow('400 — bad JQL');
    expect(rejectedSearch).toHaveBeenCalledTimes(1);
  });

  it('reports progress as pages land', async () => {
    const onProgress = vi.fn();
    await fetchSearchAdaptively(makeSearch(30), { ...SEARCH_OPTIONS, onProgress });
    expect(onProgress).toHaveBeenLastCalledWith(30, 30);
  });
});
