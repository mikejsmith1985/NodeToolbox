# Tasks: Delivery Forecast

**Input**: Design documents from `/specs/036-delivery-forecast/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/` (7 files), `quickstart.md`

**Tests**: **REQUIRED.** Constitution Article V mandates TDD (red → green → refactor), and the pre-commit hook blocks
any commit adding a source file without a sibling test file. Every implementation task below is preceded by its
failing-test task.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable — different file, no dependency on an incomplete task
- **[Story]**: `[US1]`–`[US8]`, mapping to the spec's user stories
- Every task names an exact file path

## Path Conventions

Client-only feature in an existing React SPA. All paths are relative to the repository root.
Engine lives at `client/src/views/SprintDashboard/forecast/`; the one cross-cutting piece is
`client/src/utils/workingDays.ts`.

---

## ⛔ The four frozen guards

These files' tests must show **zero modified lines** at every checkpoint. Verify with
`git diff --stat` before each commit. If one needs editing, this feature changed behaviour it promised not to —
revert the change, never adjust the test.

| Guard | File | Proves |
|---|---|---|
| **G1** | `client/src/utils/workflowDelivery.test.ts` | "Delivered = Ready for QA" unchanged (FR-018, SC-006) |
| **G2** | `client/src/views/ArtView/piPlan/piPlanDates.test.ts` | The relocation preserved behaviour (Drift 1) |
| **G3** | `client/src/views/Hygiene/checks/issueDateRules.test.ts` | The Target Start revision is additive (Drift 2) — additions only, never modifications |
| **G4** | `client/src/services/fieldMappingBoundary.test.ts` | No new file names a `customfield_*` id (FR-044) |

**The one existing test that legitimately changes**: `defaultBoardColumns.test.ts` (T053), because the shipped default
genuinely gains a column.

---

## Phase 1: Setup

**Purpose**: Get onto a valid branch and open the CHANGELOG entry the pre-commit hook requires.

- [X] T001 Create branch `feature/036-delivery-forecast` from `origin/main` (NOT from the current `forge/wt-*` worktree branch, which is stale versus main and rejected by the pre-commit hook)
- [X] T002 Add an `## [Unreleased]` entry to `CHANGELOG.md` describing the Delivery Forecast feature
- [X] T003 Run `cd client && npm test` and record the baseline green result, so any later red is unambiguously caused by this feature

**Checkpoint**: Valid branch, baseline recorded.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared types, the calendar, the settings, and the parts of the engine every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase completes. `forecastCompose.ts` (T029–T030) is a
**shared file** that later stories extend — those extensions are sequential, and each is called out in its story.

### Shared types

- [X] T004 [P] Write failing type-level tests for every entity in `data-model.md` in `client/src/views/SprintDashboard/forecast/forecastTypes.test.ts` (follow the existing `rollupBoard/rollupBoardTypes.test.ts` precedent)
- [X] T005 Create `client/src/views/SprintDashboard/forecast/forecastTypes.ts` declaring `ForecastConfig`, `RejectedSetting`, `RemainingEffort`, `ForecastWindow`, `ReleaseClock`, `PiClock`, `ReleaseDateResolution`, `IssueForecastState`, `IssueForecast`, `CapacityPerson`, `CapacityItem`, `PersonLoad`, `CapacityAssessment`, `IntReadyState`, `ChainRole`, `ChainItem`, `ChainSchedule`, `FeatureDodAssessment`, `FeatureSizingFlag`, `ForecastCompleteness`, `ForecastResult` per `data-model.md`. Declare **no** Jira field id anywhere (FR-044)

### Working-day calendar (Drift 1)

- [X] T006 [P] Write failing tests for `subtractWorkingDays` (6 cases from `contracts/effort-and-windows.md` §1, including the add/subtract round-trip) in `client/src/utils/workingDays.test.ts`
- [X] T007 Create `client/src/utils/workingDays.ts` by **relocating** `WorkingCalendar`, `isWorkingDay`, `rollToWorkingDay`, `addWorkingDays` and `workingDaysBetween` from `client/src/views/ArtView/piPlan/piPlanDates.ts`, and add `subtractWorkingDays` as the mirror of `addWorkingDays`
- [X] T008 Change `client/src/views/ArtView/piPlan/piPlanDates.ts` to re-export all five primitives from `client/src/utils/workingDays.ts`, and re-export `WorkingCalendar` from `piPlanTypes.ts`, so no PI-planner import path changes
- [X] T009 **Verify guard G2**: run `npx vitest run src/views/ArtView/piPlan/piPlanDates.test.ts` and confirm `git diff --stat` on that test file shows zero lines. If it needs editing, revert T007–T008

