# Tasks: Issue #200 Review Fixes — hygiene fidelity, transparency, and My Issues personas

**Input**: Design documents from `/specs/023-issue-200-fixes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional; each implementation task (pure, hook,
store, **and UI component**) is preceded by its failing test. Pure/store/hook units get vitest; components get
testing-library RED tests; each story's end-to-end flow gets a Playwright spec.

**Organization**: six user stories from GH #200, in priority order, each an independently shippable increment across a
largely **disjoint file area** — for parallel worktree agents. **Caveat**: US1 and US2 both edit `hygieneChecks.ts`, so
they share one worktree/track (US1 predicate first, US2 JQL clause second).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1..US6]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

- [ ] T001 On `feature/023-issue-200-fixes` (worktrees per track), confirm gates run green pre-change:
      `cd client && npx vitest run && npx tsc -b` and `npm test` (server)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: none required. Foundation is the existing shipped codebase (Hygiene scan/checks/field-config, F2 lookup +
IssueDetailPanel, PI-options loader, Backlog Remediation engine, My Issues state, standup roster). No story depends on
another's code (US2 depends only on US1's shared type constant, within the same track).

**Checkpoint**: five parallel tracks — **{US1→US2}**, **US3**, **US4**, **US5**, **US6**. Merge order: US1, US2, then
US3/US4/US5, then US6.

---

## Phase 3: User Story 1 — Fix-version check tells the truth (Priority: P1) 🎯 MVP

**Goal**: the check counts Story/Task/Defect/Feature/Epic issues lacking a fix version, not 0 (FR-001..004; contract
`hygiene-fix-version.md`). **Independent test**: mixed-type PI → tile shows N, not 0 (quickstart H1).

- [ ] T002 [US1] **Resolve server parity FIRST** (S1): determine whether `src/services/hygieneRules.js` runs an
      equivalent fix-version check; record the answer in a one-line comment. This gates whether US1 is client-only.
- [ ] T003 [US1] RED — extend `client/src/views/Hygiene/checks/hygieneChecks.test.ts`: `checkMissingFixVersion` flags
      Story/Task/Defect/Feature/Epic with empty `fixVersions`, skips Sub-tasks and any issue that HAS a fix version
- [ ] T004 [US1] GREEN — in `client/src/views/Hygiene/checks/hygieneChecks.ts` add
      `FIX_VERSION_ISSUE_TYPE_NAMES = {Story, Task, Defect, Feature, Epic}` (case-insensitive; **exported** so US2's
      clause reuses it) + `carriesFixVersion(issue)`, replacing the `isFeatureLikeIssue` gate in `checkMissingFixVersion`
      (native `fixVersions`; no config key)
- [ ] T005 [US1] Server parity (only if T002 found a server check) — red-first Jest test then mirror the same type set
      in `src/services/hygieneRules.js`; keep `npm test` green
- [ ] T006 [US1] e2e — add scenario **H1** (mixed-type PI → count N not 0) to `test/e2e/hygiene-jira-links.spec.js`

**Checkpoint**: US1 merges first — every downstream number reflects the corrected count.

---

## Phase 4: User Story 2 — Every hygiene node opens its exact Jira JQL (Priority: P1)

**Goal**: each tile gains "open in Jira ↗" opening the family's semantic JQL; count/link agree by construction
(FR-005..008, NFR-002; contract `hygiene-jira-links.md`). **Depends on US1's exported constant.**

**Independent test**: link opens `/issues/?jql=…` with the family clause; a Jira search returns the same count (H2);
tile-click filter unchanged (H3).

- [ ] T007 [US2] RED — unit test in `client/src/views/Hygiene/utils/buildHygieneJqlUrl.test.ts` (+ clause tests beside
      `hygieneChecks.test.ts`): each family `jqlClause` (field refs, EMPTY conditions, type list), `buildHygieneCheckJql`
      composes `(scope) AND (clause)`, `buildJiraIssueNavigatorUrl(jql, base)` encodes + empty-base fallback. **N1**:
      assert the fix-version clause's type list **is** the exported `FIX_VERSION_ISSUE_TYPE_NAMES` (cannot drift from US1)
- [ ] T008 [P] [US2] RED — component test for the tile affordance in `client/src/views/Hygiene/HygieneView.test.tsx`
      (create/extend): each tile renders an "open in Jira ↗" link with an `/issues/?jql=` href AND still fires its
      in-app filter on tile click [C1]
- [ ] T009 [US2] GREEN — co-locate a `jqlClause` with each predicate in
      `client/src/views/Hygiene/checks/hygieneChecks.ts` (missing-fix-version reuses `FIX_VERSION_ISSUE_TYPE_NAMES`;
      ownership/estimate/pcode/target/due emit their EMPTY condition via `buildJqlFieldReference`/`readConfiguredPiFieldId`)
- [ ] T010 [US2] GREEN — extend `client/src/views/Hygiene/utils/buildHygieneJqlUrl.ts`: `buildHygieneCheckJql(checkId,
      scope, fieldConfig)` = `(scopeJql) AND (familyClause)` (scope from `buildHygieneSearchPath`); make
      `buildJiraIssueNavigatorUrl` accept a raw JQL string → `/issues/?jql=…`
- [ ] T011 [US2] GREEN — in `client/src/views/Hygiene/HygieneView.tsx` render a distinct "open in Jira ↗" anchor
      (`target="_blank" rel="noreferrer"`) on each summary tile, keeping the existing tile `onClick` filter and the
      copy-JQL affordance; zero-finding tiles still link (FR-008)
- [ ] T012 [US2] e2e — add **H2** (link opens JQL; stubbed Jira count agrees) and **H3** (tile filter unchanged) to
      `test/e2e/hygiene-jira-links.spec.js`

**Checkpoint**: hygiene numbers are correct AND verifiable against Jira.

---

## Phase 5: User Story 3 — Linked issue opens in the F2 lookup (Priority: P2)

**Goal**: clicking a linked-issue key opens the Quick Issue Lookup seeded with that key (FR-009..011, NFR-003; contract
`quick-lookup-open.md`). **Independent test**: click linked key → lookup opens on that issue; F2 still behaves as 022
(quickstart L1, L2).

- [ ] T013 [P] [US3] RED — unit test `useQuickLookupStore` in
      `client/src/components/QuickIssueLookup/quickLookupStore.test.ts`: `open()` (null seed, nonce++), `open('ABC-1')`
      (seed set), `close()` (cleared)
- [ ] T014 [P] [US3] RED — extend `client/src/components/QuickIssueLookup/QuickIssueLookup.test.tsx`: a `seedKey` prop
      drives `useIssueByKey(seedKey)` + prefills input; the gate opens when the store's `open` fires
- [ ] T015 [P] [US3] RED — extend `client/src/components/IssueDetailPanel/index.test.tsx`: a linked-issue key renders as
      a focusable control that calls the store `open(key)` on activation [C1]
- [ ] T016 [US3] GREEN — implement `client/src/components/QuickIssueLookup/quickLookupStore.ts`
      (`useQuickLookupStore { isOpen, seedKey, openNonce, open, close }`, zustand)
- [ ] T017 [US3] GREEN — `QuickIssueLookupGate.tsx`: read open state from the store (F2 → `open()`), pass
      `seedKey`+`key={openNonce}`; Escape/close → `close()`; F2-while-open still resets (022 behavior)
- [ ] T018 [US3] GREEN — `QuickIssueLookup.tsx`: optional `seedKey` prop presets `lookupKey`; omitted ⇒ unchanged
- [ ] T019 [US3] GREEN — `IssueDetailPanel/index.tsx` `renderIssueLinkRow`: linked key → focusable button calling
      `useQuickLookupStore.getState().open(linkedIssue.key)`; additive — other callers unchanged
- [ ] T020 [US3] e2e — add `test/e2e/linked-issue-lookup.spec.js`: **L1** (click linked key → lookup) + **L2** (F2 022
      regression)

**Checkpoint**: linked issues reachable in-app; shipped panel + F2 lookup unregressed.

---

## Phase 6: User Story 4 — PO Tool PI dropdown (Priority: P2)

**Goal**: PI is a dropdown of the team's PIs (FR-012..014; contract `po-pi-dropdown.md`). **Independent test**:
populated `<select>`; pick updates tool; team switch refreshes; invalid PI impossible (quickstart P1).

- [ ] T021 [P] [US4] RED — test `client/src/views/PoTool/PoTeamSelector.test.tsx` (create if absent): selecting an
      option updates `selectedPiName`; empty/failed options show the fallback (no blank locked control)
- [ ] T022 [US4] GREEN — `client/src/views/PoTool/PoTeamSelector.tsx`: PI `<input>` → `<select>` from
      `loadAvailablePiNamesFromJira(piReviewTeams)` (ArtView pattern: options, loading, reload); preselect via
      `findPiNameForDate`/profile `selectedPiValue`; team change refreshes; persist via `usePoToolState`; load-failure fallback
- [ ] T023 [US4] e2e — add `test/e2e/po-pi-dropdown.spec.js`: **P1**

**Checkpoint**: POs pick a PI; a non-existent PI cannot be chosen.

---

## Phase 7: User Story 5 — Remediation context beside the action (Priority: P2)

**Goal**: each item's context sits beside its decision buttons, hydrated without a manual refresh (FR-015..018; contract
`remediation-context.md`). **Independent test**: context beside buttons; decision persists; pending item shows loading
(quickstart R1).

- [ ] T024 [US5] RED — component test for
      `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.tsx`: a hydrated item shows
      status/assignee/summary beside its buttons; a pending item shows loading; deciding calls the same store actions
- [ ] T025 [US5] GREEN — restructure `BacklogRemediationPanel.tsx` so each item renders context (shared `IssueMeta`
      chips + summary/AC from `issuesByKey`) adjacent to Keep/Dismiss/Snooze/Cancel; buttons bound to their item;
      engine/persistence untouched
- [ ] T026 [US5] GREEN — hydrate `issuesByKey` (+`acceptanceCriteriaFieldIds`) on panel load (not only on Refresh),
      with per-item loading/unavailable states (never a silent blank beside a live button)
- [ ] T027 [US5] e2e — add `test/e2e/remediation-context.spec.js`: **R1**

**Checkpoint**: a reviewer decides an item without scrolling away from its context.

---

## Phase 8: User Story 6 — My Issues personas (Priority: P3)

**Goal**: simulate-as-user, role lens (default from roster role, overridable), SM/PO team views (FR-019..023; contract
`myissues-personas.md`). **Independent test**: view as another user (banner), switch role lens, view a team (quickstart
M1, M2).

**Pinned role criteria (U1)** — the `myIssuesRoleLens` mapping to build/test against:
- **Dev**: my in-progress + blocked + needs-estimate items.
- **Tester**: ready-for-QA + in-test items.
- **SM**: team blockers + hygiene flags + flow (aging/WIP).
- **PO**: feature readiness + backlog hygiene (missing ownership/estimate/fixVersion).

- [ ] T028 [P] [US6] RED — unit test `client/src/views/MyIssues/myIssuesRoleLens.test.ts`: role→emphasized-criteria per
      the pinned set above; roster `roleCapabilities`→default lens (canScrumMaster→sm, canProductOwner→po,
      canInternalTest/canExternalTest→tester, else dev); subject→assignee JQL (viewer=currentUser,
      user=`assignee="<id>"`, team=`assignee in (...)`)
- [ ] T029 [P] [US6] RED — component test in `client/src/views/MyIssues/MyIssuesView.test.tsx` (create/extend):
      simulate-as banner ("Viewing as <name>" + Back to me), role-lens control changes emphasized sections, SM/PO team
      switch [C1]
- [ ] T030 [US6] GREEN — implement pure `client/src/views/MyIssues/myIssuesRoleLens.ts` (role→criteria per the pinned
      set; roster-role→default lens; subject→assignee-JQL helper)
- [ ] T031 [US6] GREEN — `client/src/views/MyIssues/hooks/useMyIssuesState.ts`: add `subject` (viewer|user|team), derive
      the "mine" assignee clause from it (swap `currentUser()`); read-only, no write path (FR-023)
- [ ] T032 [US6] GREEN — `MyIssuesView.tsx`: "simulate as" Jira user-search (reuse `searchFeatureReviewUsers`) +
      "Viewing as <name>" banner with one-action **Back to me** (FR-019/020)
- [ ] T033 [US6] GREEN — `MyIssuesView.tsx`: role-lens control defaulting from the subject's roster role, manually
      overridable; emphasized sections follow `myIssuesRoleLens` (FR-021)
- [ ] T034 [US6] GREEN — `MyIssuesView.tsx`: for SM/PO lenses, a subject switch between own work and a selected team
      (roster membership → `assignee in (...)`) (FR-022)
- [ ] T035 [US6] e2e — add `test/e2e/myissues-personas.spec.js`: **M1** (simulate + banner + back-to-me) + **M2** (role
      lens change; SM/PO team view)

**Checkpoint**: all six stories independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T036 e2e — scenario **X1**: run each new surface across light/dark, A/A+/A++, narrow width; assert
      reflow-not-clip + text-beside-color (NFR-001) — across the per-story spec files
- [ ] T037 [P] Update `CHANGELOG.md` (Unreleased) with the six GH #200 fixes (grouped entry, per-story bullets)
- [ ] T038 Run full gates + quickstart validation: `cd client && npx vitest run && npx tsc -b && npx eslint .`;
      `npm test` (server); `npx playwright test test/e2e/{hygiene-jira-links,linked-issue-lookup,po-pi-dropdown,
      remediation-context,myissues-personas}.spec.js`; confirm H2 count-agreement + no shipped-surface regression (L2)

---

## Dependencies & Execution Order

- **Setup** → no deps. **Foundational** → none.
- **US1** (MVP) merges first. **US2** after US1 (reuses the exported constant; same worktree/track).
- **US3, US4, US5** (P2) independent of each other and US1/US2 → parallel worktrees.
- **US6** (P3) independent → parallel worktree; largest.
- **Polish** → after desired stories.
- Within a story: RED precedes GREEN (Art V); pure/store/hook before components; e2e last.

### Parallel opportunities

- **5 worktree tracks**: {US1→US2}, US3, US4, US5, US6 — disjoint file areas.
- Within-story [P] RED tests (T008; T013/T014/T015; T028/T029) run in parallel.
- Each story owns its own e2e spec file (H1–H3 share `hygiene-jira-links.spec.js` → sequential within US1/US2).

---

## Parallel Example: worktree tracks

```bash
Track A: US1 (T002–T006) → US2 (T007–T012)   # shared hygieneChecks.ts
Track B: US3 (T013–T020)
Track C: US4 (T021–T023)
Track D: US5 (T024–T027)
Track E: US6 (T028–T035)
```

---

## Implementation Strategy

### MVP first (US1)

Setup → US1 → **STOP & VALIDATE H1**: the check now tells the truth. Ship the correctness fix first.

### Incremental / parallel delivery

US1 → US2 → {US3, US4, US5 in parallel} → US6 → Polish. Each ships without breaking the others; US3's shipped-panel/
F2-lookup changes are additive (L2 regression guard).

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- **NFR-002 (N1)**: `FIX_VERSION_ISSUE_TYPE_NAMES` is exported from `hygieneChecks.ts` and consumed by BOTH US1's
  predicate and US2's JQL clause; T007 asserts they reference the same constant.
- US3's store/panel changes are additive/default-safe; verify F2 (022) unregressed (L2) before merge.
- Commit after each task or logical group; verify RED tests fail before GREEN.
