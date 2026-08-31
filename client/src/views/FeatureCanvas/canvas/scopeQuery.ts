// scopeQuery.ts — Pure helper for the Feature Canvas Custom-JQL default query.
//
// The picker's Custom-JQL source pre-fills its query box with a default derived from the active
// project + PI. This builds that default. It is pure and deterministic — no I/O, no AI.

import { buildIssueTypeClause } from '../../../services/jiraIssueTypes.ts';

/**
 * JQL clause restricting the default query to feature-level work items.
 *
 * It names ONE issue type on purpose. Jira rejects an entire query with a 400 when any value in an
 * `issuetype in (...)` list is unknown to the instance, and this instance defines no "Epic" — so the
 * two-value clause returned nothing at all rather than a narrower set (GH #376). "Feature" is the
 * name proven to resolve here, and the prefilled query stays editable for anyone who needs more.
 */
const FEATURE_ISSUE_TYPE_CLAUSE = buildIssueTypeClause(['Feature']);

/**
 * Builds the default custom query from the active project + PI. The PI is targeted by custom-field
 * **id** (`cf[<number>]`) rather than display name, so the default works regardless of what the PI
 * field is named on a given Jira instance. Clauses with no value are omitted.
 */
export function buildDefaultScopeJql(input: { projectKey: string; piName: string; piFieldId: string }): string {
  const trimmedProjectKey = input.projectKey.trim();
  const projectClause = trimmedProjectKey ? `project = "${trimmedProjectKey}"` : '';

  const trimmedPiName = input.piName.trim();
  const piFieldNumber = input.piFieldId.trim().replace('customfield_', '');
  const piClause = trimmedPiName && piFieldNumber ? `cf[${piFieldNumber}] = "${trimmedPiName}"` : '';

  return [projectClause, piClause, FEATURE_ISSUE_TYPE_CLAUSE].filter(Boolean).join(' AND ');
}
