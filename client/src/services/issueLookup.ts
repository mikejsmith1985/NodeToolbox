// issueLookup.ts — Fetches one full Jira issue by key for the Quick Issue Lookup detail view.
//
// This is the single net-new data path the feature needs: nothing else in the app fetches one
// complete issue on demand from a bare key (other callers are handed a pre-loaded issue, or run a
// JQL search). The requested field list mirrors what IssueDetailPanel renders; transitions and
// comments are fetched separately by the panel, so no `expand` is requested.

import { jiraGet } from './jiraApi.ts';
import type { JiraIssue } from '../types/jira.ts';

const ISSUE_RESOURCE_PATH = '/rest/api/2/issue';

// Both story-point custom fields are requested because Jira instances differ on which one holds
// the estimate; the panel's existing reader uses whichever is populated.
const PRIMARY_STORY_POINTS_FIELD_ID = 'customfield_10028';
const FALLBACK_STORY_POINTS_FIELD_ID = 'customfield_10016';

/** The issue fields IssueDetailPanel needs to render its header, context, description, and comments. */
const ISSUE_DETAIL_FIELDS = [
  'summary', 'status', 'priority', 'assignee', 'issuetype', 'created', 'updated', 'duedate',
  'description', 'issuelinks', 'labels', 'fixVersions', 'parent', 'comment',
  PRIMARY_STORY_POINTS_FIELD_ID, FALLBACK_STORY_POINTS_FIELD_ID,
].join(',');

/** Matches the HTTP status code jiraGet embeds in its error message, e.g. "…failed: 404". */
const HTTP_STATUS_IN_ERROR_PATTERN = /failed:\s*(\d{3})\b/;

/** Builds the REST path that fetches one issue with the full detail field set (no expand). */
export function buildIssueLookupPath(issueKey: string): string {
  return `${ISSUE_RESOURCE_PATH}/${encodeURIComponent(issueKey)}?fields=${ISSUE_DETAIL_FIELDS}`;
}

/** Fetches one full Jira issue by key through the shared Jira proxy client. */
export async function fetchIssueByKey(issueKey: string): Promise<JiraIssue> {
  return jiraGet<JiraIssue>(buildIssueLookupPath(issueKey));
}

/**
 * Reads the HTTP status code embedded in a jiraGet error message so callers can tell "not found"
 * from "no permission". Returns null when the failure carries no recognizable status (e.g. a
 * network error), in which case callers treat it as a generic error.
 */
export function extractHttpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const statusMatch = HTTP_STATUS_IN_ERROR_PATTERN.exec(error.message);
  return statusMatch ? Number(statusMatch[1]) : null;
}
