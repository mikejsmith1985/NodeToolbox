# Quickstart & Validation Guide: Blueprint-First Surfacing, Curated Canvas, Expandable Nodes

Proves the redesign works and maps each check to a Success Criterion (SC) / requirement (FR). Validation/run
guide only — implementation detail lives in `tasks.md`.

## Prerequisites

- Client running: `cd client && npm install && npm run dev` (no new dependency).
- An **ART team matched to a board + a selected PI** whose **features/epics live in a separate project** from the
  team's stories (the real topology that broke v0.29.0's default). This is what proves the blueprint fix.

## Build & test gates

```powershell
cd client
npm run test    # Vitest: pure-logic + component tests pass
npm run lint    # ESLint clean
npm run build   # tsc -b && vite build succeed (FeatureCanvas lazy chunk intact)
```

Article V (TDD): the pure units below are written red-first.
- `canvas/pickerModel.ts` — map `BlueprintProgramEpicNode[]` → `PickerGroup[]` (grouping, child count),
  `FeatureReviewItem[]` → single "Custom query" group; `isAlreadyOnCanvas` from an overlay key set; search
  filter; select-all/clear-all; Add = selected ∩ not-already-on-canvas.
- `overlay/useCanvasOverlay` — `removeNode` drops exactly one key; other nodes/containers untouched.

## Behavioral validation

### Area 1 — Blueprint-first picker

- **V1 — Cross-project surfacing (SC-1, FR-1)**: Open the canvas → press **Add features** → the picker's
  Blueprint source lists the in-scope features (parents of the PI-scoped team work, from a *different* project),
  grouped Program Epic → Feature — **not empty**.
- **V2 — Deliberate selection (SC-2, FR-2)**: With 12 features listed, check 4 → **Add** → exactly those 4
  appear on the canvas; the other 8 do not.
- **V3 — Select-all**: Choose select-all → Add → every listed feature is added in one action.
- **V4 — Picker search (FR-2.3)**: Type in the picker's search → the candidate list narrows by key/summary/label;
  clearing restores it. (There is no longer a canvas-level refine bar.)
- **V5 — Custom JQL feeds the picker (FR-3, E)**: Switch the picker to Custom JQL, run a query → matches appear
  in the same checklist to select from (not auto-dumped); a bad query shows an error and adds nothing.

### Area 2 — Curated, additive canvas

- **V6 — Additive build-up (SC-3, FR-4)**: With 4 features arranged, open the picker again and add 3 more → all 7
  are present and the original 4 keep their position/size/priority/box.
- **V7 — Duplicate skip (SC-4, FR-4)**: A feature already on the canvas shows as **already added** in the picker
  and cannot be added twice; adding leaves exactly one node for it, unchanged.
- **V8 — Remove a node (FR-5)**: Remove a feature node (✕ / inspector Remove) → it disappears from the canvas;
  other nodes and their arrangement are untouched; nothing changes in Jira. A later Review & Commit no longer
  lists the removed node.

### Area 3 — Node inspector

- **V9 — Inspect epic + children (SC-5, FR-6)**: Open a feature node → a docked side inspector shows the epic's
  detail (summary, status, assignee, size/points, health, completion, hygiene, links) and a list of its **child
  records** with each child's status and points.
- **V10 — One at a time + read-only**: Open a second node → the inspector shows the new node (not both); no field
  is editable; dismissing closes the panel. Jira and the overlay are unchanged.
- **V11 — Scannability (SC-6)**: With no node open, the board is as scannable as before — detail appears only in
  the inspector, on demand.

## Done (feature-level acceptance)

V1–V11 pass; the three build/test/lint gates are green; `CHANGELOG.md` has an entry (Article VI). A **live-board
smoke** against the real cross-project topology is the recommended final check (it exercises the real blueprint
parent-walk that mocks stand in for).
