# Tasks: PI Delivery Framework — Plan-Once, Monitor-Continuously

**Feature**: `032-pi-delivery-framework` | **Branch**: `feature/032-pi-delivery-framework`
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contracts**: [contracts/](./contracts/)

**Approach**: TDD (Article V) — each pure module gets its `.test.ts` (vitest) written and failing before implementation.
Client-only feature; no server code. All paths under `client/src/views/ArtView/`.

**Build order note**: US1–US3 are all P1 and interdependent — US1 (whole-PI generation) *assembles* the US2 scaffold
and US3 dates. They are therefore built **US2 → US3 → US1** (structure → dates → generation UI). The **MVP is
US1+US2+US3 together**. US4 (bottlenecks) and US5 (monitoring) are P2 and layer on top.

---

## Phase 1: Setup

- [ ] T001 Extend `client/src/views/ArtView/piPlan/piPlanTypes.ts` with all new contracts: `SubTaskKind` adds `'coding'` and renames `'internalTest'`→`'slTest'`; add `RepoCodingSubtask`; extend `ScheduledStory` with `codingSubtasks: RepoCodingSubtask[]`; add fact-sheet types (`PiPlanningFactSheet`, `FactSheetFeature`, `FactSheetPerson`, `FactSheetSprint`); add `Bottleneck`/`BottleneckKind`; add monitoring types (`MonitorSignal`, `ReplanTrigger`, `MonitorResult`). Per [data-model.md](./data-model.md).

---

## Phase 2: Foundational (blocking prerequisites for all user stories)

**Blocks every user story — the fact sheet and capacity model are the shared spine.**

- [ ] T002 [P] Write failing vitest for the fact-sheet assembler in `client/src/views/ArtView/piPlan/piPlanFactSheet.test.ts` per [contracts/fact-sheet.md](./contracts/fact-sheet.md): 0.80 load factor applied exactly once to every person; repo/domain component split (unclassified excluded); `repoAllowlist` = de-duped union of repo names; `deliveryDeadlineIso` = end of Sprint-5 Week-1 for a 5×2-week calendar; immutability of the returned sheet.
- [ ] T003 Implement `client/src/views/ArtView/piPlan/piPlanFactSheet.ts` (`assembleFactSheet(inputs)`) to pass T002 — pure, injectable clock, assembles from the query-set inputs (no I/O inside).
- [ ] T004 [P] Write failing vitest in `client/src/views/ArtView/piPlan/piPlanCapacity.test.ts`: velocity × 0.80 load factor; Sprint-5 Week-1 delivery deadline derivation; Sprint-5 Week-2 modelled as zero delivery capacity.
- [ ] T005 Implement/extend `client/src/views/ArtView/piPlan/piPlanCapacity.ts` with the load-factor scaling and the Sprint-5 delivery-window helpers to pass T004.

---

## Phase 3: User Story 2 — Repo→Sub-task structure with parallel ownership (Priority: P1) 🎯 MVP

**Goal**: One coding sub-task per repo (parallel assignees) + one SL-test + per-story INT/REL/PROD deploys; replaces 031's story-per-repo.

**Independent Test**: A Story touching 3 repos → exactly 3 coding sub-tasks (repo on each component field) + 1 SL-test + 1 each INT/REL/PROD; a single-repo Story → exactly 1 coding sub-task (no explosion).

