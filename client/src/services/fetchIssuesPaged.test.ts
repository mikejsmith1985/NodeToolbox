// fetchIssuesPaged.test.ts — Pins the paging loop and, above all, its honesty when it stops short.

import { describe, expect, it, vi } from 'vitest';

import { fetchIssuesPaged } from './fetchIssuesPaged.ts';

/** Builds a fake Jira search responder holding `totalIssues` issues, served in pages. */
function buildJiraStub(totalIssues: number) {
  const fetchPage = vi.fn(async (startAt: number, pageSize: number) => ({
    total: totalIssues,
    issues: Array.from(
      { length: Math.max(0, Math.min(pageSize, totalIssues - startAt)) },
      (_unused, indexInPage) => ({ key: `ISSUE-${startAt + indexInPage}` }),
    ),
  }));
  return fetchPage;
}

describe('fetchIssuesPaged', () => {
  it('returns everything in one page when everything fits', async () => {
    const fetchPage = buildJiraStub(12);

    const outcome = await fetchIssuesPaged(fetchPage, { pageSize: 100, ceiling: 1000 });

    expect(outcome.issues).toHaveLength(12);
    expect(outcome.isTruncated).toBe(false);
    expect(outcome.totalMatchingCount).toBe(12);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('walks the pages until Jira runs out', async () => {
    // The defect this fixes: a single request capped at 100 (Today) or 200 (Hygiene) returned a
    // count that was simply wrong, with nothing on screen to say so.
    const fetchPage = buildJiraStub(250);

    const outcome = await fetchIssuesPaged(fetchPage, { pageSize: 100, ceiling: 1000 });

    expect(outcome.issues).toHaveLength(250);
    expect(outcome.isTruncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops at the ceiling and SAYS it stopped, rather than reporting a short count as complete', async () => {
    const fetchPage = buildJiraStub(900);

    const outcome = await fetchIssuesPaged(fetchPage, { pageSize: 100, ceiling: 300 });

    expect(outcome.issues).toHaveLength(300);
    expect(outcome.isTruncated).toBe(true);
    expect(outcome.totalMatchingCount).toBe(900);
  });

  it('does not call a run that landed exactly on the ceiling truncated', async () => {
    // Landing exactly on the limit does not prove anything was left behind, and claiming otherwise
    // would put a permanent "incomplete" warning on a perfectly complete scan.
    const fetchPage = buildJiraStub(300);

    const outcome = await fetchIssuesPaged(fetchPage, { pageSize: 100, ceiling: 300 });

    expect(outcome.issues).toHaveLength(300);
    expect(outcome.isTruncated).toBe(false);
  });

  it('reports an empty scope as empty, not as truncated', async () => {
    const outcome = await fetchIssuesPaged(buildJiraStub(0), { pageSize: 100, ceiling: 1000 });

    expect(outcome.issues).toEqual([]);
    expect(outcome.isTruncated).toBe(false);
    expect(outcome.totalMatchingCount).toBe(0);
  });

  it('falls back to what it actually received when Jira omits the total', async () => {
    const fetchPage = vi.fn(async () => ({ issues: [{ key: 'A' }, { key: 'B' }] }));

    const outcome = await fetchIssuesPaged(fetchPage, { pageSize: 100, ceiling: 1000 });

    expect(outcome.totalMatchingCount).toBe(2);
    expect(outcome.isTruncated).toBe(false);
  });
});
