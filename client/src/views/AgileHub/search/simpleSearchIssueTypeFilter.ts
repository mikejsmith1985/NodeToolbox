// simpleSearchIssueTypeFilter.ts — Narrowing a search to one kind of issue.
//
// A keyword search returns whatever carries the word: Stories, Defects, Sub-tasks and the Feature
// above them all at once. Most of the time only one of those is being looked for, and scrolling past
// the rest is the whole cost of a search that "worked".
//
// The filter runs over results already in hand rather than in the JQL. That keeps the search itself
// one request — changing the type re-filters instantly instead of going back to Jira — and it means
// the options can be built from what actually came back, so the control can never offer a type that
// would return nothing.

import type { SimpleSearchResult } from './useSimpleSearchState.ts';

/** The value meaning "no filter". Not an issue type, so it can never collide with a real one. */
export const ALL_ISSUE_TYPES = '';

/**
 * The issue types present in a result set, in alphabetical order.
 *
 * Built from the results rather than from Jira's full type list on purpose: a dropdown offering
 * "Epic" on a search that returned no Epics is a control whose only outcome is an empty screen.
 *
 * Types are compared case-insensitively but reported with the spelling Jira used, because that is
 * what the rows themselves show and a filter labelled differently from its rows reads as a bug.
 */
export function readAvailableIssueTypes(results: readonly SimpleSearchResult[]): string[] {
  const firstSpellingByLowercase = new Map<string, string>();
  for (const result of results) {
    const issueType = (result.issueType ?? '').trim();
    if (issueType === '') {
      continue;
    }
    const lowercaseType = issueType.toLowerCase();
    if (!firstSpellingByLowercase.has(lowercaseType)) {
      firstSpellingByLowercase.set(lowercaseType, issueType);
    }
  }

  return [...firstSpellingByLowercase.values()].sort((first, second) => first.localeCompare(second));
}

/**
 * Keeps only the results of one issue type, or all of them when no type is chosen.
 *
 * An unrecognised type returns NOTHING rather than everything. Silently ignoring a filter the user
 * set is how a screen comes to show rows that contradict the control above it — better an obviously
 * empty result than a quietly disregarded choice.
 */
export function filterResultsByIssueType(
  results: readonly SimpleSearchResult[],
  selectedIssueType: string,
): SimpleSearchResult[] {
  const normalizedSelection = selectedIssueType.trim().toLowerCase();
  if (normalizedSelection === ALL_ISSUE_TYPES) {
    return [...results];
  }
  return results.filter((result) => (result.issueType ?? '').trim().toLowerCase() === normalizedSelection);
}