- [ ] T006 [P] [US2] Write failing vitest in `client/src/views/ArtView/piPlan/piPlanRepoSubtasks.test.ts` per [contracts/repo-subtask-generation.md](./contracts/repo-subtask-generation.md): N repos → N coding sub-tasks + 1 SL-test + 3 deploys; single-repo → 1 coding sub-task; **a multi-repo Defect follows the same scaffold (FR-004)**; dev-point partition sums to the Story's dev points (each ≥1); idempotent skip of an existing child coding sub-task; zero repos → zero coding sub-tasks + "map repos first"; unresolved repo id surfaced not written.
- [ ] T007 [US2] Implement `client/src/views/ArtView/piPlan/piPlanRepoSubtasks.ts` (`buildRepoCodingSubtasks`, `buildStorySubtaskScaffold`, equal point partition, idempotency, titles `[{repo}] {summary}`/`[SL] SL Test`/`[INT|REL|PROD] Deploy`, component-id resolution) to pass T006.
- [ ] T008 [US2] Restructure `client/src/views/ArtView/piPlan/piPlanEngine.ts` so the capacity unit is the **coding sub-task**: feed each coding sub-task + the SL-test as `PlanItem`s to `buildCapacityPlan` (parallel per-repo assignment; SL-test on the `internalTest` role), assemble `ScheduledStory.codingSubtasks` with per-repo assignees, and roll the Story's Target Start/End up from its children (per [research.md](./research.md) R1–R2). Retain the 028 **13-pt Story cap** warning via `expandBreakdown`/`MAX_STORY_POINTS` (FR-015).
- [ ] T009 [US2] Update `client/src/views/ArtView/piPlan/piPlanEngine.test.ts` for the restructure (parallel per-repo assignment; date rollup). **Regression gate**: the 028 **capacity/date/scheduling behaviour** assertions (`buildCapacityPlan`, `piPlanDates`, breakdown effort-split) MUST stay green — a required change there means behaviour drifted. Assertions that reference the renamed `SubTaskKind` (`internalTest`→`slTest`) or the `[IT]`→`[SL]` label ARE expected to change and do not count as drift.
- [ ] T010 [US2] Extend `client/src/views/ArtView/piPlan/piPlanJira.ts` + `piPlanJira.test.ts` to write coding sub-tasks (repo on the `components` field via resolved id), the SL-test sub-task, and INT/REL/PROD deploys; relabel `[IT]`→`[SL]`; idempotent skip of existing children; every write still delegates to an existing primitive.

---

## Phase 4: User Story 3 — Deterministic dates, capacity, and 80% / Sprint-5 rules (Priority: P1) 🎯 MVP

**Goal**: Every date/capacity figure rule-derived; delivery completes by Sprint-5 Week-1; no person over 80%.

**Independent Test**: For sized Stories, INT/REL/PROD/Due follow the cadence on working days; no Target End after Sprint-5 Week-1; planned load per person per sprint never exceeds 80%.

- [ ] T011 [P] [US3] Write failing vitest in `client/src/views/ArtView/piPlan/piPlanDates.test.ts` (additions) asserting on the new structure: SL-test end gates INT (≤24h); REL = INT + 5 working days; PROD = first fixVersion on/after REL; Target End (code-in-INT) ≤ Sprint-5 Week-1; Due may exceed the PI end.
- [ ] T012 [US3] Wire the Sprint-5 Week-1 `deliveryDeadlineIso` and the 80% factor through `piPlanEngine.ts`, so scheduling targets the delivery window and the SL-test/dev streams both respect the capped capacity.
- [ ] T013 [US3] Add honest-state warnings in `piPlanEngine.ts`: any item whose Target End would fall in Sprint-5 Week-2, and any person whose planned sprint load would exceed 80%, are surfaced (never silently absorbed) — SC-005, SC-006.

---

## Phase 5: User Story 1 — Generate the whole PI from committed Features (Priority: P1) 🎯 MVP

**Goal**: One propose-only prompt embedding the fact sheet → paste reply → per-item-acceptable whole-PI plan.

**Independent Test**: Generate the prompt, paste a valid reply → a complete plan with engine-computed dates; a reply naming an unknown repo/person/sprint/key is rejected and nothing writes.

