// jqlValue.ts — Making a value safe to sit inside a double-quoted JQL string.
//
// One function, in one place, because there were two copies and a third about to be written. A
// value that must match Jira exactly — a project key, a fix version whose name somebody has since
// edited to include quotes — has to survive being embedded in a query, and getting the escaping
// subtly different in two modules is how one surface silently returns nothing.

/**
 * Escapes backslashes and double quotes for a double-quoted JQL literal.
 *
 * Backslashes FIRST: escaping the quotes first would then escape the backslashes this function had
 * just introduced, doubling them.
 */
export function escapeJqlValue(jqlValue: string): string {
  return jqlValue.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
