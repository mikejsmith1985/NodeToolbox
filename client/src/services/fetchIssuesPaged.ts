// fetchIssuesPaged.ts — Fetches a Jira search in full, and says so plainly when it cannot.
//
// Both hygiene surfaces used to issue ONE search with a maxResults cap — 100 for the Today
// dashboard's personal fetch, 200 for the hygiene scan — and present whatever came back as the
// answer. Past the cap the count was simply wrong, and nothing on screen said so: a team with 240
// open issues saw a scan of 200 described as the scan, and the forty it never looked at were
// indistinguishable from forty healthy ones.
//
// Two things are needed to fix that, and only one of them is paging. The other is that a run which
// still cannot see everything must say which of the two it is — complete, or capped — because a
// number the reader cannot trust is worse than a number the reader knows to distrust.

/** One page of a Jira search, as much of the response as the paging loop needs. */
export interface JiraSearchPage<TIssue> {
  issues?: TIssue[];
  /** Jira's count of everything matching the JQL, whether or not it was returned. */
  total?: number;
}

export interface PagedFetchOptions {
  /** How many issues to ask for per request. */
  pageSize: number;
  /** The most issues this caller is willing to hold; the loop stops here and reports that it did. */
  ceiling: number;
}

export interface PagedFetchOutcome<TIssue> {
  /** The issues actually retrieved — never more than `ceiling`. */
  issues: TIssue[];
  /** Everything Jira says matches, which is larger than `issues.length` when the ceiling bound. */
  totalMatchingCount: number;
  /** True only when issues matching the search were genuinely left unfetched. */
  isTruncated: boolean;
}

/**
 * Reads a whole Jira search, page by page, up to the caller's ceiling.
 *
 * `fetchPage` is given an offset and a page size and returns that page of the search response.
 * The loop stops when Jira returns a short page (nothing left), when the reported total is reached,
 * or when the ceiling binds — and only the last of those is reported as truncation.
 */
export async function fetchIssuesPaged<TIssue>(
  fetchPage: (startAt: number, pageSize: number) => Promise<JiraSearchPage<TIssue>>,
  options: PagedFetchOptions,
): Promise<PagedFetchOutcome<TIssue>> {
  const issues: TIssue[] = [];
  let reportedTotal: number | null = null;

  for (;;) {
    const page = await fetchPage(issues.length, options.pageSize);
    const pageIssues = page.issues ?? [];
    if (typeof page.total === 'number') {
      reportedTotal = page.total;
    }
    issues.push(...pageIssues);

    // A short page means Jira has nothing further to give, whatever it said the total was.
    if (pageIssues.length < options.pageSize) {
      break;
    }
    // Reaching the reported total is the same completeness, arrived at from the other direction.
    if (reportedTotal !== null && issues.length >= reportedTotal) {
      break;
    }
    if (issues.length >= options.ceiling) {
      break;
    }
  }

  const retrievedIssues = issues.slice(0, options.ceiling);
  const totalMatchingCount = reportedTotal ?? retrievedIssues.length;
  return {
    issues: retrievedIssues,
    totalMatchingCount,
    // Truncated means issues were LEFT BEHIND, which is not the same as having stopped at the
    // ceiling: a search whose total happens to equal the ceiling was fetched in full, and putting
    // an "incomplete" warning on it would be a false claim about a complete scan.
    isTruncated: totalMatchingCount > retrievedIssues.length,
  };
}