### ART settings

- [X] T010 [P] Write failing tests for `pointsPerWorkingDay`, `holidayIsoDates` and `featureSizingTolerancePercent` defaulting and coercion, appended to `client/src/services/artSettingsStore.test.ts`
- [X] T011 Add the three members to `ArtSettings`, `DEFAULT_ART_SETTINGS` (`1`, `[]`, `0`) and `readArtSettings` in `client/src/services/artSettingsStore.ts`. Do **NOT** touch `SharedArtWorkspaceSettingsRecord` in `client/src/services/confluenceApi.ts` — a schema bump makes `loadSharedArtWorkspace` hard-reject the whole workspace on older clients
- [X] T012 [P] Write failing tests for the three new Admin Hub inputs in `client/src/views/AdminHub/AdminHubView.test.tsx`
- [X] T013 Add the three inputs to the ART settings section of `client/src/views/AdminHub/AdminHubView.tsx` using that panel's existing class vocabulary (`panelCard`, `fieldLabel`, `inputField`, `panelStatusLine`); holidays entered as a comma/newline list of `YYYY-MM-DD` days, with rejected entries reported in `panelStatusLine` rather than dropped

### Configuration

- [X] T014 [P] Write failing tests for `buildForecastConfig` (7 cases from `contracts/effort-and-windows.md` §2) in `client/src/views/SprintDashboard/forecast/forecastSettings.test.ts`
- [X] T015 Implement `buildForecastConfig` in `client/src/views/SprintDashboard/forecast/forecastSettings.ts`, taking a structural `ArtSettingsLike` and an injected `todayIso`; an invalid value falls back to its default **and** appends a `RejectedSetting` — never silently corrected

### Effort

- [X] T016 [P] Write failing tests for `computeRemainingEffort` (10 cases from `contracts/effort-and-windows.md` §3) in `client/src/views/SprintDashboard/forecast/effortModel.test.ts`
- [X] T017 Implement `computeRemainingEffort` in `client/src/views/SprintDashboard/forecast/effortModel.ts`, importing `readColumnCredit` from `../rollupBoard/featureProgress.ts` (never reimplementing it), flooring unfinished estimated work at 1 working day, and always populating `basis`

### Windows

- [X] T018 [P] Write failing tests for `buildReleaseClock` and `buildPiClock` (10 cases from `contracts/effort-and-windows.md` §4, **including the no-gap/no-overlap tiling assertion**) in `client/src/views/SprintDashboard/forecast/forecastWindows.test.ts`
- [X] T019 Implement `buildReleaseClock` and `buildPiClock` in `client/src/views/SprintDashboard/forecast/forecastWindows.ts`; import the 21-day code-freeze lead from the date policy rather than redeclaring it (FR-007), and return `hasPassed` with a zero count rather than a negative window

### Release dates

- [X] T020 [P] Write failing tests for `parseReleaseDateFromName` (17 cases) and `resolveReleaseDate` (8 cases) from `contracts/release-date-resolve.md` in `client/src/views/SprintDashboard/forecast/releaseDateResolve.test.ts`
- [X] T021 Implement `parseReleaseDateFromName`, `resolveReleaseDate` and `resolveReleaseDates` in `client/src/views/SprintDashboard/forecast/releaseDateResolve.ts`; accept `/` only (never `-`, which would read `2026-08-20` as month 2026), reject non-calendar days, and always let the field win while flagging disagreement

### Sub-status availability

- [X] T022 Add `...fieldConfig.subStatusFieldIds` to `buildRequestedHygieneFields` in `client/src/views/Hygiene/hooks/hygieneScan.ts` — the field is already discovered by `loadHygieneFieldConfig` and simply never requested
- [X] T023 Run `npx vitest run src/views/Hygiene/hooks/hygieneScan.test.ts` and confirm it passes unmodified

