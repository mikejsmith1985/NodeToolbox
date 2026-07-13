---
description: "Task list for Per-Team Persistent Backlog Remediation"
---

# Tasks: Per-Team Persistent Backlog Remediation

**Input**: Design documents from `specs/014-team-backlog-remediation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED and TDD-ordered — the project constitution (Article V) mandates a failing test before
implementation. Write each test task first, watch it fail, then implement.

**Organization**: Setup → Foundational (the per-team store + pure reconciliation that US1/US2/US4 all rely on) →
one phase per user story in priority order → Polish. This is a frontend-only change under `client/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 (from spec.md); Setup/Foundational/Polish carry no story label
- All paths are repository-relative.

---

## Phase 1: Setup (Shared)

- [x] T001 Add a `## [Unreleased]` entry to `CHANGELOG.md` naming feature 014 (per-team persistent Backlog
  Remediation panel on the Team Dashboard), to be fleshed out during implementation
- [x] T002 [P] Add the remediation domain types — `RemediationStatus`, `ItemFingerprint`, `RemediationItem`,
  `RemediationQueue`, `TeamScope` — per data-model.md §1–§5, in
  `client/src/views/SprintDashboard/backlogRemediation/remediationTypes.ts` (types only, no behavior)

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: The per-team persisted queue and the pure reconciliation both US1 (resume), US2 (isolation), and US4
(no resurfacing) depend on, plus the shared enriched backlog fetch the panel needs. **US-facing work is blocked
until these are green.**

### Tests (write first — must FAIL) ⚠️

- [x] T003 [P] Unit test `remediationReconcile` — out-of-scope drop, new→pending, snooze elapse (today injected),
  terminal hold, material-change re-entry (status-category change vs reassignment-into-team), cosmetic-no-op, and
  determinism — per contracts/reconciliation.md, in
  `client/src/views/SprintDashboard/backlogRemediation/remediationReconcile.test.ts`
- [x] T004 [P] Unit test `useBacklogRemediationStore` — decision round-trip through persistence, **team isolation**
  (scope A decision invisible under scope B and vice-versa), tolerant load of a corrupt/missing blob (→ empty, no
  throw), per-team `scopeOverrideJql`, and `ingestVerdicts` updating only matching `pending` items — per
  contracts/remediation-store.md, in
  `client/src/views/SprintDashboard/backlogRemediation/useBacklogRemediationStore.test.ts`

### Implementation

- [x] T005 Implement pure `reconcile(savedItems, fetched, currentFingerprintByKey, todayIso)` per
  contracts/reconciliation.md (drop / new / elapse / hold / material-change / signal-refresh / stable order) — no
  Jira, no React, no clock — in `client/src/views/SprintDashboard/backlogRemediation/remediationReconcile.ts`
  (depends on T002)
- [x] T006 Implement `useBacklogRemediationStore` — Zustand store persisted under
  `tbxBacklogRemediation:<resolveTeamScopedStorageProfileId(teamProfileId)>:<deriveScopeKey(projectKey,piName)>`
  (reuse `teamScopedStorage.resolveTeamScopedStorageProfileId` and `overlayStorage.deriveScopeKey`), with
  `setScope` / `applyReconcile` / `ingestVerdicts` / `decide` / `snooze` / `reopen` / `setScopeOverrideJql`, all
  write-through and tolerant-load — in `client/src/views/SprintDashboard/backlogRemediation/useBacklogRemediationStore.ts`
  (depends on T002)
- [x] T007 [P] Extract the enriched backlog fetch + `toTriageIssue` (paged NOT-Done fetch, feature-link resolution,
  AC field resolution, `storyPointsField` read → `AgingTriageIssue[]`) out of
  `client/src/views/ReportsHub/IssueAgingTab.tsx` into a reusable
  `client/src/views/ReportsHub/agingBacklogFetch.ts`; `IssueAgingTab` imports it so its existing tests still pass

**Checkpoint**: Reconciliation + store proven by unit tests; the enriched fetch is reusable. MVP can proceed.

---

## Phase 3: User Story 1 — Resume a team's remediation queue (Priority: P1) 🎯 MVP

**Goal**: A gated Team Dashboard panel that fetches the team's backlog, runs the copy-out AI triage, ingests
verdicts, reconciles against the persisted queue, and shows the grouped actionable table — so reopening the panel
after a reload shows the prior verdicts and decisions with **no** re-run. (Spec US1.)

**Independent Test**: Ingest verdicts, mark a couple of items, reload the app, reopen the panel for the same team →
prior state is present without re-running the AI round-trip.

### Tests for User Story 1 (write first — must FAIL) ⚠️

- [x] T008 [P] [US1] Component test `BacklogRemediationPanel` — renders `null` when AI locked; on unlock shows the
  copy prompt; ingesting a reply persists verdicts to the store and renders the grouped table; a fresh mount for the
  same scope **resumes** from persisted state without a re-run — in
  `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.test.tsx`

