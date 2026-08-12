# Tasks: Cloned-Feature Sub-Lanes

**Feature**: `specs/035-feature-clone-sub-lanes` | **Branch**: `feature/035-feature-clone-sub-lanes`

**Input**: [plan.md](./plan.md), [data-model.md](./data-model.md), [contracts/module-contracts.md](./contracts/module-contracts.md)

Tests come before implementation within each phase (Constitution Article V). `[P]` marks tasks that touch different
files and can run together.

---

## Phase 1: Setup

- [x] T001 Confirm the branch and a clean board suite baseline by running `npx vitest run src/views/SprintDashboard/rollupBoard` in `client/`

---

## Phase 2: Foundational — types shared by every later phase

- [x] T002 Add `DisciplineProjects`, `CloneLink`, `CloneClassification`, `SubLane` and `FamilyProgress` interfaces, and add `subLanes` to `RenderedLane`, in `client/src/views/SprintDashboard/rollupBoard/rollupBoardTypes.ts`

---

## Phase 3: US-CONFIG — configure the disciplines (Phase A, ships dark)

**Goal**: A team can name its QE and BT projects. With none configured the board is byte-identical to today.

**Independent test**: Save two disciplines, reload the page, and see them still there — with no visual change to the board.

- [x] T003 Contract tests T-01…T-03 for `disciplineProjects` round-trip in `client/src/views/SprintDashboard/rollupBoard/boardScopeStore.test.ts`
- [x] T004 Add `disciplineProjects` to `StoredTeamScope`, `loadTeamFeatureScope` and `saveTeamFeatureScope` in `client/src/views/SprintDashboard/rollupBoard/boardScopeStore.ts`
- [x] T005 Add `disciplineProjects` to `FeatureScopeSettings` in `client/src/views/SprintDashboard/rollupBoard/featureScope.ts`
- [x] T006 [P] Add the discipline editor (name, Feature project, story project; add and remove) to `client/src/views/SprintDashboard/rollupBoard/components/FeatureScopePanel.tsx`
- [x] T007 [P] Tests for the discipline editor, including rejecting a Feature project equal to the team's own, in `client/src/views/SprintDashboard/rollupBoard/components/FeatureScopePanel.test.tsx`
- [x] T008 Update every existing `FeatureScopeSettings` fixture across the board test suite for the new required field

---

## Phase 4: US-DISCOVERY — find and classify clones (Phase B, first visible output)

**Goal**: The board knows which clones are other disciplines, which are peers, and which are unconfigured.

**Independent test**: With `QEINT` configured, `QEINT-610` classifies as a discipline and `DENP-1359` as a peer.

- [x] T009 Contract tests C-01…C-09 in `client/src/views/SprintDashboard/rollupBoard/cloneFamily.test.ts`
- [x] T010 Implement `readCloneLinks`, `classifyClone`, `findCloneByFeatureName`, `readDisciplineToneIndex` and `describeUnconfiguredClones` in `client/src/views/SprintDashboard/rollupBoard/cloneFamily.ts`
- [x] T011 Add `fetchCloneFeatures` and `fetchDisciplineWork` to `client/src/views/SprintDashboard/rollupBoard/rollupBoardFetch.ts`, reusing `chunkList` and `FEATURE_KEY_CHUNK_SIZE`
- [x] T012 Wire discovery into the board load and surface the unconfigured-clone notice in `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.tsx`

---

## Phase 5: US1 + US2 + US4 — draw the sub-lanes (Phase C)

**Goal**: Each discipline's clone appears as a distinct, read-only band under the dev Feature.

**Independent test**: The reference Feature shows a QE sub-lane with QE's stories in the dev team's columns, and its cards cannot be dragged.

- [x] T013 Contract tests L-01…L-07 in `client/src/views/SprintDashboard/rollupBoard/subLaneLayout.test.ts`
- [x] T014 Implement `buildSubLanes` in `client/src/views/SprintDashboard/rollupBoard/subLaneLayout.ts`
- [x] T015 [P] Contract tests R-01…R-02 for `isReadOnly` in `client/src/views/SprintDashboard/rollupBoard/components/ChildCard.test.tsx`
- [x] T016 [P] Add `isReadOnly` to `ChildCard`, disabling the hook and withholding listeners, in `client/src/views/SprintDashboard/rollupBoard/components/ChildCard.tsx`
- [x] T017 Contract tests S-01…S-06 in `client/src/views/SprintDashboard/rollupBoard/components/SubLane.test.tsx`
- [x] T018 Implement `SubLane.tsx` in `client/src/views/SprintDashboard/rollupBoard/components/`
- [x] T019 Attach sub-lanes to lanes in `client/src/views/SprintDashboard/rollupBoard/boardLayout.ts`
- [x] T020 Render sub-lanes beneath the lane cells in `client/src/views/SprintDashboard/rollupBoard/components/MasterCardLane.tsx`
- [x] T021 Add the sub-lane band and per-discipline tone rotation to `client/src/views/SprintDashboard/rollupBoard/RollupBoardTab.module.css`

---

## Phase 6: US3 — the second figure (Phase D)

**Goal**: A Feature is never presented as finished while any discipline has open work.

**Independent test**: A Feature with dev complete and QE in progress shows both figures and states the disagreement.

- [x] T022 Contract tests P-01…P-05 in `client/src/views/SprintDashboard/rollupBoard/familyProgress.test.ts`
- [x] T023 Implement `computeFamilyProgress`, `describeProgressDisagreement` and `haveDifferentBases` in `client/src/views/SprintDashboard/rollupBoard/familyProgress.ts`
- [x] T024 Show both figures and the disagreement in the lane header in `client/src/views/SprintDashboard/rollupBoard/components/MasterCardLane.tsx`

---

## Phase 7: Polish

- [x] T025 Collapse sub-lanes by default and persist their collapsed state, in `client/src/views/SprintDashboard/rollupBoard/components/MasterCardLane.tsx`
- [x] T026 Confirm quick-filter parity for sub-lane cards (FR-012) with a test in `subLaneLayout.test.ts`
- [x] T027 Run the full board suite and `tsc -b`
- [x] T028 Update `CHANGELOG.md`
- [ ] T029 PR, merge, release

---

## Dependencies

```
T001 → T002 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

Phases 3 and 4 are individually shippable with no visible change. Phase 5 is the first phase a user can see.

## MVP

**Phases 3 + 4 + 5** deliver US1, US2 and US4 — the sub-lanes themselves. Phase 6 (the second figure) is the highest-value
addition but is independently useful and deliberately last.