### Composition root

- [X] T024 [P] Write failing tests for `computeForecast` covering config, clocks, release-date resolutions, per-issue effort and `ForecastCompleteness` in `client/src/views/SprintDashboard/forecast/forecastCompose.test.ts`
- [X] T025 Implement `computeForecast(input: ForecastInput, config: ForecastConfig): ForecastResult` in `client/src/views/SprintDashboard/forecast/forecastCompose.ts`, populating `config`, `rejectedSettings`, `piClock`, `releaseClocksByVersionName`, `releaseDateResolutions` and `completeness`; leave `issueForecasts`, `featureAssessments`, `sizingFlags` and both capacity maps as empty defaults that later stories fill. This is the **only** exported entry point (FR-043)

### Foundation checkpoint

- [X] T026 **Verify guard G4**: run `npx vitest run src/services/fieldMappingBoundary.test.ts` and confirm no new forecast file names a `customfield_*` id
- [X] T027 Run `cd client && npm test` — green — and commit with the CHANGELOG entry in the same commit

**Checkpoint**: Engine foundation ready. User stories can now proceed; US1, US4/US5, US2, US6 and US8 engine work is parallel-safe.

---

## Phase 3: User Story 1 — Tell a team what has to start today (Priority: P1) 🎯 MVP

**Goal**: A Scrum Master opens Today and sees, across every saved team, exactly which issues must start today.

**Independent test**: With two saved Dashboard Team profiles, the Today tab lists issues from both, each in exactly one
state, with the completeness line naming unsized/unassigned/undated counts. Verifiable with the quickstart's fixed
`todayIso` of 2026-08-20 and no live Jira.

- [X] T028 [P] [US1] Write failing tests for `computeIssueForecast` (18 cases from `contracts/issue-forecast.md` §1, covering the full state precedence) in `client/src/views/SprintDashboard/forecast/issueForecast.test.ts`
- [X] T029 [US1] Implement `computeIssueForecast` and `computeIssueForecasts` in `client/src/views/SprintDashboard/forecast/issueForecast.ts`: driving deadline = the earlier of release and PI (tie → release), `latestStartIso = subtractWorkingDays(deadline, days − 1)`, the eight-state precedence with `unsized` first and `cannot-fit` above `behind`, `slackWorkingDays`, `hasStoredDateDisagreement`, and an always-populated `reason`
- [X] T030 [US1] Populate `issueForecasts` in `client/src/views/SprintDashboard/forecast/forecastCompose.ts` (shared file — sequential)
- [ ] T031 [P] [US1] Write failing tests for the new `forecast` field, per-team `loadTeamVocabulary` lookup and injected `todayIso` in `client/src/views/MyIssues/Today/hooks/useTodayDashboard.test.ts`
- [ ] T032 [US1] Add the additive `forecast: ForecastResult | null` field to `TodayDashboardData` in `client/src/views/MyIssues/Today/hooks/useTodayDashboard.ts`, computed over the issues the **existing** team scan already returned (zero new Jira requests), attributing each result to its `teamProfileId`, and loading each team's column order via `boardVocabularyStore.loadTeamVocabulary`
- [ ] T033 [P] [US1] Write failing tests for grouping, per-row content, team labelling, the completeness line and the empty state in `client/src/views/MyIssues/Today/ForecastSection.test.tsx`
- [ ] T034 [US1] Create `client/src/views/MyIssues/Today/ForecastSection.tsx` and `ForecastSection.module.css`: groups ordered behind/start-today → cannot-fit → ahead → on-track, with unsized, unassignable and unforecastable in their own labelled groups; each row shows key (deep link), summary, team, assignee, latest start, slack and reason; reuse the `TodayDashboard.module.css` vocabulary
- [ ] T035 [US1] Render `<ForecastSection>` beneath the category cards and above `SprintFlowSnapshot` in `client/src/views/MyIssues/Today/TodayDashboard.tsx`
- [ ] T036 [US1] Confirm every existing assertion in `useTodayDashboard.test.ts` and `TodayDashboard.test.tsx` passes unmodified, then commit with a CHANGELOG entry

