# Tasks: Canvas Surface Scoping & AI-Tools Access Hardening

**Input**: Design documents from `specs/010-canvas-scope-access/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED (constitution Article V mandates TDD). Every new pure module and each user story
carries tests written **RED first**. **Repo pre-commit gate**: every *new* source file needs a
colocated sibling `<name>.test.ts(x)` — factored into the tasks below.

**Organization**: Two independent areas. Area 1 (Surface scoping) is US1 + US2 and shares a data
backbone (Foundational). Area 2 (Access hardening) is US3 and depends on nothing else — it can ship
first as a small security win.

## Story → Phase map

| Phase | User Story | Spec stories | Area | Priority |
|-------|-----------|--------------|------|----------|
| 3 | US1 Surface scoping | A, B | 1 | P1 🎯 MVP (Area 1) |
| 4 | US2 NL→JQL accelerator | C | 1 | P2 |
| 5 | US3 Access hardening | D, E | 2 | P3 (independent; ship-first candidate) |

## Path conventions

Frontend-only, no server change. Paths under `client/src/`. Tests are colocated siblings and run
with `npm run test` (Vitest + RTL).

---

## Phase 1: Setup

- [X] T001 Confirm the working branch is `feature/canvas-scope-access` and that **no new dependency** is required (reuse-only); `client/package.json` is unchanged by this feature.

---

## Phase 2: Foundational (Area 1 data backbone — blocks US1 & US2; US3 is independent of it)

**Purpose**: The JQL-sourced feature path that both Area 1 stories consume.

- [X] T002 [P] Write RED tests for the JQL data path (mocked `jiraGet`): `fetchFeatureNodesByKeys` returns `BlueprintFeatureNode[]` with `health`/`completionPercent` populated for supplied keys, and `fetchFeatureReviewItemsByJql` returns `FeatureReviewItem[]` with hygiene flags — in `client/src/views/ArtView/blueprintHierarchy.featureNodesByKeys.test.ts` and `client/src/views/SprintDashboard/featureReviewByJql.test.ts`
- [X] T003 Export `fetchFeatureNodesByKeys(featureKeys, options?)` from `client/src/views/ArtView/blueprintHierarchy.ts`, reusing the existing private child-discovery JQL and `createBlueprintFeatureNode` (which already calls `computeBlueprintHealth`/`computeCompletionPercent`) — no new health/completion math
- [X] T004 Extract a shared `buildFeatureReviewItem(featureNode, featureIssue, ctx)` in `client/src/views/SprintDashboard/featureReview.ts` and refactor the existing `fetchFeatureReviewItems` loop to use it (behavior-preserving; existing tests stay green)
- [X] T005 Implement `fetchFeatureReviewItemsByJql(jql, fieldConfig?, customStoryPointsFieldId?)` in `client/src/views/SprintDashboard/featureReview.ts` — run `jiraGet('/rest/api/2/search?jql=…')` for feature/epic issues, call `fetchFeatureNodesByKeys`, build items via T004, reject on bad JQL — to pass T002

**Checkpoint**: Features can be sourced from an arbitrary query with full enrichment.

---

## Phase 3: User Story 1 — Surface scoping (Priority: P1) 🎯 Area 1 MVP

**Goal**: The user defines the query that surfaces features (pre-filled from team+PI), can refine the
surfaced set, and bad queries fail safely.

**Independent Test**: Open the canvas → the scope box is pre-filled and surfaces the team+PI set on
Surface; editing to a PI+label query surfaces only matches; a malformed query surfaces nothing with an
error and leaves the arrangement intact.

- [X] T006 [P] [US1] Write RED unit tests for `client/src/views/FeatureCanvas/canvas/scopeQuery.test.ts`: `buildDefaultScopeJql` (PI present → includes a **`cf[<num>]` clause** built from `piFieldId` with the `customfield_` prefix stripped, per I2; PI absent → clause omitted; `issuetype in (Feature, Epic)`) and `applyScopeFilters` (label / text substring / status; empty filters are no-ops)
- [X] T007 [US1] Implement `client/src/views/FeatureCanvas/canvas/scopeQuery.ts` (pure `buildDefaultScopeJql` targeting the PI field by `cf[<num>]` id + `applyScopeFilters` + `ScopeFilters` type) to pass T006
- [X] T008 [US1] Rework `client/src/views/FeatureCanvas/canvas/useCanvasFeatures.ts` to be JQL-driven: hold `jql` + a `surfaceGeneration` trigger, seed the default JQL via `buildDefaultScopeJql` from resolved team/project/PI, fetch via `fetchFeatureReviewItemsByJql` on surface (and once on mount), keep the existing result shape; update its sibling test `useCanvasFeatures.test.ts` (default surface, no-team guard preserved)
- [X] T009 [P] [US1] Write RED component test `client/src/views/FeatureCanvas/canvas/SurfaceScopeBar.test.tsx`: renders the pre-filled JQL input, the Surface button triggers a surface, and typing a refine filter narrows the shown set
- [X] T010 [US1] Implement `client/src/views/FeatureCanvas/canvas/SurfaceScopeBar.tsx` — JQL input (bound to the scope query), Surface button, and label/text/status refine-filter chips — to pass T009
- [X] T011 [US1] Render `SurfaceScopeBar` in a header region of `client/src/views/FeatureCanvas/FeatureCanvasView.tsx`; apply `applyScopeFilters` to surfaced items before mapping; update `FeatureCanvasView.test.tsx` (scope bar present; refine narrows nodes; **re-surfacing to a narrower set preserves the overlay arrangement — position/size/priority/box — of features that remain in scope, per FR-1.4 / U1**)
- [X] T012 [US1] Safe-failure handling: a malformed/unauthorized JQL surfaces zero features, shows a clear error, and does not mutate the overlay (FR-1.6); assert in `useCanvasFeatures.test.ts` / `FeatureCanvasView.test.tsx`

**Checkpoint**: Query-driven surfacing works end to end, fully operable with AI locked.

---

## Phase 4: User Story 2 — Hidden NL→JQL accelerator (Priority: P2)

**Goal**: With AI unlocked, describe the scope in words and get a proposed JQL to place in the box;
no stage depends on it.

**Independent Test**: With AI unlocked, the scope helper turns "features for PI 26.3 with the ENCUC
label" into a proposed JQL the user can accept (fills the box) or reject (no change); a malformed
reply errors and changes nothing; with AI locked the helper is absent.

- [X] T013 [P] [US2] Write RED tests in `client/src/views/FeatureCanvas/ai/canvasAiAssist.test.ts` for the new `scopeQuery` kind: prompt embeds project/PI context; parse accepts `{"kind":"scopeQuery","jql":"…"}` and rejects a missing/empty `jql` or wrong kind with a descriptive error
- [X] T014 [US2] Add the `scopeQuery` kind to `client/src/views/FeatureCanvas/ai/canvasAiAssist.ts` (`buildCanvasAiPrompt` + `parseCanvasAiResponse` returning `{ jql }`) to pass T013
- [X] T015 [US2] Add a passphrase-gated NL→JQL control to `client/src/views/FeatureCanvas/canvas/SurfaceScopeBar.tsx` (guarded by `aiAssistStore.isAiAssistUnlocked`): copy-prompt + paste-reply → propose JQL → accept places it in the box, reject is a no-op; extend `SurfaceScopeBar.test.tsx` (absent when locked; accept fills the box; malformed reply errors and changes nothing)

**Checkpoint**: The owner can scope conversationally; manual parity holds with AI locked.

---

## Phase 5: User Story 3 — AI-tools access hardening (Priority: P3, Area 2 — independent)

**Goal**: Unlocking admin reveals no AI; admin requires entered credentials; the Dev Panel is behind
admin; the Ctrl+Alt+Z passphrase path is preserved.

**Independent Test**: Unlock admin (password) → no "Hidden prompt tools" or any AI reference; empty
fields do not unlock; valid creds unlock and reveal SNow config + Dev Panel; Ctrl+Alt+Z still enables
the AI tools.

- [X] T016 [P] [US3] Write RED/updated tests in `client/src/views/AdminHub/AdminHubView.test.tsx` (and `hooks/useAdminHubState.test.ts` if present): after admin unlock there is no "Hidden prompt tools" control; clicking Unlock with empty username/password does not unlock; valid credentials unlock; the Dev Panel is hidden when admin is locked and shown when unlocked
- [X] T017 [US3] Remove the "Hidden prompt tools" checkbox and its props from `client/src/views/AdminHub/AdminHubView.tsx` (the `flag-ai-features` block and the `isAiEnabled`/`onToggleFeatureFlag('isAiEnabled')` prop plumbing)
- [X] T018 [US3] Remove `isAiEnabled` / `FEATURE_AI_KEY` (`tbxFeatureAIVisible`) from `client/src/views/AdminHub/hooks/useAdminHubState.ts` — delete the constant, the `FeatureFlags.isAiEnabled` field, its init, and its `toggleFeatureFlag` branch (only `isSnowIntegrationEnabled` remains); update the `AdminHubView.test.tsx` fixture
- [X] T019 [US3] Fix the silent unlock in `client/src/views/AdminHub/hooks/useAdminHubState.ts` `tryUnlock`: require non-empty entered username and password, drop the `|| DEFAULT_ADMIN_USERNAME` / `|| DEFAULT_ADMIN_PASSWORD` fallbacks, and on empty input set the unlock error without POSTing
- [X] T020 [US3] Gate the Dev Panel behind `isAdminUnlocked` in `client/src/views/AdminHub/AdminHubView.tsx` (hide the Dev Panel tab and its panel when admin is locked); leave SNow/GitHub proxy, connectivity credentials, advanced controls, and developer utilities gating unchanged
- [X] T021 [US3] Confirm (in tests where feasible) the **preserved** paths: the Ctrl+Alt+Z passphrase machinery + the ⚡ AI Assist tab remain owner-only and functional, and the admin-gated operational features are unchanged (no regression)

**Checkpoint**: Admin unlock is credential-gated and AI-free; the passphrase is the sole AI path.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 [P] Update `CHANGELOG.md`: an **Added** entry for Area 1 (Surface JQL scoping + refine filters + hidden NL→JQL) and a **Fixed/Changed** entry for Area 2 (removed the admin "Hidden prompt tools" checkbox/flag, fixed the silent admin unlock, gated the Dev Panel behind admin) — Article VI
- [X] T023 [P] Run `quickstart.md` scenarios V1–V11 (AI locked and unlocked); fix any gaps
- [X] T024 Ensure every **new** source file has a colocated sibling test (pre-commit gate), then run `npm run test`, `npm run lint`, and `npm run build` — all green

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → **Foundational (P2)** blocks **US1** and **US2** (Area 1 data backbone).
- **US1 (P3.x)** depends on Foundational; **US2** depends on US1 (the scope bar it extends).
- **US3 (Area 2)** depends on **nothing** in this feature — it can be implemented and shipped first.
- **Polish** depends on the stories you chose to ship.

### Within each story

- Tests are written RED before implementation (Article V).
- Pure logic (`scopeQuery.ts`, `canvasAiAssist` parsing, the data-path functions) before the
  components/hooks that consume it.

### Parallel opportunities

- Foundational T002 (tests) runs alongside nothing blocking; T003/T004 are different files (can be
  parallel), T005 depends on both.
- US1: T006 ∥ T009 (different test files); implementations follow.
- **US3 is fully parallel to Area 1** — a second developer can do US3 while Area 1 proceeds (different
  files entirely: AdminHub vs FeatureCanvas).

---

## Parallel Example: ship Area 2 first

```bash
# US3 touches only AdminHub files and is independent — a fast security-first slice:
Task: "T016 RED admin tests (no AI on unlock; no empty-field unlock; Dev Panel gated)"
Task: "T017 remove Hidden prompt tools checkbox"
Task: "T018 remove isAiEnabled/FEATURE_AI_KEY flag"
Task: "T019 require entered admin credentials"
Task: "T020 gate Dev Panel behind admin"
```

---

## Implementation Strategy

### Ship-first option (recommended): Area 2 (US3)

US3 is small, security-relevant, and independent. Setup → US3 → Polish (partial) is a complete,
releasable increment on its own (removes the AI leak on admin unlock + closes the silent-unlock hole
+ gates the Dev Panel).

### Then Area 1 incrementally

Foundational → US1 (query-driven surfacing, the headline feature) → **STOP & validate** (V1–V5) →
US2 (NL→JQL accelerator, owner-only). Each is independently testable.

### Notes

- `[P]` = different files, no dependency on an incomplete task.
- `isAiEnabled`/`tbxFeatureAIVisible` is an orphan (zero external consumers) — removal needs no rewire.
- Keep the Ctrl+Alt+Z passphrase + ⚡ tab intact — they are owner-only and never shown on admin unlock.
- No server change; no new dependency; nothing writes to Jira in Area 1 beyond the existing read path.
