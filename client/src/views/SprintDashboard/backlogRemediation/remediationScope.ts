// remediationScope.ts — Derives the backlog JQL for a team's remediation queue. Pure.
//
// The default scope follows the active team profile so the operator rarely types a JQL, but it is deliberately
// PROJECT-FIRST and never narrows by `assignee in (roster)`: a cleanup queue must include unassigned stale issues,
// which are the prime cancel candidates — narrowing by assignee would hide exactly the work we want to surface.
// An operator override always wins; a roster clause is only a fallback for a roster-defined team with no project.

import { buildAgingJql } from '../../ReportsHub/agingBacklogFetch.ts';
import { buildStandupRosterAssigneeClause, type StandupRosterMember } from '../hooks/useStandupRosterStore.ts';
import type { TeamScope } from './remediationTypes.ts';

/** Inputs for scope resolution: the team identity + scope, its roster, and any operator override. */
export interface ResolveTeamScopeInput {
  teamProfileId: string;
  projectKey: string;
  piName: string;
  rosterMembers: readonly StandupRosterMember[];
  activeRosterTeamName: string | null;
  scopeOverrideJql: string | null;
}

/**
 * Resolves the backlog JQL for a team, in priority order: operator override → project-first default → roster
 * fallback → empty (the panel then prompts for a JQL). The returned `jql` is already wrapped by `buildAgingJql`
 * (the `statusCategory != Done ORDER BY created ASC` clause) so it is ready to fetch; an empty `jql` means
 * "nothing derivable".
 */
export function resolveTeamScope(input: ResolveTeamScopeInput): TeamScope {
  const { teamProfileId, projectKey, piName, rosterMembers, activeRosterTeamName, scopeOverrideJql } = input;
  return { teamProfileId, projectKey, piName, jql: resolveScopeJql(projectKey, rosterMembers, activeRosterTeamName, scopeOverrideJql) };
}

/** Picks the innermost scope clause and wraps it, or returns '' when no scope can be derived. */
function resolveScopeJql(
  projectKey: string,
  rosterMembers: readonly StandupRosterMember[],
  activeRosterTeamName: string | null,
  scopeOverrideJql: string | null,
): string {
  // 1) An explicit operator override always wins.
  if (scopeOverrideJql !== null && scopeOverrideJql.trim() !== '') {
    return buildAgingJql(scopeOverrideJql.trim());
  }
  // 2) Project-first default — no assignee narrowing, so unassigned stale work stays in scope.
  if (projectKey.trim() !== '') {
    return buildAgingJql(`project = ${projectKey.trim()}`);
  }
  // 3) Roster fallback for a roster-defined team with no single project.
  const rosterClause = buildStandupRosterAssigneeClause(rosterMembers as StandupRosterMember[], activeRosterTeamName);
  if (rosterClause !== null) {
    return buildAgingJql(rosterClause);
  }
  // 4) Nothing derivable — the panel prompts for a JQL override.
  return '';
}
