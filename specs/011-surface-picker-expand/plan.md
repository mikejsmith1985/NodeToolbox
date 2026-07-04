# Implementation Plan: Blueprint-First Surfacing, a Curated Canvas, and Expandable Nodes

**Branch**: `feature/surface-picker-expand` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-surface-picker-expand/spec.md`

## Summary

Redesign how work reaches the Feature Canvas and how it is inspected, fixing a real cross-project bug and three
UX/coaching problems from v0.29.0:

- **Blueprint-first picker (Area 1).** Replace the same-project default query with a **picker** whose default
  source is the org's existing **cross-project blueprint** (`fetchBlueprintHierarchy`), grouped Program Epic →
  Feature. The user **selects** which features to add (checkboxes + select-all + search). Custom JQL is a
  secondary source that feeds the same picker.
- **Additive, curated canvas (Area 2).** Invert the data flow: the canvas renders the **overlay's node set**
  (the persisted working set) and fetches live data for exactly those keys. Adding is additive (dedup by key);
  a new `removeNode` mutator + a per-node ✕ prunes the set. A new surface never overwrites.
- **Read-only side inspector (Area 3).** A docked inspector shows the selected node's epic detail + its child
  records, rendered entirely from the existing `CanvasNode` (no new fetch).
- **Remove 010's refine chips.** The label/text/status chips are retired; their find-features role moves into
  the picker's search.

**Technical approach** (from research):
- **Picker sources**: blueprint via `fetchBlueprintHierarchy([team], piName)` → `BlueprintProgramEpicNode[]`
  (the only source carrying PE grouping and showing *all* in-scope features, not the `children>0` subset);
  custom JQL via the existing `fetchFeatureReviewItemsByJql(jql)`. The picker needs only key/summary/status/
  health/child-count per feature (no hygiene), so the blueprint path is sufficient and light.
- **Working-set flip**: scope resolution and the working-set fetch are **split** to avoid a circular dependency
  (the overlay's `scopeKey` needs `projectKey`/`piName`, and the fetch needs the overlay's keys). A new
  `useCanvasScope()` resolves `team`/`projectKey`/`piName`/`boardId` from settings + ART context (no fetch); the
  view uses it to build the overlay `scopeKey`, reads `Object.keys(overlay.nodes)`, and passes those keys to the
  now **key-driven** `useCanvasFeatures(keys)`, which fetches `fetchFeatureReviewItemsByJql('issuekey in
  (…keys)')` for the working set. The overlay's `ensureNodeStates` already accumulates without overwriting;
  `mapFeaturesToNodes` still joins by `item.feature.key`. Because commit consumes `canvasNodes` (now derived from
  overlay membership), removing a node cleanly drops it from the canvas *and* any commit.
- **Inspector**: a new `NodeInspectorPanel` renders the `selectedNode: CanvasNode` (summary, status, assignee,
  size/points, health, completion, hygiene, links, and `childStories`) — read-only, no new fetch.
- **Removal**: add `removeNode(issueKey)` to `useCanvasOverlay` (mirrors `removeContainer`) + a ✕ affordance
  on the node (mirrors `ContainerNode`), clearing selection on remove.
- **No new dependency.**

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19 (client SPA). Backend unchanged.

**Primary Dependencies**: **None new.** Reuses `blueprintHierarchy` (`fetchBlueprintHierarchy`,
`flattenProgramEpicFeatures`), `featureReview` (`fetchFeatureReviewItemsByJql`, `fetchFeatureReviewFieldConfig`),
the ART context helpers (`findMatchingArtTeam`, `readStoredArtTeams`, `readFallbackSelectedPiName`), the canvas
overlay + `mapFeaturesToNodes`, the `aiAssistStore` gate (for the NL→JQL helper that moves into the picker), and
React Flow.

**Storage**: No change. The overlay (localStorage) already **is** the working set — its `nodes` map keys are the
features on the canvas. No server change; no new persisted entity. The picker candidates are transient (not
persisted).

**Testing**: Vitest + `@testing-library/react` + `user-event`. Colocated sibling tests. Pure logic (candidate
mapping, picker selection/dedup) unit-first; component tests for the picker, inspector, node removal, and the
working-set view; refactor of the existing `useCanvasFeatures` / view / `scopeQuery` tests for the removed
refine chips.

**Target Platform**: Desktop web browser (SPA).

**Project Type**: Web — React SPA (`client/`). Frontend-only; no server change.

**Performance Goals**: Picker lists the in-scope hierarchy (tens–low-hundreds of features) responsively. The
working-set fetch uses `issuekey in (keys)`; `fetchFeatureReviewItemsByJql` caps at `maxResults=200`, so a
working set beyond ~200 features must batch the key list (see research R6) — acceptable, as a curated triage
canvas rarely exceeds that.

**Constraints**:
- **Additive, non-destructive** — a surface never removes/resets existing nodes; only explicit `removeNode`
  does. No unintended node loss across surfaces.
- **Read-only inspection** — the inspector never edits Jira or the overlay.
- **Cross-project correctness** — surfacing must use the blueprint parent-walk, never a same-project issue-type
  assumption.
- **Manual parity** — the picker (blueprint + custom JQL) works with no AI; the NL→JQL helper stays additive
  and passphrase-gated.
- **Minimal footprint** — no new dependency; reuse existing fetch + overlay + node model.

**Scale/Scope**: A curated working set of up to ~200 feature nodes; single operator.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ On `feature/surface-picker-expand` |
| IV — Code Quality | Self-documenting names, small functions, doc/purpose comments | ✅ New components/hooks decompose into small units; enforced during implementation |
| V — Testing | TDD; fast mocked units; real-events UX | ✅ Pure candidate/selection logic unit-first; RTL for picker/inspector/removal |
| VI — Documentation | CHANGELOG is source of truth; no ad-hoc docs | ✅ CHANGELOG entry at implementation; only `specs/011-*` pipeline artifacts here |
| VII — Framework-First | Don't rebuild what the codebase provides | ✅ **Reuse-only** — blueprint fetch, JQL fetch, overlay, node mapping, inspector-from-existing-data; no new infra/deps |
| VIII — Release | Local pipeline only | ✅ N/A until release (`scripts/local-release.ps1`) |
| IX — Vault | No secret in conversation/file/log | ✅ No secrets handled |
| X — Verification | Evidence, not "it compiles" | ✅ `quickstart.md` defines behavioral checks (cross-project surface, additive build-up, node removal, inspector) |
| XI — Output Restraint | ≤1 dashboard artifact; no phase narration | ✅ No dashboard artifact involved |

**Framework-First note (Article VII)**: No new abstraction. The picker's blueprint source is the *existing*
cross-project `fetchBlueprintHierarchy`; the custom-query source is the *existing* `fetchFeatureReviewItemsByJql`;
the inspector renders the *existing* `CanvasNode`; removal mirrors the *existing* `removeContainer`. The main work
is a data-flow **inversion** (query-driven → membership-driven), not new machinery. No custom-vs-framework tension;
the Complexity Tracking table is not required.

**Result: PASS (initial and post-design).**

## Project Structure

### Documentation (this feature)

```text
specs/011-surface-picker-expand/
├── plan.md              # This file
├── spec.md              # Feature spec (Q1=A, Q2=A, Q3=A; inspector=side-panel; refine chips removed)
├── research.md          # Phase 0 — decisions + rationale
├── data-model.md        # Phase 1 — picker candidate + working-set + inspector entities
├── quickstart.md        # Phase 1 — behavioral validation guide
├── contracts/
│   ├── picker-sources.md    # Blueprint + custom-JQL candidate contracts
│   └── canvas-workingset.md # Working-set fetch, add/remove, inspector data
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/views/FeatureCanvas/
├── canvas/
│   ├── usePickerCandidates.ts       # NEW: fetch blueprint PE→Feature (grouped) + custom-JQL candidates
│   ├── SurfacePicker.tsx            # NEW: picker panel — Blueprint / Custom-JQL sources, search, multi-select, Add
│   ├── pickerModel.ts              # NEW (pure): PickerFeature/PickerGroup mapping + selection/dedup helpers
│   ├── NodeInspectorPanel.tsx      # NEW: read-only side inspector for the selected node (epic + children)
│   ├── useCanvasScope.ts           # NEW: resolve team/project/PI/board (no fetch) → used to build overlay scopeKey
│   ├── useCanvasFeatures.ts        # REFACTOR: key-driven working-set fetch (issuekey in keys); takes keys as input
│   ├── FeatureNode.tsx             # +✕ remove affordance (mirror ContainerNode); selection still drives inspector
│   ├── FeatureCanvasBoard.tsx      # thread onDeleteNode; onSelect already drives selection
│   ├── SurfaceScopeBar.tsx         # REMOVED (JQL box moves into the picker; refine chips retired)
│   ├── NlToJqlControl.tsx          # moves into the picker's Custom-JQL source (still passphrase-gated)
│   └── scopeQuery.ts               # remove ScopeFilters/EMPTY_SCOPE_FILTERS/applyScopeFilters; KEEP buildDefaultScopeJql
├── overlay/
│   └── useCanvasOverlay.ts         # +removeNode(issueKey) mutator (mirror removeContainer)
└── FeatureCanvasView.tsx           # restructure: "Add features" opens SurfacePicker; render NodeInspectorPanel
                                    # for the selected node; canvasNodes from overlay keys; drop refine-chip chain
```

**Structure Decision**: The **picker** is a focused "add work" surface (a panel/drawer opened by an *Add
features* action), not a always-on bar — surfacing is now a deliberate, occasional action, so it should not
occupy permanent canvas real estate. It has two sources (Blueprint default, Custom JQL) behind a simple toggle,
plus a search box (replacing 010's refine chips). The **inspector** is a docked side panel driven by the existing
`selectedIssueKey`. The **working-set inversion** splits scope resolution (`useCanvasScope`, so the view can build
the overlay `scopeKey` before it has keys) from the key-driven fetch (`useCanvasFeatures(keys)`), and the view
builds `canvasNodes` from the overlay keys (removing the refine/`boardNodes` narrowing). Pure logic (`pickerModel`
mapping + selection/dedup) is isolated for <10ms unit tests; Jira I/O stays in the fetch hooks.

## Complexity Tracking

> Not required — Constitution Check passes with no violations. No new dependencies or abstractions; the change
> reuses existing fetches/overlay/node model and inverts one data flow.
