---
description: "Task list for feature 033 — Feature Roll-Up Board"
---

# Tasks: Feature Roll-Up Board

**Input**: Design documents from `/specs/034-feature-rollup-board/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **REQUIRED, not optional.** Constitution Article V mandates TDD (red → green → refactor) and the repo's
pre-commit hook blocks any commit that adds a source file without a sibling test file. Every `*.test.ts(x)` task
below must be written and **failing** before its implementation task begins.

**Organization**: grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: the user story this serves (US1–US7)
- Every task names its exact file path

## Path Conventions

All paths are repository-relative. The feature lives under
`client/src/views/SprintDashboard/rollupBoard/`. Four shipped files receive **additive-only** edits; their existing
tests must pass **unmodified**, which is the proof the edit was additive.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: create the feature's home and make the surface reachable, so every later task has somewhere to land.

- [X] T001 Create `client/src/views/SprintDashboard/rollupBoard/rollupBoardTypes.ts` with the entity shapes from [data-model.md](./data-model.md) (`RollupBoardScope`, `RollupBoardIssueSet`, `LoadCompleteness`, `RollUpRoute`, `RollupBoardItem`, `MasterCard`, `FeatureProgress`, `BoardColumn`, `BoardVocabulary`, `ParentContainer`, `BoardLayout`, `QuickFilterState`, `BoardPreferences`) plus the named constants `UNMAPPED_COLUMN_ID`, `NO_FEATURE_KEY`, `EXPECTED_BOARD_ISSUE_CEILING = 300`, `SUBTASK_PARENT_CHUNK_SIZE = 50`, `FEATURE_KEY_CHUNK_SIZE = 50`
- [X] T002 [P] Create `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.module.css` reusing the class vocabulary of `client/src/views/SprintDashboard/SprintDashboardView.module.css` (panel, section title, field label, action button) — no invented styling
- [X] T003 Add `'rollupboard'` to the `DashboardTab` union in `client/src/views/SprintDashboard/hooks/useSprintData.ts` (additive union member only — no other change)
- [X] T004 Register the "Roll-Up Board" tab entry and mount a placeholder `RollupBoardTab` in `client/src/views/SprintDashboard/SprintDashboardView.tsx`, following the existing `featurereview` / `backlogremediation` tab pattern; create `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.tsx` and `RollupBoardTab.test.tsx` (test first: the tab renders and is reachable)

**Checkpoint**: the tab exists and is reachable from Agile Hub → Team.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shipped-file extensions and the two shared services every user story needs.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Shipped-file extensions (additive only)

- [X] T005 [P] Write failing tests in `client/src/views/Hygiene/checks/hygieneFieldConfig.test.ts` for the two new families: `subStatusFieldIds` discovered by the names `Sub-Status` / `Sub Status` / `Substatus`, and `flaggedFieldIds` by `Flagged` / `Impediment`; assert both resolve to `[]` when the instance has no such field (never to a hardcoded id)
- [X] T006 Add `subStatusFieldIds` and `flaggedFieldIds` to `resolveHygieneFieldConfig` / `HygieneFieldConfig` in `client/src/views/Hygiene/checks/hygieneChecks.ts` and to `loadHygieneFieldConfig` in `client/src/views/Hygiene/checks/hygieneFieldConfig.ts`, following the 021 Readiness configured-then-name-matched pattern (depends on T005)
- [X] T007 [P] Write failing tests in `client/src/views/SprintDashboard/featureReviewFixes.test.ts` asserting `fetchFeatureReviewTransitions` returns `screenFieldIds` containing **every** field on each transition screen (required and optional), while `requiredFields` is unchanged for existing callers
- [X] T008 Add the `screenFieldIds: string[]` member to `FeatureReviewTransition` and populate it in `fetchFeatureReviewTransitions` in `client/src/views/SprintDashboard/featureReviewFixes.ts` — purely additive, per [contracts/status-move.md](./contracts/status-move.md) §2 (depends on T007)
- [X] T009 [P] Write failing tests in `client/src/services/confluenceApi.test.ts` for `loadBoardVocabularyStore` / `saveBoardVocabularyStore`: an absent property reads as the empty store (never throws), a newer `schemaVersion` is refused, and saving one team leaves other teams byte-identical
- [X] T010 Implement `loadBoardVocabularyStore` / `saveBoardVocabularyStore` plus `BOARD_VOCABULARY_PROPERTY_KEY = 'nodetoolbox-board-vocabulary'` and `BOARD_VOCABULARY_SCHEMA_VERSION = 1` in `client/src/services/confluenceApi.ts`, mirroring the Jira template store (a **sibling** property — the ART workspace payload and its schema version must not be touched); record the Article VII drift justification as a comment at the new constants (depends on T009)

### Core shared modules

- [X] T011 [P] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/boardColumns.test.ts` covering every row of [contracts/column-vocabulary.md](./contracts/column-vocabulary.md) §1 and §2: exact pair match, status-only match when the instance has no sub-status field, **no nearest-guess** (a sub-status near-miss resolves to `Unmapped`), case-insensitive comparison, empty vocabulary ⇒ everything `Unmapped`, duplicate-mapping and duplicate-name refusal, and a null mapping being valid
- [X] T012 Implement `resolveColumnIdForItem` and `validateVocabulary` in `client/src/views/SprintDashboard/rollupBoard/boardColumns.ts` (depends on T011)
- [X] T013 Write failing tests in `client/src/views/SprintDashboard/rollupBoard/rollupBoardFetch.test.ts` covering [contracts/board-assembly.md](./contracts/board-assembly.md) §1: full paging to `total`, a failed board page being **fatal**, the chunked `parent in (…)` sub-task sweep, the chunked `key in (…)` feature sweep, a failed sub-task chunk surfacing in `LoadCompleteness.failures` rather than being swallowed, the sub-status field being omitted from the field list when its id is `''`, and 420 issues loading in full with `isOversized: true`
- [X] T014 Implement `rollupBoardFetch.ts` in `client/src/views/SprintDashboard/rollupBoard/` — three sweeps against `/rest/agile/1.0/board/{id}/issue` and `/rest/api/2/search`, reusing the chunking shape of `plannerFetch.fetchSubtasksForParents` but **reporting** chunk failures instead of swallowing them (depends on T001, T006, T013)

