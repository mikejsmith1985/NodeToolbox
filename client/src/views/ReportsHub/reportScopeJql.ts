// reportScopeJql.ts — Turning what somebody typed into a scope into a JQL clause that Jira accepts.
//
// Every report here takes a "scope" and wraps it: `(<scope>) AND <the report's own condition>`. That
// works for a JQL condition and fails for the most natural thing a person can type. Somebody who puts
// `ENCUC` into a box labelled Scope has said exactly what they meant, and got back
//
//   Error in the JQL Query: Expecting operator but got ')'. (line 1, character 7)
//
// which names a character position in a query they never wrote. It reads as their mistake and it is
// not: the brackets came from us.
//
// The real answer is a picker, and the reports are moving to one. This is the shared courtesy for
// anyone who types anyway, and it lives in one place so no report can be fixed while another is not.

/** A bare project key: a word, with no operator anywhere in it. */
const BARE_PROJECT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A comma or space separated list of bare keys — "ENCUC, DENP" is as natural to type as one. */
const BARE_PROJECT_KEY_LIST_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\s*[, ]\s*[A-Za-z][A-Za-z0-9_]*)+$/;

/**
 * Reads a typed scope as JQL, understanding a bare project key as the project it obviously is.
 *
 * Returns an empty string for an empty scope, so the caller can leave the clause out rather than
 * bracket nothing.
 */
export function readScopeExpression(typedScope: string): string {
  const trimmedScope = typedScope.trim();
  if (trimmedScope === '') {
    return '';
  }
  if (BARE_PROJECT_KEY_PATTERN.test(trimmedScope)) {
    return `project = ${trimmedScope}`;
  }
  if (BARE_PROJECT_KEY_LIST_PATTERN.test(trimmedScope)) {
    const projectKeys = trimmedScope.split(/[, ]+/).filter((key) => key !== '');
    return `project in (${projectKeys.join(', ')})`;
  }
  return trimmedScope;
}

/**
 * Joins a typed scope to a report's own condition.
 *
 * The scope is bracketed so an `OR` inside it cannot escape the report's condition — without the
 * brackets, `project = A OR project = B AND statusCategory != Done` returns every issue in A whatever
 * its status. An empty scope produces the condition alone rather than an empty pair of brackets.
 */
export function buildScopedJql(typedScope: string, reportCondition: string): string {
  const scopeExpression = readScopeExpression(typedScope);
  return scopeExpression === '' ? reportCondition : `(${scopeExpression}) AND ${reportCondition}`;
}
