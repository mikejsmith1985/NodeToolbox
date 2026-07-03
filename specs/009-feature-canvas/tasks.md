# Tasks: Feature Canvas — Backlog Triage & Planning Board

**Input**: Design documents from `specs/009-feature-canvas/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED. The project constitution (Article V) mandates TDD, so every pure-logic
module and each user story carries test tasks written **RED first** (must fail before
implementation).

**Organization**: Phases map to the five coaching stages plus Commit and the hidden AI
accelerator. Each user story is an independently testable, demoable increment.

## Story → Phase map

| Phase | User Story | Spec story | Priority |
|-------|-----------|------------|----------|
| 3 | US1 Surface | Story A | P1 🎯 MVP |
| 4 | US2 Stabilize WIP | Story B | P2 |
| 5 | US3 Prioritize | Story C | P3 |
| 6 | US4 Size | Story D | P4 |
| 7 | US5 Sequence & Box | Story E | P5 |
| 8 | US6 Review & Commit | Story G | P6 |
| 9 | US7 Hidden AI Accelerator | Story H | P7 |

> **Story F (Resume, SC-10)** and the coach shell are **cross-cutting**, delivered by the
> Foundational overlay persistence (T007–T008) + coach shell (T013–T014) and validated in
> Polish (T050). It is not a standalone phase because every stage depends on it.

## Path conventions

Frontend-only. All paths under `client/src/`. Tests are colocated in
`client/src/views/FeatureCanvas/**/__tests__/` and run with `npm run test` (Vitest + RTL).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the one new dependency and scaffold the view so it loads.

- [X] T001 Add `@xyflow/react` (React Flow v12) to `client/package.json` dependencies and run install
- [X] T002 [P] Create the FeatureCanvas view directory tree with placeholder index files: `client/src/views/FeatureCanvas/{canvas,coach,overlay,logic,commit,ai}/` and colocated `__tests__/` folders
- [X] T003 [P] Register the Home tile: append an `AppCardDef` (section `'agile'`, route `/feature-canvas`, icon, title, description) in `client/src/views/Home/homeCardData.ts`
- [X] T004 Add the lazy route in `client/src/App.tsx`: a `FEATURE_CANVAS_ROUTE = '/feature-canvas'` constant, a `React.lazy(() => import('./views/FeatureCanvas/FeatureCanvasView'))` import, a `<Suspense>` boundary (first in the app), and a `<Route>` placed **before** the `*` catch-all

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The overlay, data fetch, node mapping, and coach shell that every stage needs.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [X] T005 [P] Define overlay types and defaults in `client/src/views/FeatureCanvas/overlay/overlayModel.ts` (`CanvasOverlay`, `CanvasNodeState`, `CanvasContainer`, `ContainerProvenance`, `JourneyStageState`, and the `TshirtSize`/`MoscowBucket`/`StageId`/`ContainerKind` enums) per `data-model.md` — pure, no I/O
- [X] T006 [P] Write RED unit tests for overlay storage in `client/src/views/FeatureCanvas/overlay/__tests__/overlayStorage.test.ts`: serialize/deserialize round-trip, `schemaVersion` migration, and self-heal of dangling `containerId` references
- [X] T007 Implement `client/src/views/FeatureCanvas/overlay/overlayStorage.ts` to pass T006: team+scope keyed `localStorage` blob `tbxFeatureCanvasOverlay:{profileId}:{scopeKey}` reusing `buildTeamScopedStorageKey`, guarded by `canUseLocalStorage()` + try/catch, with legacy→scoped one-time migration
- [X] T008 Implement the overlay store `client/src/views/FeatureCanvas/overlay/useCanvasOverlay.ts` (zustand, no `persist` middleware): load overlay on mount, expose mutators, debounced save, stamp `updatedAtIso` by the caller
- [X] T009 [P] Write RED unit tests for node mapping in `client/src/views/FeatureCanvas/canvas/__tests__/nodeMapping.test.ts`: join `FeatureReviewItem[]` with `CanvasNodeState` → `CanvasNode`, and `effectivePoints = size ? sizeMapping[size] : (storyPoints ?? 0)`
- [X] T010 Implement `client/src/views/FeatureCanvas/canvas/nodeMapping.ts` to pass T009 — pure projection producing the React Flow node/edge model
- [X] T011 Implement `client/src/views/FeatureCanvas/FeatureCanvasView.tsx` scope/team guard: read active team profile + ART context from `useSettingsStore`/`sprintDashboardArtContext`; if no ART team matches the board, render the "configure ART settings" empty state (mirror Feature Review)
- [X] T012 Implement `client/src/views/FeatureCanvas/canvas/useCanvasFeatures.ts` fetch hook: call `fetchFeatureReviewFieldConfig` then `fetchFeatureReviewItems(team, selectedPiName, fieldConfig, spFieldId)` with loading/error states. Ensure `issuelinks` is in the requested field set (extend `requestedFieldIds` or add a companion fetch) so `CanvasNode.dependencies` can be populated for FR-6.4 (G1)
- [X] T013 [P] Implement `client/src/views/FeatureCanvas/coach/stages.ts` — the five stage definitions (`surface`/`stabilize`/`prioritize`/`size`/`sequence`), each with job, decision, and completion rule — pure, no AI references
- [X] T014 Implement `client/src/views/FeatureCanvas/coach/CoachPanel.tsx` shell: render the current stage's guidance + a slot for per-stage controls, resume from `stageState.currentStageId`, and allow non-linear jump/revisit without clearing later attributes

**Checkpoint**: Overlay + data + coach shell ready — stage work can begin.

---

## Phase 3: User Story 1 — Surface (Priority: P1) 🎯 MVP

**Goal**: Scoped features render as freely-positioned, draggable nodes on a pan/zoom canvas.

**Independent Test**: Open Feature Canvas → the node count equals the Feature Review count
for the same team+PI; nodes pan/zoom and drag; positions persist.

- [X] T015 [P] [US1] Write RED component test in `client/src/views/FeatureCanvas/canvas/__tests__/FeatureCanvasBoard.test.tsx`: board renders exactly one node per surfaced feature and the count matches the mocked fetch
- [X] T016 [US1] Implement `client/src/views/FeatureCanvas/canvas/FeatureCanvasBoard.tsx` — the React Flow host (node array from `nodeMapping`, pan/zoom, default viewport, `onlyRenderVisibleElements`). Include the **Article VII framework-first justification comment** at the top of this file
- [X] T017 [P] [US1] Implement `client/src/views/FeatureCanvas/canvas/FeatureNode.tsx` — node card: key (links to Jira), summary, status color by status-category, size, health, completion, hygiene-flag badge
- [X] T018 [US1] Wire Stage 1 (Surface) via CoachPanel: persist node position to the overlay on drag-stop; record the surfaced set; drive the board from `useCanvasFeatures` + `useCanvasOverlay`
- [X] T019 [US1] Add the per-node hygiene overlay by calling `evaluateHygieneIssue(featureIssue, { fieldConfig, customStoryPointsFieldId })` and rendering the badge count consistent with the Hygiene tab

**Checkpoint**: MVP — the whole battlefield is visible and arrangeable; nothing writes to Jira.

---

## Phase 4: User Story 2 — Stabilize WIP (Priority: P2)

**Goal**: Set a WIP limit, see overflow, and move excess work into an explicit Parking Lot.

**Independent Test**: Set limit 5 with 12 In-Progress → overflow shows 7; dragging items to
the Parking Lot yields an exact, at-a-glance paused count.

- [X] T020 [P] [US2] Write RED unit tests in `client/src/views/FeatureCanvas/logic/__tests__/wip.test.ts`: In-Progress count from status categories, `overflow = max(0, count − limit)`, `parkedCount`
- [X] T021 [US2] Implement `client/src/views/FeatureCanvas/logic/wip.ts` (pure `WipSnapshot`) to pass T020
- [X] T022 [US2] Add Stage 2 controls to CoachPanel: WIP-limit input persisted to `overlay.wipLimit`, and an overflow flag on the board when exceeded
- [X] T023 [US2] Implement the Parking Lot container (singleton per overlay) with drag-to-park, `isParked` mirror, and an always-visible paused count/list
- [X] T024 [P] [US2] Write component test in `client/src/views/FeatureCanvas/canvas/__tests__/parkingLot.test.tsx`: setting a limit surfaces overflow; parking a node updates both counts

**Checkpoint**: Active set is bounded and the paused set is explicit and communicable.

---

## Phase 5: User Story 3 — Prioritize (Priority: P3)

**Goal**: Rank nodes into Must / Should / Could / Won't with visible tags and live counts.

**Independent Test**: Drag a node into "Must" → it shows the Must tag, the bucket count
increments, and no Jira field changes.

- [X] T025 [US3] Implement MoSCoW bucket drop zones (Must/Should/Could/Wont) that set `CanvasNodeState.priority` in the overlay
- [X] T026 [US3] Render the per-node bucket tag and a live count per bucket in the CoachPanel Stage 3 controls
- [X] T027 [P] [US3] Write component test in `client/src/views/FeatureCanvas/canvas/__tests__/prioritize.test.tsx`: dragging to a bucket tags the node and updates the count, and asserts no `jiraPut`/`jiraPost` occurs

**Checkpoint**: Work has an unambiguous, visible order.

---

## Phase 6: User Story 4 — Size (Priority: P4)

**Goal**: Assign fast relative sizes (S/M/L/XL) that feed capacity; existing points shown as-is.

**Independent Test**: Size an unpointed node "L" → it displays L and contributes
`sizeMapping.L` to any container it later joins.

- [X] T028 [P] [US4] Write RED unit tests in `client/src/views/FeatureCanvas/logic/__tests__/sizing.test.ts`: default S1/M3/L5/XL8 mapping, editable mapping, size↔points resolution
- [X] T029 [US4] Implement `client/src/views/FeatureCanvas/logic/sizing.ts` to pass T028
- [X] T030 [US4] Add the node size control (assign S/M/L/XL without opening the issue); show existing story points as-is; compute `effectivePoints`
- [X] T031 [P] [US4] Write component test in `client/src/views/FeatureCanvas/canvas/__tests__/sizing.test.tsx`: sizing an unpointed node persists the size and it contributes to a container total

**Checkpoint**: Every in-scope node is orderable and sized; capacity math is possible.

---

## Phase 7: User Story 5 — Sequence & Box (Priority: P5)

**Goal**: Drag nodes into release/sprint boxes (real or provisional) with live capacity meters.

**Independent Test**: A sprint box with a budget flips to an over-capacity warning when member
sizes exceed it; a provisional "Sprint 25" box is visibly distinct from real ones.

- [X] T032 [P] [US5] Write RED unit tests in `client/src/views/FeatureCanvas/logic/__tests__/capacity.test.ts`: `total = Σ effectivePoints`, `status` under/at/over, `overBy`
- [X] T033 [US5] Implement `client/src/views/FeatureCanvas/logic/capacity.ts` to pass T032
- [X] T034 [P] [US5] Implement `client/src/views/FeatureCanvas/canvas/ContainerNode.tsx` — release/sprint/parkingLot box with capacity meter, over-capacity warning state, and provisional styling
- [X] T035 [US5] Load boxable containers into the overlay as `real`: `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future` and `GET /rest/api/2/project/{projectKey}/versions`
- [X] T036 [US5] Implement the "create provisional container" action (Q3=A) with `capacityBudget` editing; setting `containerId` on node drop
- [X] T037 [US5] Add dependency indicators on nodes from `CanvasNode.dependencies` (sourced from `issuelinks` via T012) so sequencing a node ahead of its blocker is visible

**Checkpoint**: The mess is a Now/Next/Later plan with capacity awareness.

---

## Phase 8: User Story 6 — Review & Commit (Priority: P6)

**Goal**: Turn the overlay into a reviewed, itemized set of Jira writes; reconcile provisional
containers; never write implicitly. See `contracts/jira-writes.md`.

**Independent Test**: With arrangement done but no commit, Jira issue history shows zero
changes (SC-6); Review & Commit lists every change; deselected items are not written;
provisional containers are created before member assignments.

- [X] T038 [P] [US6] Write RED unit tests in `client/src/views/FeatureCanvas/logic/__tests__/commitDiff.test.ts`: overlay vs live → ordered `CommitDiffItem[]`, `dependsOn` links assignments to their create-container item, deselection excludes items, and **FR-6.1a expansion** (feature→sprint yields per-child-story `sprintAssign`; childless feature yields one; feature→release yields one `versionAssign`)
- [X] T039 [US6] Implement `client/src/views/FeatureCanvas/logic/commitDiff.ts` to pass T038, including the **FR-6.1a feature→sprint expansion** (a feature boxed into a sprint emits one `sprintAssign` per child story; a childless feature emits one for itself; a feature→release emits one `versionAssign` for the feature)
- [X] T040 [P] [US6] Add `createSprint()` (`POST /rest/agile/1.0/sprint`) and `createVersion()` (`POST /rest/api/2/version`) helpers to `client/src/services/jiraApi.ts` per `contracts/jira-writes.md`
- [X] T041 [US6] Implement `client/src/views/FeatureCanvas/commit/commitJira.ts` — two-phase executor (Phase A reconcile containers → backfill ids; Phase B assignments/points) reusing `saveFeatureReviewStoryPoints`/`saveFeatureReviewFixVersion` + sprint-move; resolve SP field per research R5; report per-item success/failure; skip items whose `dependsOn` create failed
- [X] T042 [US6] Implement `client/src/views/FeatureCanvas/commit/ReviewCommitPanel.tsx` — the itemized, per-item-toggleable diff plus the provisional reconciliation prompt (create new vs map to existing)
- [X] T043 [P] [US6] Write component test in `client/src/views/FeatureCanvas/commit/__tests__/reviewCommit.test.tsx`: no write before confirm, diff completeness, deselected items skipped, create-before-assign ordering

**Checkpoint**: Deliberate, reviewable commit; exploration never corrupts the backlog.

---

## Phase 9: User Story 7 — Hidden AI Accelerator (Priority: P7)

**Goal**: Optional, passphrase-gated suggestions that pre-fill overlay controls; no stage
depends on it. See `contracts/ai-assist-json.md`.

**Independent Test**: With AI locked, every stage works and no AI control appears (SC-9). With
AI unlocked, a valid JSON reply yields accept/reject suggestions that mutate only the overlay;
a malformed reply errors and changes nothing.

- [X] T044 [P] [US7] Write RED unit tests in `client/src/views/FeatureCanvas/ai/__tests__/canvasAiAssist.test.ts`: `extractJsonPayload` strips chatter/fences; strict per-`kind` validation (`priorityOrder`/`staleCandidates`/`duplicateCandidates`/`sprintGrouping`); items default `accepted: false`; unknown keys ignored with a count
- [X] T045 [US7] Implement `client/src/views/FeatureCanvas/ai/canvasAiAssist.ts` (`buildCanvasAiPrompt` + `parseCanvasAiResponse`) mirroring `releaseAiAssistNotes.ts`, to pass T044
- [X] T046 [US7] Implement `client/src/views/FeatureCanvas/ai/AiSuggestionPanel.tsx` gated by `aiAssistStore` unlock (Ctrl+Alt+Z): copy-prompt textarea + paste-JSON ingest + per-item accept/reject applying to the overlay only
- [X] T047 [P] [US7] Write test in `client/src/views/FeatureCanvas/ai/__tests__/AiSuggestionPanel.test.tsx`: panel invisible when locked; accepted suggestion mutates overlay (never Jira); malformed reply shows a descriptive error and is a no-op

**Checkpoint**: Accelerator is additive and invisible when locked; manual parity holds.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T048 [P] Performance pass: confirm the canvas stays interactive at ≥200 nodes (SC-8) — verify React Flow `onlyRenderVisibleElements`/viewport culling and node memoization
- [X] T049 [P] Add a `CHANGELOG.md` entry describing the Feature Canvas (Article VI)
- [X] T050 Resume validation (Story F / SC-10): close & reopen the canvas → all positions, sizes, priorities, container assignments, and the Parking Lot restore, and the coach resumes at the saved stage
- [X] T051 Run `quickstart.md` scenarios V1–V11 end to end (both AI-locked and AI-unlocked) and fix any gaps
- [X] T052 [P] Accessibility/keyboard pass on the coach and canvas controls; ensure `npm run lint` and `npm run build` are green

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies — start immediately.
- **Foundational (P2)**: depends on Setup; **blocks all user stories**.
- **US1–US7 (Phases 3–9)**: all depend on Foundational. They are priority-ordered (P1→P7)
  and each is an independent, demoable increment. US3 and US4 are fully independent of each
  other; US5 uses sizing (US4) for capacity but the container UI can be built in parallel;
  US6 consumes whatever arrangement exists; US7 is purely additive.
- **Polish (P10)**: depends on the user stories you chose to ship.

### Within each user story

- Tests are written RED **before** implementation (Article V).
- Pure logic (`logic/*`, `nodeMapping`, `overlayStorage`, `canvasAiAssist`) before the
  components that consume it.
- Overlay mutation before the Jira commit that reads the overlay.

### Parallel opportunities

- Setup: T002 + T003 in parallel (different files); T001 first (install).
- Foundational: T005, T006, T009, T013 in parallel; T007 after T006; T010 after T009;
  T014 after T013.
- Each story's `[P]` test task runs alongside its sibling pure-logic task on a different file.
- With multiple developers post-Foundational: US2, US3, US4 can proceed concurrently; US5/US6
  layer on; US7 any time after Foundational.

---

## Parallel Example: Foundational

```bash
# Launch these together (different files, no interdependency):
Task: "T005 overlay/overlayModel.ts types + defaults"
Task: "T006 RED tests overlay/__tests__/overlayStorage.test.ts"
Task: "T009 RED tests canvas/__tests__/nodeMapping.test.ts"
Task: "T013 coach/stages.ts stage definitions"
```

## Parallel Example: User Story 1

```bash
# After Foundational, launch US1 test + node card together:
Task: "T015 RED component test FeatureCanvasBoard.test.tsx"
Task: "T017 FeatureNode.tsx node card"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (critical) → 3. Phase 3 US1 Surface →
**STOP & VALIDATE**: open the canvas, confirm node count matches Feature Review, drag/pan/zoom,
positions persist across reload. This alone answers "I can finally see the scope" — demoable.

### Incremental delivery (matches the daily-session cadence)

Ship one stage per increment — US1 Surface → US2 Stabilize → US3 Prioritize → US4 Size →
US5 Box → US6 Commit → US7 AI. Each increment is exactly one day's coaching session made real,
and each is independently testable without breaking the prior ones.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[USn]` maps each task to its user story for traceability.
- Nothing writes to Jira before Phase 8 (US6) confirm — the sandbox invariant (Q1=A) holds
  through US1–US5.
- Keep functions <40 lines and names self-documenting (Article IV); confine React Flow + Jira
  I/O to the component/commit layers so pure logic stays unit-testable in <10ms (Article V).
- Commit after each task or logical group; update `CHANGELOG.md` when behavior lands (T049).
