// hygieneSort.ts — Pure sort comparators for the Hygiene findings list.
//
// The findings list defaults to scan order; when a cleanup pass benefits from grouping
// (all one status, one assignee, one issue type, or oldest-idle first) the view offers
// these sorts. Kept pure and shared so every surface that lists findings orders them
// identically (agree-by-construction).

import type { HygieneFinding } from './checks/hygieneChecks.ts';

/** The offered orderings; 'scan' is the untouched order the scan returned. */
export type HygieneSortKey = 'scan' | 'status' | 'assignee' | 'issueType' | 'age';

/** The sort choices in the order the view offers them. */
export const HYGIENE_SORT_OPTIONS: ReadonlyArray<{ value: HygieneSortKey; label: string }> = [
  { value: 'scan', label: 'Scan order' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'issueType', label: 'Issue type' },
  { value: 'age', label: 'Age (oldest first)' },
];

// Missing values (no status, unassigned, no dates) always sort AFTER real values so the
// actionable groupings surface first; '￿' is a text key greater than any real name.
const MISSING_TEXT_SORT_KEY = '￿';

/** Reads the text this sort key groups by, or the sentinel that sorts missing values last. */
function readTextSortKey(finding: HygieneFinding, sortKey: HygieneSortKey): string {
  const issueFields = finding.issue.fields;
  if (sortKey === 'status') return issueFields.status?.name?.trim() || MISSING_TEXT_SORT_KEY;
  if (sortKey === 'assignee') return issueFields.assignee?.displayName?.trim() || MISSING_TEXT_SORT_KEY;
  return issueFields.issuetype?.name?.trim() || MISSING_TEXT_SORT_KEY;
}

/** The idle-clock timestamp: last update wins, else creation; unparseable dates sort last. */
function readIdleTimestamp(finding: HygieneFinding): number {
  const idleDateText = finding.issue.fields.updated ?? finding.issue.fields.created;
  const parsedTimestamp = idleDateText ? new Date(idleDateText).getTime() : Number.NaN;
  return Number.isFinite(parsedTimestamp) ? parsedTimestamp : Number.POSITIVE_INFINITY;
}

/** Returns a NEW array of findings in the requested order; 'scan' preserves the input order. */
export function sortHygieneFindings(
  findings: readonly HygieneFinding[],
  sortKey: HygieneSortKey,
): HygieneFinding[] {
  const sortedFindings = [...findings];
  if (sortKey === 'scan') return sortedFindings;
  if (sortKey === 'age') {
    // Oldest idle timestamp first — the finding that has waited longest for attention leads.
    return sortedFindings.sort((first, second) => readIdleTimestamp(first) - readIdleTimestamp(second));
  }
  return sortedFindings.sort((first, second) =>
    readTextSortKey(first, sortKey).localeCompare(readTextSortKey(second, sortKey)));
}
