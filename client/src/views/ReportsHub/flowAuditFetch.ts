// flowAuditFetch.ts — Pages one unit of analysis' issues out of Jira, bounded by two ceilings.
//
// A "unit" is whatever the running report analyses one at a time: a person, for the Personal Workflow
// report, or an issue, for the Flow Analysis. Both need identical bounding, so the names here are
// deliberately unit-neutral — a second copy of this logic would eventually drift from the first.
//
// The report used to request one page of 100 issues and report on whatever came back. For anyone
// busier than that, the figures described a subset while presenting themselves as complete — and a
// Jira link beside them would have returned everything, so the number and its own evidence
// disagreed. Paging removes that.
//
// Removing the cap outright is not safe either: the window picker offers "All history" (3650 days),
// and a whole roster over all history is one click away. So there are two ceilings — one per unit,
// one for the run — and whichever is reached first stops the analysis. A ceiling being reached is
// always reported, because truncated figures presented as complete are worse than no figures.
//
// The fetcher is injected, so this module has no dependency on Jira, React, or the clock, and every
// boundary condition below is exercised in a unit test.

/** Issues requested per Jira page. Each carries its changelog, so pages are deliberately modest. */
export const ISSUE_PAGE_SIZE = 100;

/** Most issues analysed for any one unit before its figures are declared partial. */
export const PER_UNIT_ISSUE_CEILING = 500;

/**
 * Most issues analysed across a whole run. A per-unit ceiling alone does not bound a roster: fifteen
 * people each just under their own limit is still fifteen times the work.
 */
export const RUN_ISSUE_BUDGET = 5_000;

/** Which limit stopped the analysis, when one did. */
export type FlowFetchCeiling = 'per-unit' | 'run-budget';

/** What one unit's paged fetch produced, and whether it was complete. */
export interface UnitFetchOutcome<TIssue> {
  issues: TIssue[];
  /** Null when everything in the window was fetched; otherwise the limit that stopped it. */
  ceilingReached: FlowFetchCeiling | null;
  /** True when the user cancelled mid-run. A cancelled run must produce no document. */
  wasCancelled: boolean;
}

export interface UnitFetchOptions {
  /** How much of the whole-run budget is still available when this unit starts. */
  remainingRunBudget: number;
  /** Checked between pages so a long roster run can be abandoned promptly. */
  isCancelled?: () => boolean;
}

/**
 * Fetches every issue for one unit, page by page, stopping at whichever limit binds first.
 *
 * `fetchPage` receives the offset to start from and returns that page's issues; a page shorter than
 * `ISSUE_PAGE_SIZE` means there are no more.
 */
export async function fetchAllUnitIssues<TIssue>(
  fetchPage: (startAt: number) => Promise<TIssue[]>,
  options: UnitFetchOptions,
): Promise<UnitFetchOutcome<TIssue>> {
  const allowance = Math.min(PER_UNIT_ISSUE_CEILING, Math.max(0, options.remainingRunBudget));
  // Which limit is doing the binding matters to the reader: "we stopped at your ceiling" and "we ran
  // out of budget part-way through the roster" are different facts about their figures.
  const bindingCeiling: FlowFetchCeiling =
    options.remainingRunBudget < PER_UNIT_ISSUE_CEILING ? 'run-budget' : 'per-unit';

  const issues: TIssue[] = [];
  if (options.isCancelled?.()) {
    return { issues, ceilingReached: null, wasCancelled: true };
  }
  if (allowance === 0) {
    return { issues, ceilingReached: bindingCeiling, wasCancelled: false };
  }

  let startAt = 0;
  for (;;) {
    const page = await fetchPage(startAt);
    issues.push(...page);

    // A short page means Jira has no more to give — the window is fully covered.
    if (page.length < ISSUE_PAGE_SIZE) {
      return { issues, ceilingReached: null, wasCancelled: false };
    }
    // Deliberately `>` and not `>=`: landing EXACTLY on the allowance does not prove there is more to
    // come, and reporting "incomplete" for a person whose work happened to total the limit exactly
    // would be a false claim about their figures. One further page settles it — it comes back short
    // (complete) or pushes us over (genuinely truncated).
    if (issues.length > allowance) {
      // Trim to the allowance so the reported count matches what was actually analysed.
      return { issues: issues.slice(0, allowance), ceilingReached: bindingCeiling, wasCancelled: false };
    }
    if (options.isCancelled?.()) {
      return { issues, ceilingReached: null, wasCancelled: true };
    }
    startAt += ISSUE_PAGE_SIZE;
  }
}
