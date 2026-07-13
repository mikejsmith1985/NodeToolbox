# Contract: Team-scope resolution → backlog JQL

`client/src/views/SprintDashboard/backlogRemediation/remediationScope.ts`

Turns the active team profile (+ optional override) into the JQL the remediation backlog is fetched with. Pure.

## Signature

```text
resolveTeamScope(input: {
  teamProfileId: string
  projectKey: string
  piName: string
  rosterMembers: readonly StandupRosterMember[]
  activeRosterTeamName: string | null
  scopeOverrideJql: string | null
}): TeamScope   // { teamProfileId, projectKey, piName, jql }
```

## Rules

1. **Override wins (FR-005)**: if `scopeOverrideJql` is non-empty, `jql = buildAgingJql(scopeOverrideJql)` — the
   operator's clause, wrapped by the existing `AND statusCategory != Done ORDER BY created ASC`.
2. **Project-first derived default (FR-004)**: else if `projectKey` is set, `jql = buildAgingJql('project = <key>')`.
   The default deliberately does **not** narrow by `assignee in (roster)` — a cleanup queue must include
   **unassigned** stale issues, which are the prime cancel candidates; narrowing by assignee would hide exactly
   the work we most want to surface.
3. **Roster fallback**: else if a roster clause is available
   (`buildStandupRosterAssigneeClause(rosterMembers, activeRosterTeamName)` is non-null), `jql = buildAgingJql(rosterClause)`
   — for a roster-defined team with no single project.
4. **No derivable scope (FR-006)**: else return a `TeamScope` with `jql = ''`; the panel treats an empty `jql` as
   "prompt for a JQL override" rather than running a global query.

`buildAgingJql` and `buildStandupRosterAssigneeClause` are reused as-is (no new query logic).

## Acceptance (unit)

- Override present → override wrapped by `buildAgingJql` (even when a project is also set).
- No override, project set → `(project = KEY) AND statusCategory != Done ORDER BY created ASC` (no assignee narrowing).
- No override, no project, roster available → the `assignee in (...)` clause wrapped by `buildAgingJql`.
- No override, no project, no roster → empty `jql` (panel prompts).