**Checkpoint**: field discovery, the transition screen ids, the vocabulary store, column resolution and the fetch layer are ready. User stories can begin.

---

## Phase 3: User Story 1 — Every item shows what it delivers (Priority: P1) 🎯 MVP

**Goal**: every issue on the team's board appears exactly once, under the Master Card of the Feature it delivers — including Features in other projects — and anything unattributable is collected in a visible **No Feature** card.

**Independent Test**: load a team board whose Features live in a separate project and which contains at least one unlinked issue. Total the child counts across all Master Cards including No Feature — it must equal the source board's issue count, with no duplicates.

### Tests for User Story 1 ⚠️

> Write these FIRST and confirm they FAIL.

- [X] T015 [P] [US1] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/defectRollup.test.ts` for every row of [contracts/board-assembly.md](./contracts/board-assembly.md) §3: the four precedence ranks in order, `dev-story` beating a competing `via-qa-issue` (with the loser retained in `unchosenCandidates`), the ascending-key tie-break between two same-rank candidates, the one-hop depth cap, loop termination emitting `link-loop-detected`, and no links ⇒ `featureKey: null`
- [X] T016 [P] [US1] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/featureRollup.test.ts` for §2: configured Feature Link field, Epic Link fallback, sub-task resolving through its parent, a sub-task whose parent is out of scope, nothing set ⇒ `null`, and a Feature in another project resolving identically (no project comparison anywhere)
- [X] T017 [P] [US1] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/masterCards.test.ts` for §4: one card per Feature, exactly one synthetic No Feature card only when something is unattributed, an unreadable Feature still producing a keyed card marked `isFeatureUnreadable`, a Feature with zero in-scope items producing **no** card, and the sum of `items` across all cards equalling the resolved item count (SC-001)

### Implementation for User Story 1

- [X] T018 [US1] Implement `resolveDefectRollup` in `client/src/views/SprintDashboard/rollupBoard/defectRollup.ts` — the FR-005 precedence chain with a `visited` set, the ascending-key tie-break, the one-hop cap, and a complete `unchosenCandidates` list (depends on T015)
- [X] T019 [US1] Implement `resolveFeatureRollup` in `client/src/views/SprintDashboard/rollupBoard/featureRollup.ts`, reusing `extractFeatureKeyFromIssueFields` from `client/src/utils/featureLink.ts` **unchanged** for the single hop and delegating defects to `defectRollup` (depends on T016, T018)
- [X] T020 [US1] Implement `buildMasterCards` in `client/src/views/SprintDashboard/rollupBoard/masterCards.ts` (depends on T017, T019)
- [X] T021 [US1] Wire the load pipeline into `RollupBoardTab.tsx`: read `boardId` and the team profile from the existing Sprint Dashboard state (never a second board picker), fetch, resolve, and render a lane list showing each Master Card's key, summary and child count, with the No Feature card marked as a hygiene problem and offering the same per-card actions
- [X] T022 [US1] Add the honest states to `RollupBoardTab.tsx` and `RollupBoardTab.test.tsx`: no board selected states so plainly (FR-052), an incomplete load names what is missing (FR-053), a still-loading board shows it is incomplete (FR-057), and an oversized board renders in full with a responsiveness warning (FR-056)

**Checkpoint**: US1 is fully functional. Quickstart V1, V2 and V3 pass. This is the MVP.

---

## Phase 4: User Story 3 — Roll-up that is impossible to misread (Priority: P1)

**Goal**: the swimlane board itself — shared columns, every item in the column of its own status, per-column parent containers, type colouring with non-colour labels, and family highlighting.

> **Why this phase precedes US2 despite equal priority**: US2's core action is *moving a card into a column*, which requires rendered columns to drop into. US3 builds them. With no vocabulary defined yet, every item resolves to `Unmapped` — which is the contract's stated behaviour and is independently testable, so US3 stands alone.

**Independent Test**: build a lane containing a Story whose sub-tasks are in two different statuses, a Defect linked to that Story, and a Defect linked directly to the Feature. Verify both columns draw their own container for the Story, the Story's own card appears childless in its own column, and every card is type-identifiable in greyscale.

### Tests for User Story 3 ⚠️

- [X] T023 [P] [US3] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/boardLayout.test.ts` for invariants **L-1 through L-9** in [contracts/board-layout.md](./contracts/board-layout.md) §4 — with **L-2** (a parent is rendered as a card exactly once board-wide; container headers contribute zero to every count) given its own explicit, named test, since it is the likeliest defect. **L-10** (the timing budget) is added later by T068
- [X] T024 [P] [US3] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/components/ChildCard.test.tsx` asserting each type bucket's header colour class **and** that the type remains identifiable from icon plus text when colour is removed (FR-028, SC-010)

### Implementation for User Story 3

- [X] T025 [US3] Implement `boardLayout.ts` in `client/src/views/SprintDashboard/rollupBoard/` as **four named helpers plus a thin composition**, so no function exceeds 40 lines (Article IV): `computeLaneVitals` (from **unfiltered** items), `distributeItemsIntoColumns`, `groupItemsIntoParentContainers`, and `orderLanes`; `buildBoardLayout` composes them in the fixed order of [contracts/board-layout.md](./contracts/board-layout.md) §1 — vitals **before** any filtering, then column distribution, then parent grouping, then empty-container removal, then lane ordering (depends on T012, T020, T023)
- [X] T026 [US3] Create `components/ChildCard.tsx` in `client/src/views/SprintDashboard/rollupBoard/` — one issue card reusing `client/src/components/IssueMeta/` chips (`IssueTypeIcon`, `StatusChip`, `PriorityBadge`, `AssigneeAvatar`), type-coloured header (Story green / Defect red / Sub-task blue / other neutral), the roll-up route, and for defects the precedence route plus `unchosenCandidates` (depends on T024)
- [X] T027 [P] [US3] Create `components/ParentContainer.tsx` and `ParentContainer.test.tsx` — the per-column grouping label headed by the parent's key and summary, visually distinct from a card, not draggable and not openable, and still drawn (marked out of scope) when the parent is not in scope
- [X] T028 [P] [US3] Create `components/BoardColumnHeaderRow.tsx` and `BoardColumnHeaderRow.test.tsx` — the single shared header row for the whole board, ordered by `BoardColumn.order`, with `Unmapped` always present and always last
- [X] T029 [US3] Create `components/MasterCardLane.tsx` and `MasterCardLane.test.tsx` — one full-width swimlane rendering its `LaneCell`s across the shared columns, with containers and loose items (depends on T026, T027)
- [X] T030 [US3] Add lane-scoped family highlighting to `MasterCardLane.tsx`: selecting or focusing any card highlights its parent's card, its parent's containers, and its siblings across every column (FR-038), held as one `highlightedFamilyKey` per lane rather than per-card state
- [X] T031 [US3] Replace the US1 lane list in `RollupBoardTab.tsx` with the full layout, and make horizontal overflow scroll the **board** so column alignment can never be lost (FR-000d) (depends on T025, T028, T029)
- [X] T032 [US3] Add the checklist-completion indicator to `components/ChildCard.tsx` and `ChildCard.test.tsx` (FR-054): when a host issue carries readable checklist data, render a **read-only** completion indicator on its card; the indicator is never movable, filterable, or writable, and when no checklist data is present nothing is rendered — no empty placeholder. Add `checklistCompletion` as an optional field on `RollupBoardItem` in `rollupBoardTypes.ts`, populated only when the data is actually present (depends on T026)

**Checkpoint**: the board renders as designed. Quickstart V4, V5, V6 and V17 pass. Every item is `Unmapped` until US2 lands — correctly and visibly.

---

## Phase 5: User Story 2 — Status names the team actually understands (Priority: P1)

**Goal**: the team defines its own columns, maps each to a Jira status + sub-status pair, moves cards between them, and shares the vocabulary through Confluence.

**Independent Test**: define a column mapped to a specific status + sub-status pair, drag a card into it, and confirm **in Jira** that both values were written. Then place an issue in a combination no column claims and confirm it appears under Unmapped with its raw values.

### Tests for User Story 2 ⚠️

- [X] T033 [P] [US2] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/statusMoveWriter.test.ts` for every row of [contracts/status-move.md](./contracts/status-move.md) §3 and §6 — including the zero-request cases (`no-op`, `refused`, incomplete required fields), the atomic single-request case (FR-022b), the two-step case, and **the partial-failure case where the card must NOT revert** (FR-022a)
- [X] T034 [P] [US2] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/boardVocabularyStore.test.ts` for team-profile scoping, corrupt localStorage reading as empty without throwing, and `updatedAt` advancing on edit while `lastSyncedAt` does not
- [X] T035 [P] [US2] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/boardVocabularySync.test.ts` for every row of [contracts/vocabulary-sync.md](./contracts/vocabulary-sync.md) §6 — including publish preserving other teams' entries, the difference preview enumerating each `VocabularyDifference` kind, a refused pull leaving local untouched, and a newer remote schema version refusing without touching local