**Checkpoint**: **MVP delivered.** US1 is usable on its own — the Today tab answers "what must start today" across both teams.

---

## Phase 4: User Story 1 (continued) — Target Start revision (Priority: P1)

**Goal**: Jira's Target Start becomes the latest day work can start and still land, written through the existing bulk
date fix. Drift 2 — additive only.

**Independent test**: An estimated, unstarted issue's Target Start equals `code freeze − (remaining working days − 1)`;
an issue already in `Working` keeps its actual start date.

- [ ] T037 [P] [US1] **Append** failing tests (10 cases from `contracts/issue-forecast.md` §2) to `client/src/views/Hygiene/checks/issueDateRules.test.ts` — append only, never modify an existing assertion
- [ ] T038 [US1] Add optional `remainingEffortWorkingDays`, `piDodDeadlineIso` and `workingCalendar` to `IssueDateInput`, add `targetStartBasis` to `DerivedIssueDates`, and insert the back-calculation as precedence step 2 in `deriveIssueDates` in `client/src/views/Hygiene/checks/issueDateRules.ts`. All three optional; absent, the output is today's output exactly
- [ ] T039 [US1] **Verify guard G3**: `git diff --stat` on `issueDateRules.test.ts` shows additions only, zero modifications
- [ ] T040 [P] [US1] Write failing tests for the optional `DerivedDateContext` parameter (5 cases from `contracts/issue-forecast.md` §3) in `client/src/views/Hygiene/derivedDateFix.test.ts`
- [ ] T041 [US1] Add the optional `context?: DerivedDateContext` parameter to `planDerivedDateWrites` and `applyDerivedDates` in `client/src/views/Hygiene/derivedDateFix.ts`, passing effort through by issue key and keeping the single changelog request per issue
- [ ] T042 [US1] Pass the forecast context from the bulk date-fix callers in `client/src/views/SprintDashboard/FeatureReviewTab.tsx` and `client/src/views/Hygiene/HygieneView.tsx`, and report the Target Start basis split (e.g. "12 back-calculated from effort, 4 from Ready to Work") in the outcome message
- [ ] T043 [US1] Run the full client suite, confirm G3 still holds, and commit with a CHANGELOG entry

**Checkpoint**: Jira now holds the revised Target Start, and Today, Hygiene and Feature Review agree about what it should be.

---

## Phase 5: User Stories 4 & 5 — Feature PI DoD and the DEV→SL chain (Priority: P1)

**Goal**: Every Feature on the Roll-Up Board reports whether it can reach `Ready for Testing` / `Integration Test`
before PI end, understanding that SL testing follows dev completion.

**Independent test**: A Feature whose every non-cancelled child is INT-ready reads `int-ready`; one with a child in
Working names that child; one whose dev fits the PI but whose SL does not reports `test-squeeze`.