- [ ] T014 [P] [US1] Write failing vitest in `client/src/views/ArtView/piPlan/ai/deliveryPlanPrompt.test.ts` per [contracts/ai-delivery-plan.md](./contracts/ai-delivery-plan.md): the prompt embeds the fact sheet + engine-flagged bottlenecks and asks **only** for story decomposition + mitigations (no date/assignment request); chunks when the Feature set is large.
- [ ] T015 [US1] Implement `client/src/views/ArtView/piPlan/ai/deliveryPlanPrompt.ts` (`buildDeliveryPlanPrompt(factSheet, bottlenecks)`) to pass T014.
- [ ] T016 [P] [US1] Write failing vitest in `client/src/views/ArtView/piPlan/ai/deliveryPlanIngest.test.ts`: reject a story naming a repo not in `repoAllowlist` (with reason) while others survive; reject an unknown `featureKey`; reject a mitigation with an unknown `bottleneckId`; ignore any AI-supplied date/assignee/sprint; repair a lightly-malformed / prose-wrapped reply via `repairJsonPayload`.
- [ ] T017 [US1] Implement `client/src/views/ArtView/piPlan/ai/deliveryPlanIngest.ts` (`parseDeliveryPlanReply(reply, factSheet, bottlenecks)`) to pass T016 (allowlist-reject, propose-only result).
- [ ] T018 [US1] Build `client/src/views/ArtView/PiDeliveryPlanTab.tsx`: render the fact-sheet panel; AI-gated (`useAiAssistStore`, Ctrl+Alt+Z) generate-prompt via `ReportAiPanel`/`PoAiPanel`; paste-reply → ingest → reviewable plan; per-item accept → write via `piPlanJira`; **allow PO-override of a coding sub-task's assignee before accept (FR-016)**. Reuse the sibling ArtView CSS module (no unstyled HTML).
- [ ] T019 [US1] Mount `PiDeliveryPlanTab` additively in `client/src/views/ArtView/ArtView.tsx` (and/or `PoToolView`) — a few lines beside the existing Planner; touch no existing tab logic.

---

## Phase 6: User Story 4 — Deterministic bottleneck detection with AI mitigation (Priority: P2)

**Goal**: Engine flags SL-test throughput / key-person / dependency / PROD-carry with figures; AI mitigations attach to flagged ids only.

**Independent Test**: A sprint where dev output exceeds SL capacity → an `slTestThroughput` flag with figures; a single-capable repo → `keyPerson`; mitigations attach only to matching ids.

- [ ] T020 [P] [US4] Write failing vitest in `client/src/views/ArtView/piPlan/piPlanBottlenecks.test.ts` per [contracts/bottleneck-detection.md](./contracts/bottleneck-detection.md): `slTestThroughput` derived from `PlanResult.bottleneck` + per-sprint SL loads (with figures); `keyPerson` for a repo with exactly one capable member; `dependencyOrder` when a dependency is scheduled later; `prodCarry` when Due > PI end; mitigation attaches only on matching `bottleneckId`.
- [ ] T021 [US4] Implement `client/src/views/ArtView/piPlan/piPlanBottlenecks.ts` (`detectBottlenecks(planResult, factSheet, scheduledStories)`) to pass T020 — reuses `PlanResult.bottleneck`, never recomputes the limiting-role figure.
- [ ] T022 [US4] Render bottlenecks + attached mitigations in `PiDeliveryPlanTab.tsx`; wire the ingest's mitigation map onto the engine-flagged bottleneck ids.

---

## Phase 7: User Story 5 — Monitor adherence, not re-plan (Priority: P2)

**Goal**: On-track signals + explicit replan triggers against the written plan.

**Independent Test**: The monitor reports the five signals against the plan; a slipped Story raises `storySlipped`; two over-capacity SL sprints raise `slQueueOverTwoSprints`.