### Implementation for User Story 2

- [X] T036 [P] [US2] Implement `boardVocabularyStore.ts` in `client/src/views/SprintDashboard/rollupBoard/` — Zustand + localStorage key `tbxRollupBoardVocabulary`, keyed by team profile id (depends on T034)
- [X] T037 [P] [US2] Implement `columnOptionSources.ts` and `columnOptionSources.test.ts` in `client/src/views/SprintDashboard/rollupBoard/` — assemble selectable Jira status names from in-scope issues and their fetched transitions, and sub-status values from `fetchFeatureReviewEditMeta` allowed values unioned across in-scope issues; when no in-scope issue exposes the field, report that plainly and **never** fall back to a free-text input (FR-017, [contracts/column-vocabulary.md](./contracts/column-vocabulary.md) §3)
- [X] T038 [US2] Implement `planStatusMove` and the move executor in `client/src/views/SprintDashboard/rollupBoard/statusMoveWriter.ts`, reusing `fetchFeatureReviewTransitions`, `saveFeatureReviewTransition` and `saveFeatureReviewOptionField`; prefer the atomic `transition-with-substatus` plan when `screenFieldIds` contains the sub-status field (FR-022b), and on a two-step partial failure **re-read the issue and render its truth rather than reverting the card** (FR-022a) (depends on T008, T033)
- [X] T039 [US2] Implement `boardVocabularySync.ts` in `client/src/views/SprintDashboard/rollupBoard/` — `publishBoardVocabulary` and `previewBoardVocabularyPull`, both explicit-action-only, with no automatic overwrite in either direction (depends on T010, T035)
- [X] T040 [US2] Create `components/ColumnVocabularyEditor.tsx` and `ColumnVocabularyEditor.test.tsx` — add, rename, reorder and map columns from real Jira options; refuse a save that fails `validateVocabulary`, showing which rule broke; state which vocabulary is in use and when it was last synchronised (FR-019c); offer Publish and Pull with the difference preview and a refusable accept (depends on T036, T037, T039)
- [X] T041 [US2] Add card drag-and-drop to `MasterCardLane.tsx`: a `DndContext` whose draggable is the `ChildCard` **grip area only** (so buttons stay clickable, per the `MyIssues/Todo/TodoTab.tsx` precedent) and whose droppables are the lane's column cells; delegate every drop to `statusMoveWriter`; move optimistically, return the card to origin on `refused` or atomic failure, and settle at the re-read truth on partial success (depends on T038)
- [X] T042 [US2] Render required transition fields inline on a blocked move in `MasterCardLane.tsx`, reusing `client/src/components/TransitionRequiredFields/` **unchanged**, including its "must be completed in Jira" note for unsupported field shapes (FR-021)
- [X] T043 [US2] Surface the sub-status degradation in `RollupBoardTab.tsx`: when `subStatusFieldIds` is empty, columns map on status alone and the board states that sub-status precision is unavailable (FR-025)

