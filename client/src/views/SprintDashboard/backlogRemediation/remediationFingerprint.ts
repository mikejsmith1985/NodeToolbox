// remediationFingerprint.ts — Builds the material-change fingerprint (status category + team-scoped assignee)
// for a fetched issue. Pure. This is what lets a decided item re-enter the queue ONLY on a status-category
// change or a reassignment INTO the team, while cosmetic edits leave it decided (FR-013).

import type { JiraIssue } from '../../../types/jira.ts';
import type { StandupRosterMember } from '../hooks/useStandupRosterStore.ts';
import type { ItemFingerprint } from './remediationTypes.ts';

/**
 * Collects the identifiers (machine id + display name) of every roster member, so a fetched issue's assignee can
 * be recognised as "on the team". Both are included because Jira Server and Cloud key assignees differently.
 */
export function buildTeamAssigneeIds(rosterMembers: readonly StandupRosterMember[]): Set<string> {
  const teamAssigneeIds = new Set<string>();
  for (const member of rosterMembers) {
    if (member.assigneeQueryValue.trim() !== '') {
      teamAssigneeIds.add(member.assigneeQueryValue.trim());
    }
    if (member.displayName.trim() !== '') {
      teamAssigneeIds.add(member.displayName.trim());
    }
  }
  return teamAssigneeIds;
}

/**
 * Fingerprints a fetched issue: its status-category key, plus its assignee's machine id BUT only when that
 * assignee is a member of the active team (else null). The team-scoping is what makes "reassigned into the team"
 * detectable while a reassignment to some non-team user reads as no material change.
 */
export function buildItemFingerprint(issue: JiraIssue, teamAssigneeIds: ReadonlySet<string>): ItemFingerprint {
  const statusCategoryKey = issue.fields?.status?.statusCategory?.key ?? '';
  const assignee = issue.fields?.assignee ?? null;
  if (assignee === null) {
    return { statusCategoryKey, assigneeKey: null };
  }
  const assigneeMachineId = assignee.accountId || assignee.key || assignee.name || null;
  const isTeamMember = [assignee.accountId, assignee.key, assignee.name, assignee.displayName].some(
    (identifier) => typeof identifier === 'string' && identifier.trim() !== '' && teamAssigneeIds.has(identifier.trim()),
  );
  return { statusCategoryKey, assigneeKey: isTeamMember ? assigneeMachineId : null };
}
