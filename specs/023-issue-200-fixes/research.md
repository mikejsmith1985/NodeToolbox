# Phase 0 Research: Issue #200 Review Fixes

All decisions below are grounded in a codebase scout. Format per decision: **Decision / Rationale / Alternatives**.
No `NEEDS CLARIFICATION` markers remain (the four spec clarifications resolved the scope questions).

## US1 — fix-version check correctness

**Decision**: In `client/src/views/Hygiene/checks/hygieneChecks.ts`, replace the `isFeatureLikeIssue` gate inside
`checkMissingFixVersion` with a dedicated `carriesFixVersion(issue)` predicate that matches issue types in a new
`FIX_VERSION_ISSUE_TYPE_NAMES` set = {Story, Task, Defect, Feature, Epic} (case-insensitive; Sub-tasks excluded). Keep
reading the native `issue.fields.fixVersions` array (already in `BASE_HYGIENE_FIELDS`). If `src/services/hygieneRules.js`
runs the same check server-side, mirror the type set there so both agree.

**Rationale**: The scout confirmed the field is fetched and populated — the only defect is the feature/epic-only scope,
so the 72 Stories/Tasks/Defects were skipped (→ 0). A dedicated predicate makes the scope explicit and unit-testable,
and keeps the fix from silently touching the other feature-scoped families (missing-pi, target dates) that legitimately
stay feature-only.

**Alternatives**: (a) Broaden `isFeatureLikeIssue` itself — rejected: it's shared by other feature-only checks and
would wrongly widen them. (b) Add a configurable fix-version field id — rejected (clarified): native field is correct;
no config creep.

## US2 — verifiable hygiene nodes (per-family JQL + link)

**Decision**: Add `buildHygieneCheckJql(checkId, scope, fieldConfig)` to `utils/buildHygieneJqlUrl.ts` returning the
semantic JQL = **scope clause AND family condition clause**. The scope clause reuses what `buildHygieneSearchPath`
builds (PI + project/roster scope); the family condition is a per-check JQL string **co-located with each predicate**
in `hygieneChecks.ts` (e.g. missing-fix-version → `fixVersions is EMPTY AND issuetype in (Story, Task, Defect, ...)`).
Feed it to the existing `buildJiraIssueNavigatorUrl(jql, jiraBaseUrl)` (extend it to accept a raw JQL string, not just
keys) → `{base}/issues/?jql=<encoded>`. `HygieneView.tsx` renders a distinct "open in Jira ↗" link on each tile
(anchor, `target="_blank"`), leaving the tile's `onClick` filter behavior untouched. Retain `handleCopyCheckJql`.

**Rationale**: The reporter's need is to *validate Toolbox against Jira*, which requires the same semantic query, not
a list of keys Toolbox already found (a key list can neither verify a "0" nor prove the scan's logic). Co-locating the
JQL clause with the predicate is the "surfaces agree by construction" rule: the count and the link come from one
source and cannot drift (NFR-002). Field references reuse `buildJqlFieldReference`/`readConfiguredPiFieldId` so custom
field ids match the scan.

**Alternatives**: (a) `buildCheckIssueKeys` (issue-key `in (...)`) — rejected: echoes findings, can't verify zero,
doesn't expose the query. (b) A central JQL map separate from the predicates — rejected: two sources that can drift.

## US3 — linked issue → F2 lookup (imperative open)

**Decision**: Add `client/src/components/QuickIssueLookup/quickLookupStore.ts` — a Zustand store
`useQuickLookupStore { isOpen, seedKey, openNonce, open(key?), close() }`. `QuickIssueLookupGate` subscribes to the
store (replacing its local `isOpen`/`openNonce`), F2 keydown calls `open()` (no seed), and `QuickIssueLookup` accepts
`seedKey` to preset `lookupKey`. In `IssueDetailPanel`'s `renderIssueLinkRow`, the linked-issue key `<span>` becomes a
`<button>`/anchor that calls `useQuickLookupStore.getState().open(linkedIssue.key)`.

**Rationale**: The gate is keydown-only with no external entry point; a small store is the idiomatic (matches
todoStore/aiAssistStore), testable way to add the imperative open. This is exactly the "click a linked-issue key to
load it in place" 022 explicitly deferred — now delivered by reusing 022 wholesale (fetch/render/edit/deep-link/
honest-states unchanged). The change to `IssueDetailPanel` is additive (a click handler on an existing element), so
all current callers keep working.

**Alternatives**: (a) window CustomEvent — rejected: less testable/idiomatic than a store. (b) Prop-drill an open
callback from App to the panel — rejected: the panel is rendered by many hosts; a store avoids threading.

## US4 — PO Tool PI dropdown

