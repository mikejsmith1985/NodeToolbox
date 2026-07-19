// remediationScope.ts — Derives the backlog JQL for a team's remediation queue. Pure.
//
// The default scope follows the active team profile so the operator rarely types a JQL, but it is deliberately
// PROJECT-FIRST and never narrows by `assignee in (roster)`: a cleanup queue must include unassigned stale issues,
// which are the prime cancel candidates — narrowing by assignee would hide exactly the work we want to surface.
// An operator override always wins; a roster clause is only a fallback for a roster-defined team with no project.

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
 * Resolves the backlog scope clause for a team, in priority order: operator override → project-first default →
 * roster fallback → empty (the panel then prompts for a JQL). The returned `jql` is the RAW scope clause (e.g.
 * `project = ENFCT`) — the fetch layer (`fetchAgingBacklog` / `fetchAgingMetrics`) owns the single `buildAgingJql`
 * wrap that adds `statusCategory != Done ORDER BY created ASC`. Pre-wrapping here previously double-wrapped the
 * query and produced an invalid `ORDER BY`-inside-parentheses JQL 400 (GH #197). An empty `jql` means
 * "nothing derivable".
 */
export function resolveTeamScope(input: ResolveTeamScopeInput): TeamScope {
  const { teamProfileId, projectKey, piName, rosterMembers, activeRosterTeamName, scopeOverrideJql } = input;
  return { teamProfileId, projectKey, piName, jql: resolveScopeJql(projectKey, rosterMembers, activeRosterTeamName, scopeOverrideJql) };
}

/**
 * Picks the innermost RAW scope clause, or returns '' when no scope can be derived. Never wraps with
 * `buildAgingJql` — that single wrap is owned by the fetch layer, and wrapping here too yields an invalid
 * double-wrapped JQL (`ORDER BY` nested in parentheses, GH #197).
 */
function resolveScopeJql(
  projectKey: string,
  rosterMembers: readonly StandupRosterMember[],
  activeRosterTeamName: string | null,
  scopeOverrideJql: string | null,
): string {
  // 1) An explicit operator override always wins.
  if (scopeOverrideJql !== null && scopeOverrideJql.trim() !== '') {
    return scopeOverrideJql.trim();
  }
  // 2) Project-first default — no assignee narrowing, so unassigned stale work stays in scope.
  if (projectKey.trim() !== '') {
    return `project = ${projectKey.trim()}`;
  }
  // 3) Roster fallback for a roster-defined team with no single project.
  const rosterClause = buildStandupRosterAssigneeClause(rosterMembers as StandupRosterMember[], activeRosterTeamName);
  if (rosterClause !== null) {
    return rosterClause;
  }
  // 4) Nothing derivable — the panel prompts for a JQL override.
  return '';
}
