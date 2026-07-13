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
2. **Derived default (FR-004)**: else build a base clause `project = <projectKey>`, optionally narrowed with the
   roster clause from `buildStandupRosterAssigneeClause(rosterMembers, activeRosterTeamName)` when the roster is in
   use, then wrap with `buildAgingJql(...)`.
3. **No derivable scope (FR-006)**: if `projectKey` is blank and there is no roster clause and no override, return a
   `TeamScope` with `jql = ''`; the panel treats an empty `jql` as "prompt for a JQL override" rather than running a
   global query.

`buildAgingJql` and `buildStandupRosterAssigneeClause` are reused as-is (no new query logic).

## Acceptance (unit)

- Override present → override wrapped by `buildAgingJql`.
- No override, project set → `(project = KEY) AND statusCategory != Done ORDER BY created ASC`.
- No override, project set, roster in use → project clause AND the `assignee in (...)` clause.
- No override, nothing derivable → empty `jql` (panel prompts).
