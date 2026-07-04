// assigneeClause.ts — Pure helpers that turn a picked Jira user into a JQL assignee clause.
//
// Jira stores assignee by an internal identifier, not a display name: Jira Cloud uses accountId,
// Data Center uses the username (`name`) or user key. This resolves the right one and builds the
// clause the Person finder inserts, so users never have to know or type the raw identifier.

import type { JiraUser } from '../../../types/jira.ts';

/**
 * Returns the identifier JQL matches an assignee on for this user: accountId on Cloud, falling back
 * to the Data Center username/key. Null when the user carries none (nothing safe to query on).
 */
export function resolveUserJqlIdentifier(user: JiraUser): string | null {
  const candidate = user.accountId?.trim() || user.name?.trim() || user.key?.trim() || '';
  return candidate === '' ? null : candidate;
}

/**
 * Builds an `assignee = "<id>"` clause for the given user, or null when the user has no usable
 * identifier. The identifier is quoted so ids containing colons or spaces parse correctly.
 */
export function buildAssigneeClause(user: JiraUser): string | null {
  const identifier = resolveUserJqlIdentifier(user);
  return identifier === null ? null : `assignee = "${identifier}"`;
}