### Implementation for User Story 1

- [x] T009 [US1] Implement `BacklogRemediationPanel` — wrap in `ReportAiPanel` (AI gate); fetch via
  `agingBacklogFetch`; build the prompt with `buildAgingTriagePrompt`; ingest with `parseAgingTriageResponse` →
  `store.ingestVerdicts`; `store.applyReconcile(reconcile(...), todayIso)` on fetch; render `AgingTriageActionTable`
  over the reconciled queue — in `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.tsx`
  (depends on T005, T006, T007)
- [x] T010 [US1] Mount the panel as a new Team Dashboard tab: add the tab key to the `DashboardTab` union in
  `client/src/views/SprintDashboard/hooks/useSprintData.ts`, add the `TAB_OPTIONS` entry and a
  `renderActiveTabPanel` branch (passing `projectKey`/`selectedPiValue`) in
  `client/src/views/SprintDashboard/SprintDashboardView.tsx` (depends on T009)

**Checkpoint**: One team's remediation queue is resumable across reloads. MVP shippable.

---

## Phase 4: User Story 2 — Two teams in parallel (Priority: P1)

**Goal**: Switching the active team profile swaps the panel to that team's own queue; acting in one team never
mutates another. (Spec US2.)

**Independent Test**: With two team profiles holding different state, switch between them → each shows only its own
items and decisions; acting in one leaves the other unchanged.

### Tests for User Story 2 (write first — must FAIL) ⚠️

- [x] T011 [P] [US2] Component/integration test — changing the active team profile calls `store.setScope(...)` and
  re-renders the other team's queue; a decision under team A is absent under team B (and vice-versa) — in
  `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.teams.test.tsx`

### Implementation for User Story 2

- [x] T012 [US2] Propagate the active team profile into the store: call
  `useBacklogRemediationStore.getState().setScope(activeDashboardTeamProfileId, state.projectKey,
  state.selectedPiValue)` from the existing scope-sync effect in
  `client/src/views/SprintDashboard/SprintDashboardView.tsx` (alongside `setDashboardTeamProfileId`) (depends on T010)

**Checkpoint**: Parallel per-team queues with no cross-team bleed.

---

## Phase 5: User Story 3 — Scope follows the team (Priority: P2)

**Goal**: Default backlog scope is derived from the active team profile (project [+ roster clause]); an optional
per-team JQL override is remembered per team. (Spec US3.)

**Independent Test**: With no JQL typed, the panel scopes from the team profile; a typed override is used and
remembered for that team only; a team with no derivable scope is prompted for a JQL.

### Tests for User Story 3 (write first — must FAIL) ⚠️

- [x] T013 [P] [US3] Unit test `resolveTeamScope` — override wins (wrapped by `buildAgingJql`); derived
  `project = KEY` clause; project + roster `assignee in (...)` clause; empty `jql` when nothing derivable — per
  contracts/scope-resolution.md, in `client/src/views/SprintDashboard/backlogRemediation/remediationScope.test.ts`

### Implementation for User Story 3

- [x] T014 [US3] Implement `resolveTeamScope(...)` reusing `buildAgingJql` and
  `buildStandupRosterAssigneeClause` — in `client/src/views/SprintDashboard/backlogRemediation/remediationScope.ts`
  (depends on T002)
- [x] T015 [US3] Wire scope into the panel: derive the fetch JQL via `resolveTeamScope`, add the per-team JQL
  override input bound to `store.setScopeOverrideJql`, and prompt for a JQL when the derived `jql` is empty — in
  `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.tsx` (depends on T009, T014)

**Checkpoint**: Common case needs no typed JQL; override remembered per team.

---

## Phase 6: User Story 4 — Handled items stay handled (Priority: P1)

**Goal**: Per-item decision controls (cancel / keep / dismiss / snooze) that capture the material-change
fingerprint at decision time, so a refresh does not resurface handled work (snoozed returns only after its date;
material change re-admits). (Spec US4.)

**Independent Test**: After deciding items and refreshing, handled items do not reappear; a snoozed item returns
after its date; a status-category change or reassignment-into-team re-admits an item; a cosmetic edit does not.

### Tests for User Story 4 (write first — must FAIL) ⚠️

- [x] T016 [P] [US4] Component test — each actionable row exposes cancel/keep/dismiss/snooze; invoking one calls the
  store with an `ItemFingerprint` captured from the current status-category + assignee; after a re-fetch the handled
  item is not shown as pending (except on material change / elapsed snooze) — in
  `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.lifecycle.test.tsx`

### Implementation for User Story 4

- [x] T017 [US4] Add per-row decision + snooze controls to the panel that build the `ItemFingerprint`
  (`{ statusCategoryKey, assigneeKey }`) from the fetched issue and call `store.decide` / `store.snooze`; on each
  refresh compute `currentFingerprintByKey` from the fetch and pass it to `reconcile` — in
  `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.tsx` (depends on T009, T005)

