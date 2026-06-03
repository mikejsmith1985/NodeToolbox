// buildHygieneJqlUrl.ts — Builds Jira issue navigator URLs from Hygiene check findings.
//
// These utilities convert client-side Hygiene evaluations into shareable Jira links
// so users can send a precise, check-specific issue list to teammates without having to
// manually copy individual keys.

import type { HygieneFinding } from '../checks/hygieneChecks.ts';

const JIRA_ISSUE_NAVIGATOR_PATH = '/issues/';

/** Returns all issue keys from findings that are flagged by the specified check. */
export function buildCheckIssueKeys(checkId: string, findings: HygieneFinding[]): string[] {
  return findings
    .filter((finding) => finding.flags.some((flag) => flag.checkId === checkId))
    .map((finding) => finding.issue.key);
}

/**
 * Builds a Jira issue navigator URL for the given issue keys.
 * Falls back to raw JQL when no base URL is configured so there is always
 * something useful to paste directly into the Jira issue search bar.
 */
export function buildJiraIssueNavigatorUrl(issueKeys: string[], jiraBaseUrl: string | null): string {
  const jqlText = `issueKey in (${issueKeys.join(', ')})`;
  if (!jiraBaseUrl || issueKeys.length === 0) {
    return jqlText;
  }
  const normalizedBaseUrl = jiraBaseUrl.replace(/\/+$/, '');
  return `${normalizedBaseUrl}${JIRA_ISSUE_NAVIGATOR_PATH}?jql=${encodeURIComponent(jqlText)}`;
}
