// flowAuditFetch.test.ts — Unit tests for paged issue fetching and the two ceilings.
//
// The report used to request a single 100-issue page and silently report on whatever came back, so a
// busy person's figures described a subset while claiming to describe the window. Paging fixes that;
// the ceilings stop a roster over "All history" running unbounded. Both must be reportable, because a
// truncated figure presented as complete is worse than no figure.

import { describe, expect, it, vi } from 'vitest';

import {
  ISSUE_PAGE_SIZE,
  PER_PERSON_ISSUE_CEILING,
  RUN_ISSUE_BUDGET,
  fetchAllPersonIssues,
} from './flowAuditFetch.ts';

/** Builds a fetcher that serves `total` issues across pages of ISSUE_PAGE_SIZE. */
function makePagedFetcher(total: number) {
  return vi.fn(async (startAt: number) => {
    const pageEnd = Math.min(startAt + ISSUE_PAGE_SIZE, total);
    return Array.from({ length: Math.max(0, pageEnd - startAt) }, (_unused, index) => `ISSUE-${startAt + index}`);
  });
}

const NO_LIMITS = { remainingRunBudget: RUN_ISSUE_BUDGET };

describe('paging', () => {
  it('returns a single short page without asking for another', async () => {
    const fetchPage = makePagedFetcher(12);

    const outcome = await fetchAllPersonIssues(fetchPage, NO_LIMITS);

    expect(outcome.issues).toHaveLength(12);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('follows pages until the whole window is covered — the old 100 cap is gone', async () => {
    const fetchPage = makePagedFetcher(250);

    const outcome = await fetchAllPersonIssues(fetchPage, NO_LIMITS);

    expect(outcome.issues).toHaveLength(250);
    expect(outcome.ceilingReached).toBeNull();
  });

  it('requests each page from the right offset', async () => {
    const fetchPage = makePagedFetcher(250);

    await fetchAllPersonIssues(fetchPage, NO_LIMITS);

    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual([0, ISSUE_PAGE_SIZE, ISSUE_PAGE_SIZE * 2]);
  });

  it('stops cleanly when a page comes back empty', async () => {
    const fetchPage = vi.fn(async () => []);

    const outcome = await fetchAllPersonIssues(fetchPage, NO_LIMITS);

    expect(outcome.issues).toHaveLength(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('the per-person ceiling', () => {
  it('stops at the ceiling and reports that it did', async () => {
    const fetchPage = makePagedFetcher(PER_PERSON_ISSUE_CEILING + ISSUE_PAGE_SIZE * 2);

    const outcome = await fetchAllPersonIssues(fetchPage, NO_LIMITS);

    expect(outcome.issues).toHaveLength(PER_PERSON_ISSUE_CEILING);
    expect(outcome.ceilingReached).toBe('per-person');
  });

  it('does not report a ceiling when the person sits exactly on it', async () => {
    // Landing exactly on the limit means everything was fetched; claiming truncation would be a lie.
    const fetchPage = makePagedFetcher(PER_PERSON_ISSUE_CEILING);

    const outcome = await fetchAllPersonIssues(fetchPage, NO_LIMITS);

    expect(outcome.issues).toHaveLength(PER_PERSON_ISSUE_CEILING);
    expect(outcome.ceilingReached).toBeNull();
  });
});

describe('the overall run budget', () => {
  it('stops a person short when the roster has nearly exhausted the budget', async () => {
    const fetchPage = makePagedFetcher(1000);

    const outcome = await fetchAllPersonIssues(fetchPage, { remainingRunBudget: 150 });

    expect(outcome.issues).toHaveLength(150);
    expect(outcome.ceilingReached).toBe('run-budget');
  });

  it('reports the run budget, not the per-person ceiling, when the budget binds first', async () => {
    const fetchPage = makePagedFetcher(10_000);

    const outcome = await fetchAllPersonIssues(fetchPage, { remainingRunBudget: 200 });

    expect(outcome.ceilingReached).toBe('run-budget');
  });

  it('fetches nothing at all once the budget is spent', async () => {
    const fetchPage = makePagedFetcher(1000);

    const outcome = await fetchAllPersonIssues(fetchPage, { remainingRunBudget: 0 });

    expect(outcome.issues).toHaveLength(0);
    expect(outcome.ceilingReached).toBe('run-budget');
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

describe('cancellation', () => {
  it('stops between pages when cancelled and says so', async () => {
    const fetchPage = makePagedFetcher(1000);
    let pagesServed = 0;

    const outcome = await fetchAllPersonIssues(fetchPage, {
      remainingRunBudget: RUN_ISSUE_BUDGET,
      isCancelled: () => {
        pagesServed += 1;
        return pagesServed > 2;
      },
    });

    expect(outcome.wasCancelled).toBe(true);
    expect(fetchPage.mock.calls.length).toBeLessThan(10);
  });

  it('does not fetch at all when cancelled before it starts', async () => {
    const fetchPage = makePagedFetcher(1000);

    const outcome = await fetchAllPersonIssues(fetchPage, {
      remainingRunBudget: RUN_ISSUE_BUDGET,
      isCancelled: () => true,
    });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(outcome.wasCancelled).toBe(true);
  });

  it('is not cancelled on a normal completed run', async () => {
    const outcome = await fetchAllPersonIssues(makePagedFetcher(10), NO_LIMITS);

    expect(outcome.wasCancelled).toBe(false);
  });
});

describe('ceiling constants', () => {
  it('bounds a roster run — the per-person ceiling alone would not', () => {
    // Ten people each just under their own ceiling is still ten times the work, which is why the
    // run budget exists as well.
    expect(RUN_ISSUE_BUDGET).toBeGreaterThan(PER_PERSON_ISSUE_CEILING);
    expect(RUN_ISSUE_BUDGET).toBeLessThan(PER_PERSON_ISSUE_CEILING * 100);
  });
});