**Checkpoint**: US1, US2 and US3 all work. Quickstart V7, V8, V9, V10, V14 and V15 pass. All three P1 stories are delivered.

---

## Phase 6: User Story 4 — Master card health at a glance (Priority: P2)

**Goal**: the eight Feature vitals in every lane header, and a board that opens collapsed so the first thing seen is a Feature-level overview.

**Independent Test**: open the board on a Feature that is flagged, has dependencies and is part-complete. Without expanding anything, verify all eight attributes match Jira and the percentage matches its stated basis. Expand two lanes, restart, and confirm exactly those two are expanded.

### Tests for User Story 4 ⚠️

- [X] T044 [P] [US4] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/featureProgress.test.ts`: points-weighted only when **every** contributing item has an estimate (INV-12), issue-count basis otherwise, `basis` always returned with the number (INV-11), and nothing to measure ⇒ `percentComplete: null` with `basis: 'none'`
- [X] T045 [P] [US4] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/boardPreferencesStore.test.ts` for collapse state persisting per person, team and board, and defaulting to collapsed for an unseen Feature

### Implementation for User Story 4

- [X] T046 [US4] Implement `computeFeatureProgress` in `client/src/views/SprintDashboard/rollupBoard/featureProgress.ts`, reading story points through `readIssueStoryPointsDisplayValue` and `getStoryPointsCandidateFieldIds` from `featureReviewFixes.ts` (the field is a **dropdown** on this instance — never read a raw number) (depends on T044)
- [X] T047 [US4] Implement `boardPreferencesStore.ts` in `client/src/views/SprintDashboard/rollupBoard/` — localStorage, keyed by person, team profile and board; holds `collapsedByFeatureKey` now and gains `laneOrder` in US6; never published, never written to Jira (depends on T045)
- [X] T048 [US4] Create `components/MasterCardHeader.tsx` and `MasterCardHeader.test.tsx` — key, summary, status, % complete **with its basis**, dependency count, flagged indicator, story points, priority and child count; a missing value states it is missing and is never shown as zero (FR-013); dependencies and the flag are read via `detectImpedimentReasons` from `client/src/views/ArtView/hooks/artHelpers.ts` (depends on T046)
- [X] T049 [US4] Add collapse and expand to `MasterCardLane.tsx`: lanes open collapsed (FR-000f), a collapsed lane renders its header only and constructs no cell tree, and the state persists per person (depends on T047, T048)
- [X] T050 [US4] Add single-action expand-all and collapse-all to `RollupBoardTab.tsx` (FR-000i)

