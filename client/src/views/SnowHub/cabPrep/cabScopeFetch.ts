// cabScopeFetch.ts — Reading the Jira issues a CAB pack draws on.
//
// One search for the whole list rather than one request per key: a change with thirty issues would
// otherwise cost thirty round trips before the pack could even be prompted for.
//
// It reports keys Jira did NOT return. A key written into a change description can be wrong — a
// typo, a deleted issue, a project the operator cannot see — and a pack silently built from
// twenty-eight of thirty issues is one that answers "is everything finished?" from an incomplete
// picture.

import { jiraGet } from '../../../services/jiraApi.ts';
import { readStoryPointsFromFields, resolveStoryPointsFieldIds } from '../../Hygiene/checks/storyPointsField.ts';
import type { CabScopedIssue } from './cabFactSheet.ts';

/** The fields a CAB question can be asked about. Small on purpose — this is context, not a board. */
const CAB_SCOPE_BASE_FIELDS = ['summary', 'status', 'issuetype', 'assignee'];

/** How Jira answers the key search. */
interface ScopeSearchResponse {
  issues?: Array<{
    key: string;
    fields?: {
      summary?: string;
      issuetype?: { name?: string };
      status?: { name?: string; statusCategory?: { key?: string } };
      assignee?: { displayName?: string };
    } & Record<string, unknown>;
  }>;
}

/** What a scope load produced, and what it could not find. */
export interface CabScopeOutcome {
  issues: CabScopedIssue[];
  /** Keys that were asked for and did not come back — a typo, a deletion, or no permission. */
  missingKeys: string[];
}

/** Escapes a key for a quoted JQL list entry. */
function escapeKeyForJql(issueKey: string): string {
  return issueKey.replace(/"/g, '');
}

/**
 * Loads the named issues, in one search.
 *
 * An empty key list costs no request and returns an empty scope — a change with no Jira work behind
 * it is a real thing, and asking Jira `key in ()` is a syntax error rather than an empty answer.
 */
export async function loadCabScopeIssues(issueKeys: readonly string[]): Promise<CabScopeOutcome> {
  if (issueKeys.length === 0) {
    return { issues: [], missingKeys: [] };
  }

  const storyPointsFieldIds = resolveStoryPointsFieldIds('');
  const requestedFields = [...CAB_SCOPE_BASE_FIELDS, ...storyPointsFieldIds].join(',');
  const jql = `key in (${issueKeys.map((issueKey) => `"${escapeKeyForJql(issueKey)}"`).join(',')})`;

  const response = await jiraGet<ScopeSearchResponse>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}`
    + `&fields=${encodeURIComponent(requestedFields)}&maxResults=${issueKeys.length}`,
  );

  const issues: CabScopedIssue[] = (response.issues ?? []).map((foundIssue) => ({
    key: foundIssue.key,
    summary: foundIssue.fields?.summary ?? '',
    issueType: foundIssue.fields?.issuetype?.name ?? 'Issue',
    status: foundIssue.fields?.status?.name ?? 'unknown',
    assignee: foundIssue.fields?.assignee?.displayName ?? null,
    // Through the central resolver: this instance keeps points in a configured select field, and a
    // second opinion about where they live is the defect the field-mapping work removed.
    storyPoints: readStoryPointsFromFields(
      (foundIssue.fields ?? {}) as Record<string, unknown>,
      storyPointsFieldIds,
    ),
    isComplete: (foundIssue.fields?.status?.statusCategory?.key ?? '').toLowerCase() === 'done',
  }));

  const foundKeys = new Set(issues.map((issue) => issue.key));

  return {
    issues,
    missingKeys: issueKeys.filter((issueKey) => !foundKeys.has(issueKey)),
  };
}
