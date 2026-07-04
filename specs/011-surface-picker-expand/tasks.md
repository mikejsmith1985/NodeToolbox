# Tasks: Blueprint-First Surfacing, a Curated Canvas, and Expandable Nodes

**Input**: Design documents from `specs/011-surface-picker-expand/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: INCLUDED (constitution Article V mandates TDD). Every new pure module and each user story carries tests
written **RED first**. **Repo pre-commit gate**: every *new* source file needs a colocated sibling
`<name>.test.ts(x)` — factored in below.

**Organization**: Three areas. The **working-set inversion** (canvas renders from overlay membership) is the
coupled core, so it lands inside US1 alongside the picker — that pair is the MVP. US2 (node removal) and US3
(inspector) build on it.

## Story → Phase map

| Phase | User Story | Spec stories | Area | Priority |
|-------|-----------|--------------|------|----------|
| 3 | US1 Blueprint picker + working-set inversion | A, B, E (+ additive of C) | 1 & 2 | P1 🎯 MVP |
| 4 | US2 Node removal | C (remove) | 2 | P2 |
| 5 | US3 Node inspector | D | 3 | P3 |

## Path conventions

Frontend-only, no server change. Paths under `client/src/views/FeatureCanvas/`. Tests are colocated siblings and
run with `npm run test` (Vitest + RTL).

---

## Phase 1: Setup

- [X] T001 Confirm the working branch is `feature/surface-picker-expand` and that **no new dependency** is required (reuse-only); `client/package.json` is unchanged by this feature.

---

## Phase 2: Foundational (small shared pieces — pure picker model + node-remove mutator)

**Purpose**: The pure selection logic US1 consumes and the overlay mutator US2 consumes. Both are additive and do
not change existing behavior.

- [X] T002 [P] Write RED unit tests in `client/src/views/FeatureCanvas/canvas/pickerModel.test.ts`: map `BlueprintProgramEpicNode[]` → `PickerGroup[]` (PE grouping, `childCount = children.length + offTrain.length`), map `FeatureReviewItem[]` → a single "Custom query" group, `isAlreadyOnCanvas` from an overlay key set, client-side `search` filter (key/summary/label), `selectAll`/`clearAll`, and `add-set = selected ∩ not-already-on-canvas`
- [X] T003 Implement `client/src/views/FeatureCanvas/canvas/pickerModel.ts` (pure: `PickerFeature`/`PickerGroup` types + mapping/selection/dedup/search helpers) to pass T002
- [X] T004 [P] Write RED test in `client/src/views/FeatureCanvas/overlay/useCanvasOverlay.test.ts`: `removeNode(issueKey)` deletes exactly that node from `overlay.nodes`, leaves other nodes and all containers untouched, and persists
- [X] T005 Implement `removeNode(issueKey)` in `client/src/views/FeatureCanvas/overlay/useCanvasOverlay.ts` (mirror `removeContainer`: return `{ …overlay, nodes: <copy without issueKey> }`; add to the controller interface and both `useMemo` dependency arrays)

**Checkpoint**: Pure picker mapping/selection ready; the overlay can drop a node.

---

## Phase 3: User Story 1 — Blueprint picker + working-set inversion (Priority: P1) 🎯 MVP

**Goal**: Add work to the canvas by selecting from the in-scope blueprint (cross-project), additively; custom JQL
is a secondary source; the canvas renders the persisted working set (never overwritten by a surface).

**Independent Test**: With features in a separate project, open the picker → it lists the in-scope features
grouped by Program Epic → check some → Add → exactly those appear; add more later → all accumulate; a bad custom
query errors and adds nothing.

- [X] T006 [P] [US1] Write RED tests in `client/src/views/FeatureCanvas/canvas/usePickerCandidates.test.ts` (mock `fetchBlueprintHierarchy` + `fetchFeatureReviewItemsByJql`): blueprint mode returns PE-grouped candidates; jql mode returns a single "Custom query" group; a bad jql sets an error and returns no groups
- [X] T007 [US1] Implement `client/src/views/FeatureCanvas/canvas/usePickerCandidates.ts` — blueprint source via `fetchBlueprintHierarchy([team], piName)` → groups (using `pickerModel`) with a **no-team** state (no team resolved → blueprint returns no groups so the picker can show the configure-ART guidance), custom-JQL source via `fetchFeatureReviewItemsByJql(jql)` → single group (works regardless of team, per G1), with loading/error states — to pass T006
- [X] T008 [P] [US1] Write RED component test `client/src/views/FeatureCanvas/canvas/SurfacePicker.test.tsx`: renders grouped candidates; checking rows + Add calls `onAdd` with the selected keys; already-added rows are disabled; the search box narrows the list; the source toggle switches blueprint/JQL; a bad JQL shows an error and Add is a no-op; **and (per G1) when no ART team is configured, the Blueprint source shows the configure-ART empty state while the Custom-JQL source still lists and adds candidates (fallback)**
- [X] T009 [US1] Implement `client/src/views/FeatureCanvas/canvas/SurfacePicker.tsx` — a panel/drawer with a Blueprint/Custom-JQL source toggle, a search box, a grouped selectable checklist (select-all/clear-all), and an **Add** action; the Custom-JQL mode embeds the passphrase-gated `NlToJqlControl` — to pass T008
- [X] T010 [US1] Resolve the scope/keys circular dependency (per I1): **extract `client/src/views/FeatureCanvas/canvas/useCanvasScope.ts`** that resolves `team`/`projectKey`/`piName`/`boardId` from settings + ART context with **no fetch** (moving that logic out of `useCanvasFeatures`), and **refactor `useCanvasFeatures.ts` to be key-driven** — it now **takes the working-set keys as input** and fetches `fetchFeatureReviewItemsByJql('issuekey in (<keys>)')` (batch into ≤200-key chunks per research R6; empty keys → status ready, `items: []`). Add sibling test `useCanvasScope.test.ts` and update `useCanvasFeatures.test.ts` (key-driven fetch)
- [X] T011 [US1] Restructure `client/src/views/FeatureCanvas/FeatureCanvasView.tsx`: use `useCanvasScope()` to build the overlay `scopeKey`, then pass `Object.keys(overlay.nodes)` into `useCanvasFeatures(keys)`; add an **"Add features"** control (in the canvas header where the removed scope bar was) that opens `SurfacePicker`; on Add call `controller.ensureNodeStates(selectedKeys.map(createNodeState))`; build `canvasNodes` from the working-set items; render the board from `canvasNodes` directly; show an empty "Add features to begin" state when the working set is empty; update `FeatureCanvasView.test.tsx`
- [X] T012 [US1] Retire feature 010's refine chips: remove `ScopeFilters`/`EMPTY_SCOPE_FILTERS`/`applyScopeFilters`/`readIssueLabels` from `client/src/views/FeatureCanvas/canvas/scopeQuery.ts` (KEEP `buildDefaultScopeJql`); **delete** `client/src/views/FeatureCanvas/canvas/SurfaceScopeBar.tsx` + `SurfaceScopeBar.test.tsx` (its JQL box now lives in the picker); update `canvas/scopeQuery.test.ts` to drop the removed helpers
- [X] T013 [US1] Additive + safe-failure assertions: adding accumulates and dedups (already-added is a no-op; SC-3/SC-4), and a bad custom query adds nothing + errors (SC-7) — assert in `SurfacePicker.test.tsx` / `FeatureCanvasView.test.tsx`

**Checkpoint**: Cross-project surfacing works via deliberate, additive selection; custom JQL feeds the same picker.

---

## Phase 4: User Story 2 — Remove a node from the canvas (Priority: P2)

**Goal**: Prune the curated working set by removing an individual feature node; other nodes and Jira are unaffected.

**Independent Test**: Remove a feature node → it disappears; other nodes keep their arrangement; the removed node
no longer appears in Review & Commit; nothing changes in Jira.

- [X] T014 [P] [US2] Write RED test in `client/src/views/FeatureCanvas/canvas/FeatureNode.test.tsx`: the node card renders a ✕ **remove** control that fires `onDelete` and is absent when no handler is provided
- [X] T015 [US2] Add the ✕ remove affordance to `client/src/views/FeatureCanvas/canvas/FeatureNode.tsx` (mirror `ContainerNode`'s `nodrag` ✕ button); thread `onDeleteNode` through `client/src/views/FeatureCanvas/canvas/FeatureCanvasBoard.tsx` → `FeatureCanvasView.tsx` → `controller.removeNode`; clear `selectedIssueKey` when the removed node was selected
- [X] T016 [P] [US2] Write test in `client/src/views/FeatureCanvas/FeatureCanvasView.test.tsx`: removing a node drops it from the rendered board and (since commit reads `canvasNodes`) it would not appear in a commit; other nodes and their arrangement are unaffected

**Checkpoint**: The working set is curatable — add to build up, remove to prune, never overwritten.

---

## Phase 5: User Story 3 — Read-only node inspector (Priority: P3)

**Goal**: Inspect a feature node's epic detail and its child records in a docked side panel, read-only.

**Independent Test**: Open a node → a side inspector shows the epic detail + child records; opening another node
replaces it; no field is editable; dismissing closes it.

- [X] T017 [P] [US3] Write RED component test `client/src/views/FeatureCanvas/canvas/NodeInspectorPanel.test.tsx`: given a `CanvasNode`, renders the epic detail (summary/status/assignee/size/points/health/completion/hygiene/links) and a list of its `childStories` (key/summary/status/points); renders nothing when no node is selected; contains no editable field
- [X] T018 [US3] Implement `client/src/views/FeatureCanvas/canvas/NodeInspectorPanel.tsx` — a read-only docked side panel rendering the selected `CanvasNode` and its `childStories` — to pass T017
- [X] T019 [US3] Wire `NodeInspectorPanel` into `client/src/views/FeatureCanvas/FeatureCanvasView.tsx` for the currently `selectedNode` (opens on select, shows one node at a time, dismiss closes it); update `FeatureCanvasView.test.tsx`

**Checkpoint**: Inspect any node's epic + children in place; the collapsed board stays scannable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Update `CHANGELOG.md`: an entry covering the blueprint-first picker (cross-project fix + deliberate selection), the additive/curated canvas with per-node removal, the read-only node inspector, and the retirement of feature 010's refine chips (Article VI)
- [X] T021 [P] Run `quickstart.md` scenarios V1–V11 (AI locked and unlocked); fix any gaps
- [X] T022 Ensure every **new** source file has a colocated sibling test; confirm no dangling references to `applyScopeFilters`/`SurfaceScopeBar`; run `npm run test`, `npm run lint`, and `npm run build` — all green

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → **Foundational (P2)**: `pickerModel` (pure) blocks US1; `removeNode` blocks US2.
- **US1 (P3)** depends on Foundational (`pickerModel`) and is the coupled picker + working-set inversion + 010
  cleanup. It is the MVP.
- **US2 (P4)** depends on the US1 working-set inversion (so removal drops from `canvasNodes`/commit) and on
  Foundational `removeNode`.
- **US3 (P5)** depends on the US1 inversion (`selectedNode` from `canvasNodes`); otherwise independent of US2.
- **Polish (P6)** depends on the stories shipped.

### Within each story

- Tests are written RED before implementation (Article V).
- Pure logic (`pickerModel`) and the fetch hook (`usePickerCandidates`) before the components that consume them.

### Parallel opportunities

- Foundational: T002 ∥ T004 (different files); implementations follow.
- US1: T006 ∥ T008 (distinct test files); T007 before T009 (picker uses candidates); T010/T011/T012 touch the
  view + hook and are sequential.
- US2 and US3 are independent of each other (FeatureNode/board vs NodeInspectorPanel) — parallelizable once US1
  lands.

---

## Parallel Example: Foundational

```bash
Task: "T002 RED tests canvas/pickerModel.test.ts"
Task: "T004 RED test overlay/useCanvasOverlay.test.ts (removeNode)"
```

---

## Implementation Strategy

### MVP (US1)

Setup → Foundational → US1 delivers the headline value: **add features via the blueprint picker (cross-project),
selecting deliberately, additively** — plus the working-set inversion and the 010 cleanup. **STOP & validate**
(quickstart V1–V7) before proceeding.

### Then incrementally

US2 (node removal) → US3 (inspector). Each is an independently testable increment that builds on the US1 working
set.

### Notes

- `[P]` = different files, no dependency on an incomplete task.
- The overlay's `nodes` map is the single source of canvas membership; `ensureNodeStates` (additive) and the new
  `removeNode` are the only membership mutations. A surface never overwrites.
- Keep `buildDefaultScopeJql` (picker JQL prefill); remove the rest of the 010 refine machinery.
- The working-set fetch caps at 200 per call — batch the `issuekey in (…)` list; never silently truncate.
- No server change; no new dependency; the inspector needs no new fetch.