**Checkpoint**: Handled work stays handled; only material change or an elapsed snooze re-admits it.

---

## Phase 7: User Story 5 — Enact cleanup, safely (Priority: P2)

**Goal**: Bulk-close a cancel-safe feature group via the existing preview → opt-out → commit flow, and reflect the
committed items as `canceled` in the persisted queue. (Spec US5.)

**Independent Test**: Committing a bulk close transitions each item individually (own result) and the persisted
queue records those items as canceled; a reload keeps them canceled.

### Tests for User Story 5 (write first — must FAIL) ⚠️

- [x] T018 [P] [US5] Test — a successful bulk-close commit marks exactly the committed issue keys `canceled` in the
  store (skipped/failed items are not marked) — in
  `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.bulkclose.test.tsx`

### Implementation for User Story 5

- [x] T019 [US5] Wire the reused `AgingBulkClosePanel` commit results (from `runBulkTransition` /
  `saveFeatureReviewTransition`) back into `store.decide(key, 'canceled', fingerprint, decidedAtIso)` for each
  `done` outcome — in `client/src/views/SprintDashboard/backlogRemediation/BacklogRemediationPanel.tsx`
  (depends on T009, T017)

**Checkpoint**: Cleanup enactment matches today's triage and is recorded in the queue.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T020 Remove the actionable triage UI from `client/src/views/ReportsHub/IssueAgingTab.tsx` (keep the metrics
  report; simplify its fetch to the fields `computeIssueAging` needs) and update `IssueAgingTab.test.tsx` so the
  metrics still render and the triage no longer appears there (FR-003)
- [ ] T021 [P] Finalize the `CHANGELOG.md` entry for feature 014 (per-team persistent remediation panel; triage
  moved off the Reports Hub; metrics unchanged)
- [ ] T022 Run the `quickstart.md` validation — Parts 1–6 (placement/gating, team-scoped run, persistence/parallel
  teams, no-resurfacing, enact cleanup, regression guard)
- [ ] T023 Run `cd client && npm run build` and `cd client && npx vitest run` for the touched suites
  (reconcile, store, scope, panel + its team/lifecycle/bulkclose tests, IssueAgingTab) — all green

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T002)**: T002 (types) blocks all logic.
- **Foundational (T003–T007)**: after T002; **blocks every user story**. T005/T006 are the store+reconcile; T007
  (fetch extraction) is independent and parallelizable.
- **US1 (T008–T010)**: after Foundational. The MVP.
- **US2 (T011–T012)**: after US1 (panel + store must exist to swap scope).
- **US3 (T013–T015)**: after Foundational (T014 needs only types); T015 wires into the US1 panel.
- **US4 (T016–T017)**: after US1 (controls live on the panel) + T005 (reconcile).
- **US5 (T018–T019)**: after US1 + US4 (needs the fingerprint capture).
- **Polish (T020–T023)**: after all desired stories; T020 (Reports Hub removal) only after the panel is proven.

### Within-story order

- Foundational: tests T003/T004 → impl T005/T006 (T007 parallel).
- US1: test T008 → panel T009 → tab wiring T010.
- US3: test T013 → `resolveTeamScope` T014 → panel wiring T015.
- US4: test T016 → controls + reconcile wiring T017.
- US5: test T018 → commit→store wiring T019.

### Parallel opportunities

- **Foundational tests**: T003, T004 together (different files); T007 parallel to both.
- **Cross-story after Foundational**: T014 (`resolveTeamScope`) can be built in parallel with the US1 panel since it
  only depends on types; it is *wired in* at T015.
- Story test tasks (T008, T011, T013, T016, T018) are each in their own file and can be drafted in parallel once
  their target module exists.

---

## Implementation Strategy

### MVP first (US1 only)

1. T001 → T002 → Foundational (T003–T007) → US1 (T008–T010).
2. **STOP and VALIDATE**: quickstart Parts 1–3 (gating, team-scoped run, persistence across reload). A single-team
   resumable remediation panel is a shippable increment.

### Incremental delivery

1. Setup + Foundational → US1 (MVP) → demo the resumable panel.
2. US2 (parallel teams) → US3 (scope follows team) → US4 (no resurfacing) → US5 (enact) — each an independent demo.
3. Polish → remove Reports Hub triage, CHANGELOG, full quickstart, build/test green.

---

## Notes

- `[P]` = different files, no incomplete-task dependency. `[Story]` maps each task to US1–US5.
- TDD is mandatory (Article V): each test task precedes its implementation and must fail first.
- **Framework-first**: the triage prompt/parse, action model, actionable table, bulk-close, AI gate, scoped-storage
  primitives, roster clause, and Feature Review write helpers are all reused; only the store + reconciliation +
  scope resolver + panel are new.
- No server change; no new Jira write path (bulk close reuses Feature Review transitions). One store, local
  persistence, per team.
- Commit after each task or logical group; stop at the US1 checkpoint to validate the MVP independently.
