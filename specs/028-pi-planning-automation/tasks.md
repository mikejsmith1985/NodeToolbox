# Tasks: PI Planning Automation

**Input**: Design documents from `specs/028-pi-planning-automation/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅ (planning-engine, date-cadence, ai-assist-json, jira-writes)

**Tests**: INCLUDED — Constitution Article V mandates TDD (red → green → refactor). Every pure module and write-payload builder gets a failing vitest suite before its implementation.

**Organization**: Tasks grouped by user story (spec priorities). MVP = US1 + US2 (both P1). All new code is client-side TypeScript under `client/src/views/ArtView/`; every Jira write and the scheduler engine are **reused** (see plan.md drift ledger) — do NOT re-implement them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- Paths are exact. Test files sit beside their module (`*.test.ts` / `*.test.tsx`), per repo convention.

## Guardrails (apply to every task)

- **Do NOT edit** `FeatureCanvas/planner/*`, `services/jiraApi.ts`, `piReviewJira.ts`, `featureReviewFixes.ts`, `hygieneFieldConfig.ts`, or the three PI Review host surfaces beyond an additive mount. If a reused function seems to need a change, wrap it — the reused tests must stay green.
- Pure modules take an injected clock (`todayIso`) and calendar — no `Date.now()` (repo rule; keeps determinism/resume).
- AI is propose-only and gated by `useAiAssistStore`; nothing writes to Jira without a per-item accept.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the module skeleton and confirm the reused surfaces build.

- [x] T001 Create the feature module directory `client/src/views/ArtView/piPlan/` and the AI trio location `client/src/views/ArtView/ai/` (already exists) — add empty barrel notes only; no logic yet.
- [x] T002 [P] Verify the reused engine + primitives resolve by adding a temporary import smoke check (removed before commit): `buildCapacityPlan` from `FeatureCanvas/planner/capacityPlanner.ts`, `createIssue`/`createSprint`/`getBoardSprints` from `services/jiraApi.ts`, `savePiReviewFeatureDates` from `ArtView/piReviewJira.ts`, `saveFeatureReviewFixVersion` from `SprintDashboard/featureReviewFixes.ts`, `loadHygieneFieldConfig` from `Hygiene/checks/hygieneFieldConfig.ts`, `parsePiDateRange` from `ArtView/hooks/artHelpers.ts`.
- [x] T003 [P] Confirm baseline is green before writing any feature code: `cd client && npx vitest run src/views/FeatureCanvas/planner` (this suite must remain green through the whole feature).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure building blocks the planner engine composes. **BLOCKS all user stories.**

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T004 [P] Define shared data contracts in `client/src/views/ArtView/piPlan/piPlanTypes.ts` per data-model.md (`FeatureInput`, `ExistingChild`, `BreakdownSuggestion`, `StorySuggestion`, `ScheduledStory`, `DatedItem`, `ReleaseSchedule`/`ReleaseEntry`, `PlanItemProposal`, `PlanProposal`, `WorkingCalendar`). Types only, no logic.
- [x] T005 [P] Write failing tests `client/src/views/ArtView/piPlan/piPlanDates.test.ts` for the date-cadence contract: `addWorkingDays` skips weekends+holidays; REL = INT + 5 working days across a weekend and a holiday; INT rolls a Saturday internal-test-end to Monday (≤24h next-working-day); PROD selects the next release; Due may exceed PI end; determinism.
- [x] T006 Implement `client/src/views/ArtView/piPlan/piPlanDates.ts` (pure; clock+calendar injected): `addWorkingDays`, `rollToWorkingDay`, `workingDaysBetween`, and `computeItemDates(story, ctx) → DatedItem` with per-date `derivations`, per contracts/date-cadence.md. Make T005 green.
- [x] T007 [P] Write failing tests `client/src/views/ArtView/piPlan/piPlanReleaseSchedule.test.ts`: the pure `buildReleaseSchedule` keeps only fixVersions with release date in the PI window (and just beyond, per FR-036), sorts into a calendar, returns an empty calendar honestly when none; and (mocked proxy) `fetchPiWindowFixVersions(projectKey)` reads `GET /rest/api/2/project/{key}/versions`.
- [x] T008 Implement `client/src/views/ArtView/piPlan/piPlanReleaseSchedule.ts` — the pure `buildReleaseSchedule(fixVersions, window)` (filter/sort into `ReleaseSchedule`) **and** the thin `fetchPiWindowFixVersions(projectKey)` proxy read that feeds it, so US1's engine has PROD/Due dates from the start. (The monthly-suggestion half is US5.) Make T007 green. **[F1: the version fetch is Foundational, not US5 — the MVP needs it.]**
- [x] T009 [P] Write failing tests `client/src/views/ArtView/piPlan/piPlanCapacity.test.ts` for the roster→capacity adapter: `roleCapabilities {canDevelop,canInternalTest,canExternalTest}` → `DeliveryRole[]`; per-person `pointsPerSprint` derived **per the research R1 formula** (`recommendedCapacityPoints ÷ sprintsInPi ÷ activeMemberCount`, an explicit per-person capacity row winning when present).
- [x] T010 Implement the roster→`PersonCapacity[]` adapter in `client/src/views/ArtView/piPlan/piPlanCapacity.ts` (maps `useStandupRosterStore` members + `CapacitySummary` to the planner's `PersonCapacity`, using the research R1 per-person `pointsPerSprint` derivation). Make T009 green.
- [x] T011 [P] Implement field-id resolution helper `client/src/views/ArtView/piPlan/piPlanFields.ts` — thin wrapper over `loadHygieneFieldConfig`/`matchFieldIdsByName` returning `{ targetStart, targetEnd, due, featureLink, storyPoints, pi }` with the known defaults and `tbxARTSettings` overrides.

**Checkpoint**: Pure date engine, release read, capacity adapter, and field resolver exist and are unit-green. Planner engine can now be assembled.

---

## Phase 3: User Story 1 - Generate a rules-driven PI plan (Priority: P1) 🎯 MVP

**Goal**: From PI Review, generate a prompt with the full input set, ingest a `{kind:'piPlan'}` reply, present a per-item proposal (Stories + sub-tasks + assignee + sprint + dates), and — on accept — create the Story and its sub-tasks in Jira with dates/fixVersion/points/assignee and placement in an existing sprint.

**Independent Test**: With a team/PI + one sized Feature selected, generate a prompt (contains full input set), paste a well-formed reply, review the dated proposal, accept one Story → it and its sub-tasks are created in Jira with the stated dates.

### Tests for User Story 1 (write first, must FAIL)

- [x] T012 [P] [US1] Failing tests `client/src/views/ArtView/ai/piPlanAiAssist.test.ts`: prompt contains PI window + sprint calendar + roster+capabilities + per-sprint capacity + each Feature+size + release schedule + rule constants; parse of a well-formed reply → suggestions in Feature order; unknown `featureKey` → `rejected[]`; missing `sizePoints` → dropped + `unparsedCount++`; missing `kind`/empty → throws; any date field in the reply is ignored. Include the gating assertion (FR-051/SC-007): with `useAiAssistStore` locked, `PiPlanPanel` renders nothing (no prompt, no ingest).
- [x] T013 [P] [US1] Failing tests `client/src/views/ArtView/piPlan/piPlanBreakdown.test.ts`: 70/30 dev/test split rounds and preserves sum for odd sizes; a >13-pt or over-capacity story yields a warning (never silent oversize).
- [x] T014 [P] [US1] Failing tests `client/src/views/ArtView/piPlan/piPlanEngine.test.ts`: `buildPiPlanProposal` is deterministic (same input+`todayIso` ⇒ identical proposal); it composes `buildCapacityPlan` (mocked/real) and `computeItemDates`; honest states surface (unsized Feature, capability gap, PI over-commitment); no silent drops.
- [x] T015 [P] [US1] Failing tests `client/src/views/ArtView/piPlan/piPlanJira.test.ts` (mocked proxy): Story-create payload carries project + Story type + feature link; sub-task payload carries `parent.key` + Sub-task type; internal-test sub-task omitted when `hasTestableOutput=false`; dates written via `savePiReviewFeatureDates` with resolved field ids; `dryRun=true` ⇒ no proxy POST/PUT, payloads returned; a non-accepted item triggers zero writes.

### Implementation for User Story 1

- [x] T016 [P] [US1] Implement `client/src/views/ArtView/ai/piPlanAiAssist.ts` — `buildPiPlanAiPrompt(context)` + `parsePiPlanAiReply(reply, knownFeatureKeys)` (kind `piPlan`, `extractJsonPayload`, strict-per-key/lenient-per-field, ignores dates). Make T012 green.
- [x] T017 [P] [US1] Implement `client/src/views/ArtView/ai/piPlanAiFetch.ts` — assemble `PiPlanPromptContext` (FR-001–011 input set) from reused stores/reads; read-only, never mutates a row.
- [x] T018 [P] [US1] Implement `client/src/views/ArtView/ai/piPlanAiApply.ts` — pure `applyBreakdownSuggestion(feature, suggestion) → StorySuggestion[]` (passes size/testable through; attaches `matchExistingKey` placeholder — populated in US6).
- [x] T019 [US1] Implement `client/src/views/ArtView/piPlan/piPlanBreakdown.ts` — expand accepted `StorySuggestion[]` → planner `PlanItem[]` with the 70/30 split, the 13-pt/capacity warning, and the **Feature-priority → MoSCoW `bucket` + `rankInBucket` mapping per research R2a** (named constant, ART-settings overridable; committed ⇒ ≥ Should). Make T013 green. (depends on T004)
- [x] T020 [US1] Implement `client/src/views/ArtView/piPlan/piPlanEngine.ts` — `buildPiPlanProposal(input, todayIso)`: breakdown → `buildCapacityPlan` (REUSE) → `computeItemDates` → assemble `PlanProposal` with `honestStates`. Make T014 green. (depends on T006, T008, T010, T019)
- [x] T021 [US1] Implement `client/src/views/ArtView/piPlan/piPlanJira.ts` — `applyPlanItem(item, ctx)`: create Story (`createIssue`), set points/dates/fixVersion/assignee, assign to an **existing** sprint (`assignIssueToSprint`); create sub-tasks with `parent`; `dryRun` path; delegate every write to a reused primitive. Make T015 green. (sprint *creation* is US4)
- [x] T022 [US1] Implement `client/src/views/ArtView/piPlan/PlanProposalTable.tsx` — per-item accept/dismiss/override render of `PlanItemProposal[]` (Story + sub-tasks + assignee + sprint + dates + warnings); nothing writes on render.
- [x] T023 [US1] Implement `client/src/views/ArtView/piPlan/PiPlanPanel.tsx` — gated by `useAiAssistStore`; hosts `ReportAiPanel` (copy-prompt / paste-reply / optional ⚡ auto via `useAiAssistExchange`), runs the engine on ingest, renders `PlanProposalTable`, and wires per-item accept → `applyPlanItem`.
- [ ] T024 [US1] Mount `PiPlanPanel` additively on the PI Review surface (a new "Planner" tab/panel in `PoToolView`/`ArtView` beside PI Review) — default-off, no refactor of the host or the existing PI Review tabs; deep-link param optional.
- [x] T025 [US1] Add validation + honest empty states to the panel: empty scope ("nothing to plan"), unsized Feature, malformed reply remainder surfaced (never partial/garbage writes).

**Checkpoint**: US1 fully functional — generate → review dated proposal → accept → Jira issues created. MVP demoable with existing sprints.

---

## Phase 4: User Story 2 - Full capacity mapping (Priority: P1)

**Goal**: Show per-person/per-sprint committed-vs-available with over-allocation flags and roll-ups, driven by the same `PlanResult` as the schedule (agree-by-construction).

**Independent Test**: Given a proposal, the map shows committed vs available per person per sprint, flags over-allocation with the overage, totals equal the assigned work, and updates when a Story is reassigned.

### Tests for User Story 2 (write first, must FAIL)

- [x] T026 [P] [US2] Failing tests `client/src/views/ArtView/piPlan/PiPlanCapacityMap.test.tsx`: committed totals equal the sum of assigned work per person/sprint (reads `planResult.sprints[].loads`); an over-allocated cell is flagged with the overage; a PI-total row is present; reassigning a Story updates committed totals.

### Implementation for User Story 2

- [x] T027 [US2] Implement `client/src/views/ArtView/piPlan/PiPlanCapacityMap.tsx` — render per-person/per-sprint committed-vs-available from `PlanProposal.planResult.sprints[].loads` + the capacity adapter's available; flag over-allocation; per-sprint and PI-total roll-ups. Make T026 green. (depends on T020)
- [x] T028 [US2] Wire the capacity map into `PiPlanPanel` so it re-renders from the same `PlanProposal` whenever an item is accepted/dismissed/reassigned (single source; no second computation — FR-042).

**Checkpoint**: US1 + US2 = full MVP — dated proposal + trustworthy capacity map.

---

## Phase 5: User Story 3 - Deterministic date & deploy-cadence explainability (Priority: P2)

**Goal**: Surface, per issue, the five dates and a plain-language derivation, and prove they conform to the rules (Target End=code-in-INT ≤ PI end; REL=INT+5 working days; PROD on a release date; Due may exceed PI end).

**Independent Test**: For a Story with a known sprint + target release, the five derived dates match the rules exactly and each shows its derivation.

### Tests for User Story 3 (write first, must FAIL)

- [x] T029 [P] [US3] Failing tests `client/src/views/ArtView/piPlan/piPlanDates.explain.test.ts`: every `DatedItem.derivations[date]` names the rule + inputs; a Story whose INT would fall after PI end produces a warning while keeping `targetEndIso ≤ piEndIso` semantics; internal-test end is null (no gate) when `hasTestableOutput=false`.

### Implementation for User Story 3

- [x] T030 [US3] Add the per-date derivation display to `PlanProposalTable.tsx` (hover/expand showing `derivations`), and the external-test-start signal (internal-test end) per Story. Make T029 green. (extends T006/T022)
- [x] T031 [US3] Add the "code-in-INT after PI end" warning surfacing to the proposal + `honestStates`, keeping Target End within the PI (FR-036 boundary).

**Checkpoint**: Dates are explainable and provably rules-conformant (SC-005).

---

## Phase 6: User Story 4 - Sprint creation & assignment (Priority: P2)

**Goal**: Ensure the PI's sprints exist — reuse existing board sprints, create only the derived-to-fill gaps once — and assign each accepted Story to its sprint.

**Independent Test**: For a PI whose sprints partially exist, existing sprints are reused, missing sprints created once, each accepted Story assigned to the right sprint + assignee.

### Tests for User Story 4 (write first, must FAIL)

- [x] T032 [P] [US4] Failing tests `client/src/views/ArtView/piPlan/piPlanSprints.test.ts` (mocked proxy): existing sprint (from `getBoardSprints`) is reused — no `createSprint`; a missing (derived-to-fill) sprint is created exactly once; a Story is assigned via `assignIssueToSprint`; re-run does not re-create an existing sprint.

### Implementation for User Story 4

- [x] T033 [US4] Implement `client/src/views/ArtView/piPlan/piPlanSprints.ts` — `ensureSprints(plan, ctx)`: read existing via `getBoardSprints`, match by name, `createSprint` only for gaps (derive-to-fill from PI start + configured length), return name→id map. Make T032 green.
- [x] T034 [US4] Wire `ensureSprints` into `piPlanJira.applyPlanItem` so accepted Stories place into the correct (existing or newly-created) sprint; emit `sprintCreate` proposals in the engine for derived sprints.

**Checkpoint**: Full sprint lifecycle handled without duplicates.

---

## Phase 7: User Story 5 - Release schedule awareness & suggestions (Priority: P3)

**Goal**: Use PI-window fixVersions as the PROD calendar; when the timeline needs a release that doesn't exist, suggest a monthly-cadence release (accept-required); report an empty release schedule honestly.

**Independent Test**: Two fixVersions + a Story needing a third → the two are used and a third monthly release is proposed as an acceptable suggestion; no releases in window → empty-schedule report + monthly proposal.

### Tests for User Story 5 (write first, must FAIL)

- [x] T035 [P] [US5] Failing tests extending `piPlanReleaseSchedule.test.ts`: a PROD date with no release on/after it yields an `isSuggested` release at **`rollToWorkingDay(max(REL, previousReleaseDate + 28 days))` per research R4**; releases never closer than ~4 weeks; empty window → honest empty + first suggestion anchored at the PI start; determinism.

### Implementation for User Story 5

- [x] T036 [US5] Implement the SUGGESTION half of `client/src/views/ArtView/piPlan/piPlanReleaseSchedule.ts` — deterministic monthly-cadence `isSuggested` entries per the **research R4 rule** (≥ REL and ≥ 28 days after the previous release, rolled to a working day; named `"<PI> Suggested Release <n>"`). Make T035 green. (extends T008)
- [ ] T037 [US5] Surface `releaseSuggest` proposals + the empty-schedule honest state in `PiPlanPanel`, with per-item accept for a suggested release. (The version *fetch* now lives in Foundational T008 — this task consumes it.)

**Checkpoint**: Release awareness + monthly suggestions live.

---

## Phase 8: User Story 6 - Idempotent re-planning (Priority: P3)

**Goal**: Re-running recognizes a Feature's existing Stories/sub-tasks and never duplicates them.

**Independent Test**: A Feature with an existing Story + sub-tasks → re-run marks them `existing` and proposes only genuinely new items.

### Tests for User Story 6 (write first, must FAIL)

- [x] T038 [P] [US6] Failing tests `client/src/views/ArtView/piPlan/featureChildren.test.ts`: classifies children by issuetype + naming into `ExistingChild.kind`; an existing Story/sub-task ⇒ matched suggestion `status='existing'`; `applyPlanItem` on an `existing` item issues zero `createIssue` calls.

### Implementation for User Story 6

- [x] T039 [US6] Implement `client/src/views/ArtView/piPlan/featureChildren.ts` — `fetchFeatureChildren(featureKey)` reading child Stories + each Story's `subtasks`, classified into `ExistingChild[]`. Make the classification tests green.
- [x] T040 [US6] Wire idempotency matching into `piPlanAiApply`/`piPlanEngine` (populate `matchExistingKey`, set `PlanItemProposal.status='existing'`) and guard `applyPlanItem` to skip `existing` items. Make the no-duplicate tests green.

**Checkpoint**: Safe to re-run; no duplicates (SC-006).

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T041 [P] Update `CHANGELOG.md` with the PI Planning Automation entry (behavior change).
- [ ] T042 [P] Run the full client suite + type/lint: `cd client && npx vitest run` (new suites green), `npx tsc --noEmit`, `npx eslint`.
- [ ] T043 Regression gate: `cd client && npx vitest run src/views/FeatureCanvas/planner` and the PI Review host suites — all must remain green (no reused-surface regression).
- [ ] T044 Record the Framework-First drift justifications as one-line comments at each new module head (`piPlanDates.ts`, `piPlanReleaseSchedule.ts`, `piPlanJira.ts` create-flow, `featureChildren.ts`, `ai/piPlanAiAssist.ts`).
- [ ] T045 Execute `quickstart.md` — unit + integration (mocked proxy) + the live-Jira steps 2–8; capture created keys + populated dates as Article X evidence.

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)** → no deps.
- **Foundational (P2)** → blocks ALL stories (types, date engine, release read, capacity adapter, field resolver).
- **US1 (P3 phase)** → needs Foundational; is the MVP core and the write flow other stories extend.
- **US2** → needs US1's engine output (`PlanProposal.planResult`).
- **US3** → needs Foundational date engine + US1 proposal UI (extends it).
- **US4** → extends US1's `piPlanJira` (adds sprint creation).
- **US5** → extends Foundational release read (adds suggestion) + US1 panel.
- **US6** → extends US1's apply/engine (adds child-read + idempotency).
- **Polish (P9)** → after all desired stories.

### Within a story
- Tests (T0xx `.test.*`) written first and FAIL, then implementation makes them green (TDD).
- Pure modules before the engine; engine before UI; UI before the additive mount.

### Parallel opportunities
- Setup: T002, T003 in parallel.
- Foundational: T004/T005/T007/T009 in parallel (distinct files); implementations follow their own tests.
- US1 tests T012–T015 all [P]; implementations T016/T017/T018 [P] (distinct files) before T019→T020→T021 (ordered by dependency).
- Different stories can proceed in parallel once Foundational is done, coordinating only on the shared `piPlanJira.ts` (US1/US4) and `piPlanReleaseSchedule.ts` (Foundational/US5) — sequence edits to those two files.

## Parallel Example: User Story 1

```bash
# Write these failing tests together (distinct files):
Task: "AI parse/prompt tests in client/src/views/ArtView/ai/piPlanAiAssist.test.ts"
Task: "Breakdown split tests in client/src/views/ArtView/piPlan/piPlanBreakdown.test.ts"
Task: "Engine determinism tests in client/src/views/ArtView/piPlan/piPlanEngine.test.ts"
Task: "Jira write-payload tests in client/src/views/ArtView/piPlan/piPlanJira.test.ts"

# Then implement the independent pure modules together:
Task: "piPlanAiAssist.ts"   Task: "piPlanAiFetch.ts"   Task: "piPlanAiApply.ts"
```

## Implementation Strategy

### MVP first (US1 + US2 — both P1)
1. Phase 1 Setup → Phase 2 Foundational (CRITICAL, blocks all).
2. Phase 3 US1 → generate → review dated proposal → accept → Jira create (existing sprints).
3. Phase 4 US2 → capacity map from the same `PlanResult`.
4. **STOP & VALIDATE** against quickstart steps 2–8; demo.

### Incremental delivery
US3 (date explainability) → US4 (sprint creation) → US5 (release suggestions) → US6 (idempotency), each independently testable and additive, each keeping the reused suites green.

## Notes
- [P] = different files, no incomplete-task dependency.
- Verify each test fails before implementing it.
- Commit after each task or logical group; never commit to `main`; release via `scripts/local-release.ps1` only.
- The two shared-edit files are `piPlanJira.ts` (US1+US4) and `piPlanReleaseSchedule.ts` (Foundational+US5) — sequence those edits.