**Checkpoint**: Quickstart V13 passes and the board opens as a one-screen Feature portfolio.

---

## Phase 7: User Story 5 — Quick filters (Priority: P2)

**Goal**: one-click filters for type, assignee and fixVersion that never change a Feature's numbers.

**Independent Test**: record a Master Card's % complete and points, then apply "Defects only" plus an assignee filter. The figures must be unchanged, lanes with no matches must remain visible stating `0 of N match`, and no empty parent container may remain.

### Tests for User Story 5 ⚠️

- [X] T051 [P] [US5] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/boardFilters.test.ts`: filters composing with AND, an empty `typeBuckets` meaning "no type filter" rather than "match nothing", a single clear action resetting all three, and — asserted directly — `MasterCardVitals` being deeply equal with filters applied and cleared (invariant **L-4**)

### Implementation for User Story 5

- [X] T052 [US5] Implement `selectMatchingItems` in `client/src/views/SprintDashboard/rollupBoard/boardFilters.ts` (depends on T051)
- [X] T053 [US5] Create `components/QuickFilterBar.tsx` and `QuickFilterBar.test.tsx` — Stories only, Defects only, Sub-tasks only, an assignee picker sourced from the in-scope issues, a fixVersion picker, and a single clear action (depends on T052)
- [X] T054 [US5] Apply filtering inside `buildBoardLayout` at its fixed position — **after** vitals are computed — and prune containers left with zero items (FR-042, invariants L-4 and L-5) in `client/src/views/SprintDashboard/rollupBoard/boardLayout.ts` (depends on T052)
- [X] T055 [US5] Show `matchedItemCount of totalItemCount` on every lane header, keep zero-match lanes visible (FR-041), and state on the board that Master Card figures ignore filters (FR-014) in `MasterCardLane.tsx` and `RollupBoardTab.tsx`

**Checkpoint**: Quickstart V11 passes.

---

## Phase 8: User Story 6 — Your own priority order (Priority: P2)

**Goal**: personal lane ordering by drag, and by send-to-top / send-to-bottom, that never touches Jira and never affects a colleague.

**Independent Test**: reorder lanes, send one to top and another to bottom, restart the session. The order survives, Jira's ranking is unchanged, and a second person's board is unaffected.

### Tests for User Story 6 ⚠️

- [X] T056 [P] [US6] Extend `client/src/views/SprintDashboard/rollupBoard/boardPreferencesStore.test.ts` with failing tests for `laneOrder`: persistence per person/team/board, a Feature absent from the order sorting to the end (INV-22), and nothing in the entity ever appearing in a publish payload or a Jira write (INV-23)

### Implementation for User Story 6

- [X] T057 [US6] Add `laneOrder` to `boardPreferencesStore.ts` in `client/src/views/SprintDashboard/rollupBoard/` (depends on T047, T056)
- [X] T058 [US6] Add lane reordering to `RollupBoardTab.tsx` using `@dnd-kit/sortable` in a `DndContext` **separate** from the card-move context, so the two gestures can never interfere ([contracts/board-layout.md](./contracts/board-layout.md) §6) (depends on T057)
- [X] T059 [US6] Add "send to top" and "send to bottom" actions to `components/MasterCardLane.tsx` (FR-044), reachable by keyboard as well as by pointer (depends on T057)
- [X] T060 [US6] Order lanes by `preferences.laneOrder` in `boardLayout.ts`, appending unlisted Features in a stable order (FR-047, invariant L-7) (depends on T057)

**Checkpoint**: Quickstart V12 passes.

---

## Phase 9: User Story 7 — Edit in place (Priority: P2)

**Goal**: clicking any card opens its detail with the product's existing in-place field editing, and a successful edit updates the card without reloading the board.

**Independent Test**: open a child card, change an editable field, and confirm the value reaches Jira and the board card reflects it without a full board reload.

### Tests for User Story 7 ⚠️

- [X] T061 [P] [US7] Write failing tests in `client/src/views/SprintDashboard/rollupBoard/components/ChildCard.test.tsx` (extend) asserting a card click opens the detail panel with field editing enabled, and that a successful edit updates only that card

### Implementation for User Story 7

- [X] T062 [US7] Open `client/src/components/IssueDetailPanel/index.tsx` from `ChildCard.tsx` and `MasterCardHeader.tsx` with the optional `fieldEditing` capability enabled, reusing the shipped `IssueFieldEditors` writers **unchanged** — no new write path (depends on T061)
- [X] T063 [US7] Update the affected card in place on a successful edit, and restore the previous value with the stated reason on failure, in `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.tsx` (FR-049, FR-051)

**Checkpoint**: all seven user stories are independently functional.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T064 [P] Update `CHANGELOG.md` with the user-visible behaviour this feature adds (Article VI — the single source of truth for what changed)
- [X] T065 [P] Accessibility pass across `client/src/views/SprintDashboard/rollupBoard/components/`: every drag action has a keyboard equivalent, containers and lanes carry correct roles and labels, and card type never depends on colour alone (FR-028)
- [X] T066 [P] Verify the project's zoom rules across `RollupBoardTab.module.css` — **never** reintroduce `width: calc(100% / zoom)`; the standardised zoom double-shrinks and this board is full-width
- [X] T067 Memoise `buildBoardLayout` on `(masterCards, columns, filters, preferences)` and confirm a collapsed lane constructs no cell tree, in `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.tsx`
- [X] T068 **Measure** SC-012 rather than assume it: add a timed test in `client/src/views/SprintDashboard/rollupBoard/boardLayout.test.ts` asserting `buildBoardLayout` completes within its budget for a synthetic 300-issue / 40-lane / 8-column set, and record the wall-clock time to first readable board in quickstart V16. A performance criterion with no measurement is untestable
- [X] T069 Confirm the additive edits really were additive: `hygieneFieldConfig.test.ts`, `hygieneChecks.test.ts`, `featureReviewFixes.test.ts`, `confluenceApi.test.ts` and the existing `SprintDashboardView` tests all pass **unmodified**. If any needed editing, revert and rework the change rather than adjusting the test
- [X] T070 Run the full client suite (`cd client && npx vitest run`) and the server suite (`npm test` at repo root); both must be green, ignoring only the known `local-release.test.js` sandbox failure
- [ ] T071 Execute every scenario in [quickstart.md](./quickstart.md) V1–V17 against live Jira and record the evidence (Article X — a green toast is not proof; confirm writes in Jira itself)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational
- **US3 (Phase 4)**: depends on US1 (needs resolved Master Cards to lay out)
- **US2 (Phase 5)**: depends on US3 (needs rendered columns to drop cards into)
- **US4, US5, US6, US7 (Phases 6–9)**: each depends only on US3; they are mutually independent
- **Polish (Phase 10)**: depends on every story that will ship

### The one cross-story ordering note

US1 → US3 → US2 is a genuine chain, not a preference: you cannot lay out cards you have not resolved, and you cannot
drag a card into a column that does not exist. US2 and US3 are both P1 and both ship in the same increment; the order
within that increment is dictated by the dependency.

### Within each user story

- Tests are written and **failing** before implementation (Article V)
- Pure modules before the components that consume them
- Components before the tab wiring that mounts them

### Parallel opportunities

- **Phase 2** is highly parallel: T005/T007/T009/T011 are four independent test tasks in four different files, and
  their implementations T006/T008/T010/T012 are likewise independent. Only T013/T014 must follow T006.
- **Phase 3**: T015, T016 and T017 are three independent test files. T018 → T019 → T020 is a chain.
- **Phase 4**: T023 and T024 in parallel; T027 and T028 in parallel.
- **Phase 5**: T033, T034 and T035 in parallel; then T036 and T037 in parallel.
- **Phases 6–9** can be worked by four people at once once US3 lands — the only shared file is
  `boardPreferencesStore.ts` (US4 creates it, US6 extends it), so T047 must precede T057.
- **Phase 10**: T064, T065 and T066 in parallel. T069, T070 and T071 are the closing gates and run in order.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Four independent failing-test tasks, four different files:
Task: "T005 hygieneFieldConfig sub-status and flagged discovery tests"
Task: "T007 featureReviewFixes screenFieldIds tests"
Task: "T009 confluenceApi board vocabulary property tests"
Task: "T011 boardColumns resolution and validation tests"

# Then their four independent implementations:
Task: "T006 add the two field families to hygieneChecks + hygieneFieldConfig"
Task: "T008 add screenFieldIds to FeatureReviewTransition"
Task: "T010 add the board vocabulary Confluence property"
Task: "T012 implement resolveColumnIdForItem and validateVocabulary"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup
2. Phase 2 Foundational — **blocks everything**
3. Phase 3 US1
4. **STOP and VALIDATE**: quickstart V1, V2, V3. The board already answers "what does each item deliver?" and
   quantifies the hygiene backlog — real value before a single column exists.

### Incremental delivery

| Increment | Adds | Proven by |
|---|---|---|
| 1 (MVP) | Roll-up + No Feature | V1, V2, V3 |
| 2 | The swimlane board itself | V4, V5, V6 |
| 3 | The team's own columns, moves and sharing | V7–V10, V14, V15 |
| 4 | Feature vitals + collapsed-by-default | V13 |
| 5 | Quick filters | V11 |
| 6 | Personal ordering | V12 |
| 7 | Edit in place | — |

Increments 1–3 together deliver all three P1 stories and are the natural release boundary.

---

## Notes

- **[P]** = different files, no dependency on an incomplete task
- Four shipped files are edited, all additively: `useSprintData.ts`, `SprintDashboardView.tsx`,
  `hygieneFieldConfig.ts` / `hygieneChecks.ts`, `featureReviewFixes.ts`, `confluenceApi.ts`. **T068 is the proof** —
  their existing tests must pass unmodified.
- **No new npm dependency.** `@dnd-kit/core`, `/sortable` and `/utilities` already ship in `client/package.json`.
- Every new source file needs a sibling test file, or the pre-commit hook blocks the commit. The same hook requires
  a `CHANGELOG.md` update in the commit that changes behaviour.
- Record the workflow gates as you go — `branch-created`, `tests-written`, `tests-passed` — and run the preflight
  check before the first commit.
- **The single most likely defect** is invariant **L-2**: drawing the parent's card once per column instead of once
  board-wide. It inflates every count and silently breaks SC-001. T023 tests it by name.
- **Resolved (was an open item)**: the FR-022 partial-write conflict is closed. The spec now carries **FR-022**
  (fails as a unit ⇒ revert), **FR-022a** (two-step partial success ⇒ do **not** revert, re-read and state what
  applied) and **FR-022b** (prefer the single-step write). T033 and T038 implement exactly this — there is no longer
  any contradiction between the tests and the spec.
