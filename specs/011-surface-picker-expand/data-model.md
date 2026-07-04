# Phase 1 Data Model: Blueprint-First Surfacing, Curated Canvas, Expandable Nodes

Mostly UI + data-flow inversion. It introduces small **transient** picker shapes and **reuses** existing types
(`BlueprintProgramEpicNode`/`BlueprintFeatureNode`, `FeatureReviewItem`, `CanvasNode`, `CanvasOverlay`). Nothing
new is persisted — the overlay's existing `nodes` map already **is** the working set.

---

## New (transient) shapes — the picker

### `PickerFeature` (a selectable candidate row)

Mapped from a `BlueprintFeatureNode` (blueprint source) or a `FeatureReviewItem` (custom-JQL source).

| Field | Type | Notes |
|-------|------|-------|
| `key` | `string` | Jira feature/epic key (the identity added to the canvas) |
| `summary` | `string` | Feature summary |
| `status` | `string` | Feature status name |
| `health` | `string` | `green \| yellow \| red \| blue \| gray` |
| `childCount` | `number` | `children.length` (in-train) `+ offTrain.length` when available |
| `programEpicKey` | `string \| null` | The parent PE key when grouped (blueprint source); `null` for custom-JQL |
| `programEpicSummary` | `string \| null` | PE display label when grouped |
| `isAlreadyOnCanvas` | `boolean` | Derived: `overlay.nodes[key] !== undefined` — shown as "already added", skipped on Add |

### `PickerGroup` (Program Epic grouping)

| Field | Type | Notes |
|-------|------|-------|
| `programEpicKey` | `string \| null` | `null` bucket for features with no PE (or the custom-JQL "Custom query" group) |
| `programEpicSummary` | `string` | Heading label |
| `features` | `PickerFeature[]` | Rows under this PE |

### `PickerState` (picker view state, not persisted)

| Field | Type | Notes |
|-------|------|-------|
| `source` | `'blueprint' \| 'jql'` | Active candidate source (default `blueprint`) |
| `jql` | `string` | Custom-query text (seeded from `buildDefaultScopeJql` for advanced users) |
| `search` | `string` | Client-side find-in-list filter (key / summary / label); replaces 010's refine chips |
| `selectedKeys` | `Set<string>` | Keys the user has checked to add |
| `status` | `'idle' \| 'loading' \| 'ready' \| 'error'` | Candidate fetch lifecycle |
| `error` | `string \| null` | Source/query error (e.g. bad JQL) |

**Validation**: `isAlreadyOnCanvas` rows are non-selectable (or shown disabled). "Add" adds only
`selectedKeys ∩ not-already-on-canvas`. An `error` state adds nothing and never touches the canvas.

### `PickerCandidates` (derived result of a source fetch)

| Field | Type | Derivation |
|-------|------|-----------|
| `groups` | `PickerGroup[]` | Blueprint → PE groups; custom-JQL → single "Custom query" group |
| `totalCount` | `number` | Total candidate features across groups |

---

## Reused domain types (unchanged)

- `BlueprintProgramEpicNode` / `BlueprintFeatureNode` (`blueprintHierarchy.ts`) — the blueprint picker source.
- `FeatureReviewItem` (`featureReview.ts`) — the custom-JQL picker source **and** the canvas working-set fetch.
- `CanvasNode` / `CanvasChildStory` (`logic/canvasTypes.ts`) — unchanged; the inspector reads these directly.
- `CanvasOverlay` / `CanvasNodeState` (`overlay/overlayModel.ts`) — **unchanged shape**; `nodes` is the working
  set. No schema change.

---

## Changed behavior (no new persisted entity)

### Working set = `overlay.nodes` keys (data-flow inversion)

| Item | Before | After |
|------|--------|-------|
| Scope resolution | inside `useCanvasFeatures` (which also fetched) | **extracted to `useCanvasScope()`** (no fetch) so the view can build the overlay `scopeKey` before it has keys (resolves the I1 circular dependency) |
| `canvasNodes` source | `mapFeaturesToNodes(features.items, overlay)` where `items` = last query (`FeatureCanvasView.tsx:68`) | `mapFeaturesToNodes(<live items for overlay node keys>, overlay)` — membership-driven |
| `useCanvasFeatures` fetch | `fetchFeatureReviewItemsByJql(currentJql)` (query-driven, resolved scope internally) | `useCanvasFeatures(keys)` fetches `fetchFeatureReviewItemsByJql('issuekey in (<overlay keys>)')` (key-driven; batched >200) |
| Board render set | `boardNodes` = `canvasNodes` narrowed by refine chips | `canvasNodes` directly (refine chips removed) |

### New overlay mutator

| Mutator | Behavior |
|---------|----------|
| `removeNode(issueKey)` | Returns `{ …overlay, nodes: <copy without issueKey> }`; drops the node from the canvas and (via `canvasNodes`) from any commit. Overlay-only — never touches Jira. Mirrors `removeContainer`. |

### Removed (feature 010 cleanup)

| Item | Change |
|------|--------|
| `ScopeFilters`, `EMPTY_SCOPE_FILTERS`, `applyScopeFilters`, `readIssueLabels` (`scopeQuery.ts:13-68`) | **Removed** |
| `SurfaceScopeBar` refine chips + `resultCount` (`SurfaceScopeBar.tsx:55-61`) | **Removed** (component retired; JQL box moves into the picker) |
| View `filters`/`filteredKeys`/`boardNodes` chain (`FeatureCanvasView.tsx:58,71-75`) | **Removed** |
| `buildDefaultScopeJql` (`scopeQuery.ts:27-36`) | **Kept** — the picker's custom-JQL default prefill |

---

## Relationships (summary)

- `PickerFeature.key` → the key added to `CanvasOverlay.nodes` (via `ensureNodeStates`), which becomes a
  `CanvasNode` once the working-set fetch resolves its live data.
- `PickerFeature.isAlreadyOnCanvas` = `CanvasOverlay.nodes[key] !== undefined` (dedup / already-added).
- `CanvasNode.childStories` (already populated) is what the inspector lists as **child records** — no fetch.
- `removeNode(key)` deletes `CanvasOverlay.nodes[key]` → the node leaves `canvasNodes` → leaves the commit diff.
