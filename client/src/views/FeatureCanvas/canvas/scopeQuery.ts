// scopeQuery.ts — Pure helper for the Feature Canvas Custom-JQL default query.
//
// The picker's Custom-JQL source pre-fills its query box with a default derived from the active
// project + PI. This builds that default. It is pure and deterministic — no I/O, no AI.

/** JQL clause restricting the default query to feature-level work items. */
const FEATURE_ISSUE_TYPE_CLAUSE = 'issuetype in (Feature, Epic)';

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