- [ ] T023 [P] [US5] Write failing vitest in `client/src/views/ArtView/piPlan/piPlanMonitor.test.ts` per [contracts/monitoring-signals.md](./contracts/monitoring-signals.md): burn-up off-track when completed < planned-to-date; SL-queue depth over capacity flags; two consecutive over-capacity sprints raise `slQueueOverTwoSprints`; a late-delivered Story raises `storySlipped`; freshness uses the last intake-comment timestamp + injected clock.
- [ ] T024 [US5] Implement `client/src/views/ArtView/piPlan/piPlanMonitor.ts` (`computeMonitor(plan, live, nowIso)`) to pass T023 — pure, clock injected.
- [ ] T025 [US5] Build `client/src/views/ArtView/PiDeliveryMonitor.tsx` reading live Jira state + GitHub-intake freshness; render the five signals + triggers; mount beside the plan tab (reuse the ArtView CSS module).

---

## Phase 8: Polish & Cross-Cutting

- [ ] T026 Remove `client/src/views/ArtView/piPlan/repoStoryBreakdown.ts` and `repoStoryBreakdown.test.ts` after confirming (grep) no other importer; reconcile any 031 reference. (Keep `componentClassificationStore` + the domain rule.)
- [ ] T027 [P] Run the full client `vitest run`, `tsc -b`, and eslint; confirm the 028 **capacity/date/scheduling behaviour** tests pass unchanged (regression gate) — only kind/label assertions updated for the `SubTaskKind` rename may differ — and the whole suite is green.
- [ ] T028 Update `CHANGELOG.md` (Unreleased) with the PI Delivery Framework (repo→sub-task, fact-sheet-gated AI planning, deterministic bottlenecks, monitoring).
- [ ] T029 [P] Execute [quickstart.md](./quickstart.md) live-Jira validation (VPN up) end-to-end; record outcomes.

---

## Dependencies & Execution Order

```
Setup (T001)
  └─► Foundational (T002–T005: fact sheet + capacity)
        └─► US2 (T006–T010: repo→sub-task + engine restructure + writes)   ── the structural spine
              └─► US3 (T011–T013: dates/capacity/windows on the new structure)
                    └─► US1 (T014–T019: AI prompt/ingest + tab + mount)     ── MVP complete (US1+US2+US3)
                          ├─► US4 (T020–T022: bottlenecks + mitigations)
                          └─► US5 (T023–T025: monitoring)
                                └─► Polish (T026–T029)
```

- **US2 before US1** among the P1s: generation (US1) assembles the repo-subtask scaffold (US2) and dates (US3).
- **US4 depends on US1** (bottlenecks embed in the plan + prompt) and on the engine's `PlanResult` (US2/US3).
- **US5 depends on a written plan** (US1) but is otherwise independent of US4.

## Parallel Opportunities

- **Within Foundational**: T002 (fact-sheet test) ∥ T004 (capacity test) — different files.
- **Test-first pairs** marked `[P]` (T006, T011, T014, T016, T020, T023) can each be written while the prior phase's implementation is in review — different files, no shared state.
- **Polish**: T027 (suite run) ∥ T029 (manual quickstart) once code is complete.
- Note: T008/T012/T013 all edit `piPlanEngine.ts` → **sequential** (same file). T018/T022 both edit `PiDeliveryPlanTab.tsx` → **sequential**.

## Independent Test Criteria (per story)

- **US1**: valid reply → complete plan with engine dates; unknown repo/key rejected, nothing written.
- **US2**: 3-repo Story → 3 coding + 1 SL + 3 deploys; 1-repo → 1 coding (no explosion); idempotent.
- **US3**: cadence dates on working days; no Target End past Sprint-5 Week-1; no load > 80%.
- **US4**: SL-throughput flagged with figures when dev > SL capacity; key-person flagged; mitigations attach to matching ids only.
- **US5**: five signals reported vs plan; `storySlipped` + `slQueueOverTwoSprints` triggers fire.

## MVP Scope

**US1 + US2 + US3** (T001–T019) — a committed Feature set becomes a complete, per-item-acceptable, deterministically
dated 5-sprint plan with repo→sub-task structure. US4 (bottlenecks) and US5 (monitoring) are the high-value follow-ons
that turn the plan into a monitor-not-plan surface.