**Decision**: In `PoTeamSelector.tsx`, replace the PI `<input type="text">` with a `<select>` populated by
`loadAvailablePiNamesFromJira(piReviewTeams)` (from `ArtView/hooks/artHelpers.ts`), mirroring ArtView's PI-select
pattern (`availablePiNames`, `isLoadingPiOptions`, reload). `piReviewTeams` is already built by PoToolView via
`buildArtTeamFromProfile`. Preselect via `findPiNameForDate` / the profile's `selectedPiValue`. Persist through the
existing `usePoToolState` `selectedPiName` (`tbxPoToolSelection`). On load failure: show a reload + a manual-entry
fallback so the tool never blocks.

**Rationale**: The identical PI-options loader is already used by ArtView, PI Review, ReportsHub, and FeatureCanvas —
zero new discovery mechanism. The Team control beside it is already a `<select>`, so this is consistency, not novelty.

**Alternatives**: Build a PO-specific PI list — rejected: duplicates the shared loader.

## US5 — remediation context beside action

**Decision**: In `BacklogRemediationPanel.tsx`, restructure each actionable `<li>` so the decision-relevant context
(status, assignee, summary, acceptance criteria) renders **beside** its Keep/Dismiss/Snooze/Cancel buttons, using the
shared `IssueMeta` chips (and, where already fetched, the `issuesByKey` `JiraIssue`). Hydrate `issuesByKey` on panel
load (not only on an explicit "Refresh backlog") so a resumed session shows context; while a row's detail is pending,
show a compact loading state next to the buttons. The decision engine, outcomes, and persistence
(`useBacklogRemediationStore`) are untouched.

**Rationale**: The scout found buttons in the top `<ul>` (key + verdict + summary only) while the rich context sits in
a separate `AgingTriageActionTable`, and on a pure resume `issuesByKey` is empty → verdicts with no context. Co-locating
and hydrating fixes both the layout and the "context unavailable" complaint without changing behavior.

**Alternatives**: Link each item to open the full issue in the F2 lookup (US3) instead of inlining context — kept as a
complementary affordance, but inline context is what "decide without leaving" needs.

## US6 — My Issues personas

**Decision**: Three additive capabilities in `MyIssues`:
- **Simulate as**: a Jira user-search control reusing `searchFeatureReviewUsers` (already searches Jira users). The
  report subject becomes `viewer | { simulatedUser }`; `useMyIssuesState` swaps the "mine" JQL `assignee = currentUser()`
  for `assignee = "<selectedAccountId>"`. A banner shows whose view is active with one-action "back to me". Read-only,
  under the viewer's own credentials (FR-023).
- **Role lens**: a new pure `myIssuesRoleLens.ts` mapping a role (Dev/Tester/SM/PO) → the emphasized criteria/sections.
  The active lens **defaults from the subject's roster role capabilities** (`useStandupRosterStore` `roleCapabilities`)
  and is manually overridable; unset → a default lens. The exact per-role criteria set is finalized in `/speckit-tasks`
  (candidate defaults: Dev = my in-progress/blocked/needs-estimate; Tester = ready-for-QA/in-test; SM = team blockers +
  hygiene + flow; PO = feature readiness + backlog hygiene).
- **Team views (SM/PO)**: switch the subject to a selected team; membership comes from the roster
  (`StandupRosterMember` by `teamName`), and the report runs over `assignee in (<members>)` (or the team's scope).

**Rationale**: `currentUser()` is the only reason the report is self-only; swapping the assignee clause is the minimal
change, and `searchFeatureReviewUsers` already provides arbitrary Jira user search (the issue said "search for other
Jira users"). Roles/teams come entirely from the existing roster — no new data model.

**Alternatives**: (a) Restrict "simulate as" to roster members only — rejected (clarified): the issue asks for
arbitrary Jira users. (b) A separate persona view instead of extending the report — rejected: duplicates the report;
extend the existing sources/subject instead.

## Cross-cutting

- **Parallelism**: five worktree tracks — {US1+US2 together, they share `hygieneChecks.ts`}, US3, US4, US5, US6. US1
  merges first (data correctness), then US2's link is validated against the corrected count.
- **Agree-by-construction (NFR-002)** is the load-bearing constraint for US1↔US2: the fix-version type set lives in one
  constant consumed by both the predicate and the JQL clause.

## Resolved unknowns summary

| Unknown | Resolution |
|---------|------------|
| Why fix-version detects 0 | Feature/epic-only gate; broaden to Story/Task/Defect/Feature/Epic via `carriesFixVersion` |
| How a hygiene node links to Jira | New `buildHygieneCheckJql` (scope AND co-located family clause) → `buildJiraIssueNavigatorUrl` |
| How a linked issue opens the F2 lookup | New `quickLookupStore` imperative open + `seedKey`; linked key becomes a control |
| PO PI options source | `loadAvailablePiNamesFromJira(piReviewTeams)` (ArtView loader) |
| Remediation context | Co-locate + hydrate `issuesByKey`; reuse IssueMeta; engine unchanged |
| MyIssues simulate/role/team | `searchFeatureReviewUsers` + assignee-clause swap; roster `roleCapabilities`/membership; pure role→criteria map |
