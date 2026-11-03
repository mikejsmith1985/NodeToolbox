// testStoryBackfillSearch.ts — Reads a whole Jira search for the [QE]/[SL] backfill, asking for less when a gateway struggles.
//
// The backfill's first real run stopped on a bare 502 during its read-only preview. A gateway in front of
// Jira can refuse a request simply for being too much work, so a refused page is retried at half the size
// instead of ending the run. Every row must still be read: a source issue that goes missing could send a
// field down to the wrong tier of the source chain, so a failure that cannot be retried stops the whole run.
//
// Custom rather than fetchIssuesPaged, whose page size is fixed and which reads a short page as the end of the
// results — shrinking the page there would silently lose issues.

import type { JiraSearchPage } from '../../services/fetchIssuesPaged.ts';

// ── Named constants ──

/** The statuses a gateway answers with when it gave up on the work behind it, not when the request was wrong. */
const GATEWAY_FAILURE_PATTERN = /failed: 50[234]\b/;
/** NodeToolbox's own 502s for a missing or broken Jira address; asking for fewer rows cannot fix these. */
const SETUP_FAILURE_PATTERN = /Service not configured|Invalid target URL/;
const PAGE_SIZE_REDUCTION_FACTOR = 2;

// ── Types ──

export type AdaptiveSearchPage<TIssue> = JiraSearchPage<TIssue>;

export interface AdaptiveSearchOptions {
  /** How many issues to ask for at first. */
  initialPageSize: number;
  /** The smallest page worth trying; a refusal at this size is a real failure, not an oversized request. */
  minimumPageSize: number;
  /** The most issues this caller is willing to hold. */
  ceiling: number;
  /** Told how far the read has got, so a long run does not look frozen. */
  onProgress?: (retrievedCount: number, totalMatchingCount: number) => void;
  /** Told each time a refused page forces a smaller one. */
  onPageSizeReduced?: (nextPageSize: number) => void;
}

export interface AdaptiveSearchOutcome<TIssue> {
  issues: TIssue[];
  totalMatchingCount: number;
  /** True only when issues matching the search were left unread. */
  isTruncated: boolean;
  /** The page size the read finished on. */
  smallestPageSize: number;
}

// ── Helpers ──

/** True when a failed request's message describes a gateway refusal that a smaller page might avoid. */
export function isGatewayFailure(failureMessage: string): boolean {
  return GATEWAY_FAILURE_PATTERN.test(failureMessage) && !SETUP_FAILURE_PATTERN.test(failureMessage);
}

/** Decides whether another page is worth requesting after the one just read. */
function hasMorePages(
  pageIssueCount: number,
  pageSize: number,
  retrievedCount: number,
  reportedTotal: number | null,
  ceiling: number,
): boolean {
  if (pageIssueCount === 0 || retrievedCount >= ceiling) return false;
  // Jira can serve fewer rows than asked for, so its total outranks a short page whenever it gave one.
  if (reportedTotal !== null) return retrievedCount < reportedTotal;
  return pageIssueCount >= pageSize;
}

// ── Search ──

/**
 * Reads every page of a search up to the ceiling, halving the page size whenever a gateway refuses one.
 * Throws, naming the row and page size it stopped at, on any failure a smaller page cannot help.
 */
export async function fetchSearchAdaptively<TIssue>(
  fetchPage: (startAt: number, pageSize: number) => Promise<AdaptiveSearchPage<TIssue>>,
  options: AdaptiveSearchOptions,
): Promise<AdaptiveSearchOutcome<TIssue>> {
  const issues: TIssue[] = [];
  let pageSize = options.initialPageSize;
  let reportedTotal: number | null = null;

  for (;;) {
    let page: AdaptiveSearchPage<TIssue>;
    try {
      page = await fetchPage(issues.length, pageSize);
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      if (!isGatewayFailure(failureMessage) || pageSize <= options.minimumPageSize) {
        throw new Error(`Search stopped at row ${issues.length} with page size ${pageSize}: ${failureMessage}`, { cause: error });
      }
      pageSize = Math.max(options.minimumPageSize, Math.floor(pageSize / PAGE_SIZE_REDUCTION_FACTOR));
      options.onPageSizeReduced?.(pageSize);
      continue;
    }

    const pageIssues = page.issues ?? [];
    issues.push(...pageIssues);
    if (typeof page.total === 'number') reportedTotal = page.total;
    options.onProgress?.(issues.length, reportedTotal ?? issues.length);
    if (!hasMorePages(pageIssues.length, pageSize, issues.length, reportedTotal, options.ceiling)) break;
  }

  const retrievedIssues = issues.slice(0, options.ceiling);
  const totalMatchingCount = reportedTotal ?? retrievedIssues.length;
  return {
    issues: retrievedIssues,
    totalMatchingCount,
    isTruncated: totalMatchingCount > retrievedIssues.length,
    smallestPageSize: pageSize,
  };
}
