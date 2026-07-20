# Contract: US6 — My Issues Personas

Covers FR-019..023, SC-006. Largest story; the per-role criteria set is finalized in `/speckit-tasks`.

## Report subject (`MyIssues/hooks/useMyIssuesState.ts`, EDIT)

```ts
type ReportSubject =
  | { kind: 'viewer' }
  | { kind: 'user'; accountId: string; displayName: string }
  | { kind: 'team'; teamName: string };
```
- The "mine" source JQL is derived from the subject:
  - `viewer` → `assignee = currentUser()` (today's behavior, the default)
  - `user`   → `assignee = "<accountId>"` (simulation)
  - `team`   → `assignee in (<roster members of teamName>)`
- Read-only under the viewer's OWN credentials; simulation/team views NEVER write as another user (FR-023).

## Simulate-as control (`MyIssuesView.tsx`, EDIT)

- A Jira user-search control reusing `searchFeatureReviewUsers(query)` (arbitrary Jira users — the issue's ask).
- Selecting a user sets `subject = { kind: 'user', ... }`; a banner shows "Viewing as <name>" with a one-action
  **Back to me** that restores `subject = { kind: 'viewer' }` (FR-020).

## Role lens (`MyIssues/myIssuesRoleLens.ts`, NEW pure module)

- `myIssuesRoleLens(role): EmphasizedCriteria` — maps `dev | tester | sm | po` → the emphasized sections/criteria.
- The active lens **defaults from the subject's roster `roleCapabilities`** (`useStandupRosterStore`): e.g.
  `canScrumMaster → sm`, `canProductOwner → po`, `canInternalTest/canExternalTest → tester`, else `dev`; unset →
  `dev` (default). The user can manually override the lens (FR-021).
- Candidate defaults (to confirm in tasks): Dev = my in-progress/blocked/needs-estimate; Tester = ready-for-QA/in-test;
  SM = team blockers + hygiene + flow; PO = feature readiness + backlog hygiene.

## Team views (SM/PO)

- For SM/PO lenses, the user can switch the subject between their own assigned work and a selected team (from the
  roster's teams); team membership defines the `assignee in (...)` set.

## Tests

- Unit: `myIssuesRoleLens` mapping per role; roster-role → default lens; assignee-JQL per subject kind.
- Component: simulate-as banner + Back to me; role override.
- e2e (`myissues-personas.spec.js`): search+select another user → report reflects them + banner; switch role lens →
  emphasized sections change; SM/PO switch to a team → report covers the team; no write path is exposed.
