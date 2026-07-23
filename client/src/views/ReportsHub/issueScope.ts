// issueScope.ts — Does this Jira issue count as a deliverable in its own right?
//
// Jira makes sub-tasks look like ordinary issues to a search: they have their own key, their own
// assignee and their own status history. Counted as peers of the story they belong to, they inflate
// issue counts — one piece of work credited twice — and, because they are short-lived, they drag
// cycle-time averages DOWN, making delivery look faster than it is. Jira's own control chart requires
// a quick filter for exactly this reason.
//
// This is the single place either report is allowed to answer the question, so the two can never
// disagree about whether an issue counts. Pure: no clock, no fetch.

/** Why an issue is, or is not, counted as a deliverable in its own right. */
export type IssueScopeVerdict =
  /** A real deliverable — a Story, Task, Defect and so on. */
  | 'countable'
  /** A sub-task: part of another issue's delivery, never a deliverable of its own. */
  | 'sub-task'
  /** Jira did not tell us what this is. Counted anyway, and reported — see below. */
  | 'unknown-type';

/** The slice of Jira's `issuetype` object this decision needs. */
export interface IssueTypeFields {
  subtask?: boolean;
  name?: string;
}

/**
 * Decides whether an issue is a countable deliverable.
 *
 * Reads the `subtask` **boolean** and deliberately ignores the type NAME. "Sub-task", "Subtask",
 * "Sub-Task" and freely-named custom sub-task types all occur, and this instance already renames
 * standard types (it uses "Defect", not "Bug") — so a name check would fail silently on precisely the
 * teams that have customised their workflow.
 *
 * When the flag is absent or is not a boolean the answer is `unknown-type`, and the issue is still
 * COUNTED. The alternative — assuming sub-task — would delete a named person's real work from their
 * figures on the strength of a missing field. Over-counting is visible and can be argued with; a
 * silent deletion is neither, and preventing exactly that is what this report is for.
 */
export function classifyIssueScope(
  issueTypeFields: IssueTypeFields | null | undefined,
): IssueScopeVerdict {
  if (typeof issueTypeFields?.subtask !== 'boolean') return 'unknown-type';
  return issueTypeFields.subtask ? 'sub-task' : 'countable';
}