- [ ] T044 [P] [US4] Write failing tests for `readIntReadyState`, `isInternalTestReady` and `rollUpFeatureIntReadiness` (13 cases from `contracts/int-readiness-and-chain.md` §1, **including the zero-children case**) in `client/src/views/SprintDashboard/forecast/intReadiness.test.ts`
- [ ] T045 [US4] Implement `client/src/views/SprintDashboard/forecast/intReadiness.ts`, importing `INTERNAL_TESTING_STATUS_NAME` from `client/src/utils/workflowDelivery.ts` **without modifying that file**; zero children returns `not-int-ready`, never `int-ready` by vacuum; a missing sub-status field returns `unknown-sub-status` rather than a guess
- [ ] T046 [P] [US5] Write failing tests for `classifyChainRole` and `scheduleDevSlChain` (15 cases from `contracts/int-readiness-and-chain.md` §2) in `client/src/views/SprintDashboard/forecast/devSlChain.test.ts`
- [ ] T047 [US5] Implement `client/src/views/SprintDashboard/forecast/devSlChain.ts`: `[SL]`/`[DEV]` prefix first (anchored, bracket-delimited, case-insensitive), roster `canInternalTest` second, `unclassified` last and scheduled as dev; dev effort summed; SL starts the working day after dev completion; SL effort summed; no SL story reported rather than treated as zero
- [ ] T048 [US4] Populate `featureAssessments` in `client/src/views/SprintDashboard/forecast/forecastCompose.ts`, computing `riskCause` as `dev-too-large` when dev alone overruns PI end, `test-squeeze` when only the DoD date does (shared file — sequential)
- [ ] T049 [P] [US4] Write failing tests for the optional third parameter and the two new tiles in `client/src/views/SprintDashboard/rollupBoard/laneVitals.test.ts`
- [ ] T050 [US4] Add the optional `forecast?: FeatureDodAssessment | null` third parameter to `buildLaneVitalTiles` in `client/src/views/SprintDashboard/rollupBoard/laneVitals.ts`, appending the `pi-dod` and `dod-date` tiles after the existing five; omitted ⇒ the existing five, byte-identical; text always states the verdict so colour is never the only cue
- [ ] T051 [P] [US4] Write failing tests for the optional `forecast` prop and its seven badge states in `client/src/views/SprintDashboard/rollupBoard/components/ChildCard.test.tsx`
- [ ] T052 [US4] Add the optional `forecast?: IssueForecast | null` prop and its badge to `client/src/views/SprintDashboard/rollupBoard/components/ChildCard.tsx`; `on-track` and `unforecastable` draw no badge
- [ ] T053 [US4] Render the two new tiles in `client/src/views/SprintDashboard/rollupBoard/components/MasterCardLane.tsx`, keeping the release and PI verdicts as **separate** tiles (FR-014)
- [ ] T054 [US4] Add one `useMemo` calling `computeForecast` over the already-fetched issue set in `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.tsx` and pass the result to `MasterCardLane` and `ChildCard`. **No function moved, renamed or extracted** — this file is 2,694 lines and is not refactored
- [ ] T055 [US4] Add `['Internal Test Ready', 'Ready for Testing', null]` after Code Review in `client/src/views/SprintDashboard/rollupBoard/defaultBoardColumns.ts`, and update `defaultBoardColumns.test.ts` to expect twelve columns — the one existing test this feature legitimately changes
- [ ] T056 [US4] **Verify guard G1**: `git diff --stat` on `client/src/utils/workflowDelivery.test.ts` shows zero lines, and the suite passes
- [ ] T057 [US4] Run the full client suite and commit with a CHANGELOG entry

**Checkpoint**: The board now answers the PI question it could not see at all before, beside the release question it already showed.

---

## Phase 6: User Story 2 — Can this release be built in the time left (Priority: P1)

**Goal**: A new Forecast tab shows, for a chosen fix version, the working days to code freeze, the per-person load,
and whether scope must come out.

**Independent test**: 14 working days to code freeze and a person holding 18 remaining points at rate 1.0 reports them
over capacity by 4 days; a release short on capacity raises the scope-removal flag with the exact points.

