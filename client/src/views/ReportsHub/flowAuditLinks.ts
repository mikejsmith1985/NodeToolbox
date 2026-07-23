// flowAuditLinks.ts — Turns each claim in the audit report into a Jira query a reader can run.
//
// ── Why there are THREE link kinds and not one ──
// The report's fetch query is a deliberate superset of what it counts: `assignee WAS "…" AND
// updated >= -Nd` casts wide on purpose, and the engine does the exact windowing afterwards by each
// completed stint's end. That is harmless for computing, and actively misleading for linking — put
// the fetch JQL beside a credited count and Jira returns MORE issues than the number claims, which
// is precisely the count-vs-link mismatch this report exists to eliminate.
//
// So each claim gets the query that returns exactly itself:
//   • "N issues were fetched"  → the fetch JQL, because that is literally what ran
//   • "N issues were credited" → issueKey in (…) over the credited keys
//   • "N were excluded as X"   → issueKey in (…) over that category's keys
//
// Together they let a reader verify every row of `fetched = credited + excluded` independently.
//
// This module composes existing helpers and builds no URLs itself.

import { buildJiraIssueNavigatorUrl, buildJiraSearchUrl } from '../Hygiene/utils/buildHygieneJqlUrl.ts';
import { buildSearchJql } from './PersonalFlowTab.tsx';

/** One checkable claim: where to click, what the query says, and whether the link actually works. */
export interface EvidenceLink {
  /** A Jira navigator URL, or the raw query text when no base URL is configured. */
  href: string;
  /** The query text, always shown beside the link so a reader can inspect or adapt it. */
  queryText: string;
  /** False when the link degraded to query text, so the UI can render it as text rather than a dead anchor. */
  isClickable: boolean;
}

/**
 * Builds the link for a set of specific issues.
 *
 * `buildJiraIssueNavigatorUrl` already returns the raw JQL when there is no base URL or no keys, so
 * the degraded case is detected by comparing its result rather than re-deriving the rule here.
 */
function buildIssueKeyLink(issueKeys: readonly string[], jiraBaseUrl: string | null): EvidenceLink {
  if (issueKeys.length === 0) {
    // An empty set has nothing to open. Saying so beats emitting `issueKey in ()`, which Jira rejects.
    return { href: '', queryText: 'No issues in this category.', isClickable: false };
  }

  const hrefOrQuery = buildJiraIssueNavigatorUrl([...issueKeys], jiraBaseUrl);
  const queryText = `issueKey in (${issueKeys.join(', ')})`;
  return { href: hrefOrQuery, queryText, isClickable: hrefOrQuery !== queryText };
}

/**
 * The query that actually fetched this person's issues — a deliberate superset of what was counted.
 * Use it only for the "fetched" claim; pairing it with a credited count would overstate that count.
 */
export function buildFetchedIssuesLink(
  personDisplayName: string,
  windowDays: number,
  jiraBaseUrl: string | null,
): EvidenceLink {
  // The same string the report queries with, not a reconstruction — so what a reader sees can never
  // drift from what ran.
  const queryText = buildSearchJql(personDisplayName, windowDays);
  const hrefOrQuery = buildJiraSearchUrl(queryText, jiraBaseUrl);
  return { href: hrefOrQuery, queryText, isClickable: hrefOrQuery !== queryText };
}

/** The issues every credited figure for this person was computed from. */
export function buildCreditedIssuesLink(
  creditedIssueKeys: readonly string[],
  jiraBaseUrl: string | null,
): EvidenceLink {
  return buildIssueKeyLink(creditedIssueKeys, jiraBaseUrl);
}

/**
 * The issues dropped for one exclusion reason, so a reader can confirm each exclusion was correct
 * rather than taking the count on trust.
 */
export function buildExcludedIssuesLink(
  excludedIssueKeys: readonly string[],
  jiraBaseUrl: string | null,
): EvidenceLink {
  return buildIssueKeyLink(excludedIssueKeys, jiraBaseUrl);
}
