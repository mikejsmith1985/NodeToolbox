// reworkScope.ts — Turning the report's controls into a Jira query, and its failures into English.
//
// Lives apart from the tab because a component file that also exports functions breaks fast refresh,
// and because these two are the parts most worth testing on their own: one decides what gets scanned,
// the other decides what somebody is told when it does not work.

/**
 * Joins the picked project and any extra JQL into one clause.
 *
 * Bracketed separately so an OR inside the extra clause cannot escape the project it was meant to
 * narrow — `project = A AND b OR c` would otherwise return everything matching c, from anywhere.
 */
export function buildScopeClause(projectKey: string, extraJql: string): string {
  const trimmedExtra = extraJql.trim();
  const projectClause = projectKey.trim() === '' ? '' : `project = ${projectKey.trim()}`;
  if (projectClause === '') {
    return trimmedExtra;
  }
  return trimmedExtra === '' ? projectClause : `${projectClause} AND (${trimmedExtra})`;
}

/**
 * Says what went wrong in terms of the control that caused it.
 *
 * Jira's own parse errors name a character position in a query the operator never wrote, which reads
 * as a fault in their input rather than in the clause this built around it.
 */
export function describeFetchFailure(caughtError: unknown): string {
  const rawMessage = caughtError instanceof Error ? caughtError.message : String(caughtError);
  if (/JQL/i.test(rawMessage)) {
    return 'Jira could not read that query. Check the "Narrow it further" box — it holds a JQL '
      + 'condition such as `issuetype in (Story, Task)`, not a project name. Clear it to scan the '
      + `whole project.

Jira said: ${rawMessage}`;
  }
  return rawMessage === '' ? 'Could not read the issue history.' : rawMessage;
}