- [ ] T058 [P] [US2] Write failing tests for `assessCapacity` (16 cases from `contracts/capacity-load.md`) in `client/src/views/SprintDashboard/forecast/capacityLoad.test.ts`
- [ ] T059 [US2] Implement `assessCapacity` in `client/src/views/SprintDashboard/forecast/capacityLoad.ts`: full availability per person, in-scope versus total load kept separate, unassigned effort summed and named but never pooled, `totalAvailableWorkingDays` counting only people who hold in-scope work, a passed window zeroing availability, and deterministic sort order
- [ ] T060 [US2] Populate `codeFreezeCapacityByVersionName` in `client/src/views/SprintDashboard/forecast/forecastCompose.ts` using `roleFilter: 'dev'` over `releaseClock.toCodeFreeze` (shared file — sequential)
- [ ] T061 [US2] Add `'forecast'` to the `DashboardTab` union in `client/src/views/SprintDashboard/hooks/useSprintData.ts`
- [ ] T062 [P] [US2] Write failing tests for the version picker, release-clock display and capacity table in `client/src/views/SprintDashboard/forecast/ForecastTab.test.tsx`
- [ ] T063 [US2] Create `client/src/views/SprintDashboard/forecast/ForecastTab.tsx` and `ForecastTab.module.css`: a `<select>` version picker fed by `piPlanReleaseSchedule.fetchPiWindowFixVersions` (Jira's own list — never a text box), the four release-clock spans with their working-day counts, the code-freeze capacity table sorted most-over-capacity first, the scope-removal flag, `rejectedSettings` when non-empty, and the completeness line. Reuse `SprintDashboardView.module.css` class vocabulary
- [ ] T064 [US2] Add `{ key: 'forecast', label: 'Forecast' }` to `TAB_OPTIONS` and one `<ForecastTab>` mount beside the existing `RollupBoardTab` mount in `client/src/views/SprintDashboard/SprintDashboardView.tsx`. Change no other line; do **not** touch the inline `ReleasesTab`
- [ ] T065 [US2] Run the full client suite and commit with a CHANGELOG entry

**Checkpoint**: The release capacity question is answerable before code freeze, not at it.

---

## Phase 7: User Story 3 — Can external test absorb what is coming (Priority: P1)

**Goal**: The two weeks after code freeze are assessed against the test effort bound for that release, naming both
remedies.

**Independent test**: Test effort exceeding the testers' capacity in the 14-day window raises a flag naming reduce-scope
and add-test-resource with the shortfall; the final week credits no test capacity.

- [ ] T066 [US3] Populate `externalTestCapacityByVersionName` in `client/src/views/SprintDashboard/forecast/forecastCompose.ts` using `roleFilter: 'test'` over `releaseClock.externalTest`, and assert the deploy-buffer window is never used for capacity (shared file — sequential)
- [ ] T067 [P] [US3] Write failing tests for the external-test section, the two named remedies and the zero-capacity deploy buffer in `client/src/views/SprintDashboard/forecast/ForecastTab.test.tsx`
- [ ] T068 [US3] Add the external-test capacity section to `client/src/views/SprintDashboard/forecast/ForecastTab.tsx`, showing the tester load table, the shortfall, both remedies stated explicitly, and the deploy buffer labelled as carrying no test capacity
- [ ] T069 [US3] Run the full client suite and commit with a CHANGELOG entry

**Checkpoint**: Both halves of the release clock are now visible and separately actionable.

---

## Phase 8: User Story 6 — Catch a Feature that was sized wrong (Priority: P2)

**Goal**: A Feature whose children have outgrown its estimate is flagged with the overage in points and percent.

**Independent test**: A Feature estimated at 20 whose children total 34 flags at 14 points / 70%; sub-task points are
excluded; an unsized Feature reads "not sized", never over-size.

- [ ] T070 [P] [US6] Write failing tests for `assessFeatureSizing` (10 cases from `contracts/int-readiness-and-chain.md` §3) in `client/src/views/SprintDashboard/forecast/featureSizing.test.ts`
- [ ] T071 [US6] Implement `assessFeatureSizing` in `client/src/views/SprintDashboard/forecast/featureSizing.ts`, counting stories, defects and tasks but **excluding sub-tasks**, guarding a zero-point Feature against an infinite percentage, and leaving `piPlanCapacityFlags.detectDefectUndersize` untouched
- [ ] T072 [US6] Populate `sizingFlags` in `client/src/views/SprintDashboard/forecast/forecastCompose.ts` using the configured tolerance (shared file — sequential)
- [ ] T073 [US6] Add the sizing section to `client/src/views/SprintDashboard/forecast/ForecastTab.tsx`, listing over-size and not-sized Features with the overage in both points and percent
- [ ] T074 [US6] Run the full client suite and commit with a CHANGELOG entry

---

## Phase 9: User Story 7 — Read a release date the version does not state cleanly (Priority: P2)

**Goal**: A version whose date lives only in its name is forecast correctly; a field/name disagreement is reported;
an undated version makes its issues unforecastable rather than on-track.

**Independent test**: `Release 08/20/2026` with no field resolves to 2026-08-20; with a field of 2026-09-01 the field
wins and the disagreement is flagged; `Sprint 5` yields no date and its issues read `unforecastable`.

- [ ] T075 [US7] Add the release-date resolution section to `client/src/views/SprintDashboard/forecast/ForecastTab.tsx`, listing **only** rows with `hasDisagreement`, `hasAmbiguousName`, or `source: 'none'` — a clean resolution needs no row
- [ ] T076 [P] [US7] Write an end-to-end test in `client/src/views/SprintDashboard/forecast/forecastCompose.test.ts` proving an issue whose only fix version is undated resolves to `unforecastable`, never `on-track`, and increments `completeness.undatedVersionCount`
- [ ] T077 [US7] Run the full client suite and commit with a CHANGELOG entry

---

## Phase 10: User Story 8 — Turn the numbers into something a team can be told (Priority: P3)

**Goal**: Three gated, propose-only narratives. The AI writes prose; it structurally cannot change a number.

**Independent test**: A reply naming an unsupplied issue key is rejected and the key named; a reply containing
`"days": 14` is rejected as an unexpected property; locking AI Assist removes the panel entirely.

- [ ] T078 [P] [US8] Write failing tests for the three prompt builders (6 cases from `contracts/forecast-ai.md` §6) in `client/src/views/SprintDashboard/forecast/ai/forecastAiAssist.test.ts`
- [ ] T079 [US8] Implement `buildForecastDailyPrompt`, `buildScopeCutPrompt` and `buildTestCapacityPrompt` in `client/src/views/SprintDashboard/forecast/ai/forecastAiAssist.ts` as pure functions over `ForecastResult`; every figure verbatim, every legal issue key and person key named, the do-not-invent instruction present, deterministic output, and no AI-attribution phrasing requested
- [ ] T080 [P] [US8] Write failing tests for `parseForecastAiReply` (12 cases, including the `"days": 14` unexpected-property rejection) appended to `forecastAiAssist.test.ts`
- [ ] T081 [US8] Implement `parseForecastAiReply` in the same file, using `utils/extractJsonPayload.ts`; the item schema carries `id`, `headline`, `narrative`, `issueKeys` and `personKeys` and **no numeric field at all**, so any numeric property is an unexpected property and the item is rejected and named
- [ ] T082 [P] [US8] Write failing tests for the locked/unlocked render, ingest error handling and per-item accept in `client/src/views/SprintDashboard/forecast/ai/ForecastAiPanel.test.tsx`
- [ ] T083 [US8] Create `client/src/views/SprintDashboard/forecast/ai/ForecastAiPanel.tsx` as a thin wrapper over `ReportsHub/ReportAiPanel.tsx` — adding no gate of its own, keeping the default "writes nothing to Jira" hint (which is accurate here), and holding per-item accept/decline state
- [ ] T084 [US8] Mount `<ForecastAiPanel>` at the foot of `client/src/views/SprintDashboard/forecast/ForecastTab.tsx`
- [ ] T085 [US8] Run the full client suite and commit with a CHANGELOG entry

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T086 [P] Confirm the completeness line ("N unsized · N unassigned · N undated") renders beside every total on all three surfaces (SC-012)
- [ ] T087 [P] Confirm `rejectedSettings` renders wherever a forecast is shown, so a bad setting is visible rather than silently corrected
- [ ] T088 [P] Audit the new UI against the GH #160 zoom rules and confirm no `width: calc(100%/zoom)` was introduced
- [ ] T089 Confirm every new module's file header states its purpose and every exported function carries a doc comment (Article IV)
- [ ] T090 **Verify all four guards**: `git diff --stat` on `workflowDelivery.test.ts`, `piPlanDates.test.ts` shows zero lines; `issueDateRules.test.ts` shows additions only; `fieldMappingBoundary.test.ts` passes
- [ ] T091 Run the full regression sweep: `cd client && npm test`, `npm test` (server), `npm run test:dom`, `cd client && npx tsc -b` — all green
- [ ] T092 Work through `quickstart.md` offline tests 1–9 and record the results
- [ ] T093 Finalise the `CHANGELOG.md` entry describing the feature's user-visible behaviour
- [ ] T094 Live validation: `quickstart.md` tests 10–15 against production Jira, including **test 14 step 3** — remove the Internal Test Ready column and confirm the chain forecast is unchanged

---

## Dependencies

### Phase order

```
Phase 1 (Setup)
   ↓
Phase 2 (Foundational) ── BLOCKS EVERYTHING
   ↓
   ├── Phase 3 (US1 Today)  🎯 MVP
   │      ↓
   │   Phase 4 (US1 Target Start write)
   ├── Phase 5 (US4 + US5 board PI DoD)
   ├── Phase 6 (US2 release capacity) ─→ Phase 7 (US3 external test)
   ├── Phase 8 (US6 sizing)
   └── Phase 9 (US7 date reporting)
          ↓
       Phase 10 (US8 AI) ── needs a populated ForecastResult
          ↓
       Phase 11 (Polish)
```

### Story independence

| Story | Depends on | Independently testable? |
|---|---|---|
| US1 | Phase 2 | ✅ Yes — the MVP |
| US2 | Phase 2 | ✅ Yes |
| US3 | Phase 2 + US2's tab shell (T063) | ⚠️ Shares `ForecastTab.tsx` |
| US4 | Phase 2 | ✅ Yes |
| US5 | Phase 2; its surface rides US4's tiles | ✅ Engine yes; display via US4 |
| US6 | Phase 2 + US2's tab shell | ⚠️ Shares `ForecastTab.tsx` |
| US7 | Phase 2 + US2's tab shell | ⚠️ Shares `ForecastTab.tsx` |
| US8 | A populated `ForecastResult` | ❌ Last |

### The two shared files

Tasks touching these are **sequential**, never parallel:

| File | Tasks |
|---|---|
| `forecast/forecastCompose.ts` | T025 → T030 → T048 → T060 → T066 → T072 |
| `forecast/ForecastTab.tsx` | T063 → T068 → T073 → T075 → T084 |

---

## Parallel Execution

### Within Phase 2 — after T005 (types) lands

```
T006 ┐  workingDays tests
T010 ├─ artSettings tests
T014 ├─ forecastSettings tests
T016 ├─ effortModel tests
T018 ├─ forecastWindows tests
T020 ┘  releaseDateResolve tests
```

Six independent test files. Their implementations (T007, T011, T015, T017, T019, T021) are equally independent —
different files, no shared state.

### Across stories — after Phase 2 completes

Three disjoint file areas suit parallel worktree agents:

| Agent | Phase | Files |
|---|---|---|
| A | Phase 3 (US1) | `MyIssues/Today/*`, `forecast/issueForecast.ts` |
| B | Phase 5 (US4/US5) | `rollupBoard/*`, `forecast/intReadiness.ts`, `forecast/devSlChain.ts` |
| C | Phase 6 (US2) | `forecast/ForecastTab.tsx`, `forecast/capacityLoad.ts` |

Each must land its `forecastCompose.ts` edit sequentially — coordinate on that one file.

**Phase 4 must NOT run in parallel with Phase 3**: it edits `issueDateRules.ts`, which the Hygiene, Feature Review and
AI-prompt surfaces all read.

---

## Implementation Strategy

### MVP — stop here and it is still worth shipping

**Phases 1 + 2 + 3 (T001–T036)** deliver the sentence the whole feature exists to produce: *"if these issues don't
start today we will be behind"*, across both teams, on the Today tab. Nothing else is required for that to be true.

### Incremental delivery

| Increment | Phases | What it adds |
|---|---|---|
| 1 | 1–3 | Daily forecast on Today 🎯 |
| 2 | 4 | The revised Target Start written back to Jira |
| 3 | 5 | The PI clock on the Roll-Up Board |
| 4 | 6–7 | Release and external-test capacity |
| 5 | 8–9 | Sizing flags and date-resolution reporting |
| 6 | 10–11 | AI narratives and polish |

Each increment is independently valuable, and each ends on a green suite with a CHANGELOG entry.

### Task summary

| Phase | Tasks | Story |
|---|---|---|
| 1 Setup | T001–T003 | — |
| 2 Foundational | T004–T027 | — |
| 3 Today forecast | T028–T036 | US1 (P1) 🎯 |
| 4 Target Start | T037–T043 | US1 (P1) |
| 5 Board PI DoD + chain | T044–T057 | US4, US5 (P1) |
| 6 Release capacity | T058–T065 | US2 (P1) |
| 7 External test | T066–T069 | US3 (P1) |
| 8 Feature sizing | T070–T074 | US6 (P2) |
| 9 Date reporting | T075–T077 | US7 (P2) |
| 10 AI | T078–T085 | US8 (P3) |
| 11 Polish | T086–T094 | — |

**Total: 94 tasks.**
