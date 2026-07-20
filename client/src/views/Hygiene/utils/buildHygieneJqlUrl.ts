// buildHygieneJqlUrl.ts — Builds Jira issue navigator URLs from Hygiene check findings.
//
// These utilities convert client-side Hygiene evaluations into shareable Jira links
// so users can send a precise, check-specific issue list to teammates without having to
// manually copy individual keys.

import type { HygieneFinding, HygieneFieldConfig } from '../checks/hygieneChecks.ts';
import { FIX_VERSION_ISSUE_TYPE_NAMES } from '../checks/hygieneChecks.ts';
import { buildJqlFieldReference } from '../checks/hygieneFieldConfig.ts';

const JIRA_ISSUE_NAVIGATOR_PATH = '/issues/';

// Hygiene families whose condition is a native Jira field being empty.
const NATIVE_FIELD_EMPTY_CLAUSES: Record<string, string> = {
  'missing-summary': 'summary is EMPTY',
  'no-assignee': 'assignee is EMPTY',
  'missing-due-date': 'duedate is EMPTY',
};

// Hygiene families whose condition is a CONFIGURED field being empty — the field id comes from the same
// field config the scan used, so the JQL scopes to the exact field the count evaluated.
const CONFIGURED_FIELD_EMPTY_CLAUSES: Record<string, keyof HygieneFieldConfig> = {
  'missing-product-owner': 'productOwnerFieldIds',
  'missing-feature-link': 'featureLinkFieldIds',
  'missing-parent-link': 'parentLinkFieldIds',
  'missing-initiative-type': 'initiativeTypeFieldIds',
  'missing-application': 'applicationFieldIds',
  'missing-pi': 'programIncrementFieldIds',
  'missing-target-start': 'targetStartFieldIds',
  'missing-target-end': 'targetEndFieldIds',
};

/** The `issuetype in (...)` clause for the fix-version family, derived from the SAME exported constant the
 * predicate uses (GH #200 N1: count and link cannot disagree on which types must carry a fix version).
 * NOTE: the JQL field is the singular `fixVersion` (the plural `fixVersions` is the REST field id, which JQL
 * rejects as "field does not exist"). */
function buildFixVersionIssueTypeClause(): string {
  const typeNames = [...FIX_VERSION_ISSUE_TYPE_NAMES].map((name) => `"${name}"`).join(', ');
  return `fixVersion is EMPTY AND issuetype in (${typeNames})`;
}

/**
 * The semantic JQL condition for a hygiene family, or null when the family has no expressible clause
 * (the caller then falls back to a found-issue-key list so the tile still links).
 */
export function buildHygieneCheckClause(checkId: string, fieldConfig: HygieneFieldConfig): string | null {
  if (checkId === 'missing-fix-version') {
    return buildFixVersionIssueTypeClause();
  }
  if (checkId in NATIVE_FIELD_EMPTY_CLAUSES) {
    return NATIVE_FIELD_EMPTY_CLAUSES[checkId];
  }
  const configuredFieldKey = CONFIGURED_FIELD_EMPTY_CLAUSES[checkId];
  if (configuredFieldKey) {
    const configuredFieldId = (fieldConfig[configuredFieldKey] as string[] | undefined)?.[0];
    return configuredFieldId ? `${buildJqlFieldReference(configuredFieldId)} is EMPTY` : null;
  }
  return null;
}

/**
 * The full Jira JQL for a hygiene check: the scan's scope AND the family's condition. Null when the family
 * has no semantic clause, so the caller can fall back to the found-key list.
 */
export function buildHygieneCheckJql(
  checkId: string,
  scopeJql: string,
  fieldConfig: HygieneFieldConfig,
): string | null {
  const familyClause = buildHygieneCheckClause(checkId, fieldConfig);
  if (!familyClause) {
    return null;
  }
  return `(${scopeJql}) AND (${familyClause})`;
}

/** Builds a Jira issue-navigator URL for a raw JQL string (falls back to the JQL itself when no base URL). */
export function buildJiraSearchUrl(jql: string, jiraBaseUrl: string | null): string {
  if (!jiraBaseUrl) {
    return jql;
  }
  const normalizedBaseUrl = jiraBaseUrl.replace(/\/+$/, '');
  return `${normalizedBaseUrl}${JIRA_ISSUE_NAVIGATOR_PATH}?jql=${encodeURIComponent(jql)}`;
}

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
