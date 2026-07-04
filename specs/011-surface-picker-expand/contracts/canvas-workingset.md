# Contract: Curated Working Set + Node Inspector (Areas 2 & 3)

Defines the data-flow inversion (canvas = overlay membership), node removal, and the read-only inspector. No new
server endpoint; no new dependency.

---

## 1. Working-set fetch (membership-driven)

- **Scope resolution is split from the fetch** to avoid a circular dependency (the overlay `scopeKey` needs
  `projectKey`/`piName`, and the fetch needs the overlay's keys). A `useCanvasScope()` hook resolves
  `team`/`projectKey`/`piName`/`boardId` from settings + ART context with **no fetch**. The view uses it to build
  the overlay `scopeKey` (`deriveScopeKey(projectKey, piName)`), loads the overlay, then reads its node keys.
- The canvas's live data is fetched for **exactly the overlay's node keys** (`Object.keys(overlay.nodes)`), not
  for a free-form query.
- `useCanvasFeatures(keys)` (refactored — takes the keys as input) fetches:
  `fetchFeatureReviewItemsByJql('issuekey in (<comma-separated overlay keys>)')` → `FeatureReviewItem[]`.
  - Empty working set → no fetch; status `ready`, `items: []` (empty canvas + "Add features" empty state).
  - **>200 keys**: batch the `issuekey in (…)` list into ≤200-key chunks and merge results (the fetch caps at
    `maxResults=200`, `featureReview.ts:301`). Never silently truncate.
- The view builds `canvasNodes = mapFeaturesToNodes(items, overlay)` — one node per item, joined by
  `item.feature.key` (`nodeMapping.ts:99`), unchanged. The refine-chip `boardNodes` narrowing is removed; the
  board renders `canvasNodes` directly.

## 2. Add / remove semantics

| Action | Effect |
|--------|--------|
| Add (from picker) | `ensureNodeStates(keys)` adds new keys to `overlay.nodes` (additive, dedup). Next working-set fetch includes them. |
| `removeNode(issueKey)` | Deletes `overlay.nodes[issueKey]` → the key leaves the working set → the node leaves `canvasNodes` on the next render → it leaves the commit diff (commit reads `canvasNodes`). Clears `selectedIssueKey` if it was the removed node. **Overlay-only; never touches Jira.** |

- `removeNode` mirrors `removeContainer` (`useCanvasOverlay.ts:106-122`) and is added to the controller
  interface + its `useMemo` dependency arrays.
- UI: a ✕ affordance on the feature node (mirroring `ContainerNode`'s `nodrag` ✕, `ContainerNode.tsx:67-82`)
  and/or a Remove action in the inspector.

## 3. Node inspector (read-only)

- Input: the `selectedNode: CanvasNode | null` already resolved in the view (`FeatureCanvasView.tsx:85`).
- Renders (read-only, no fetch):
  - **Epic detail**: key, summary, status, assignee, size/points (`size`/`storyPoints`/`effectivePoints`),
    health, `completionPercent`, `hygieneFlags`, `dependencies` (links).
  - **Child records**: `node.childStories` — each `{ key, summary, status, statusCategoryKey, storyPoints }`.
- Behavior: opening another node replaces the panel contents; dismissing closes it and returns focus to the
  board. Exactly one node inspected at a time (selection-driven, per the clarification).
- **No field is editable**; the inspector mutates neither Jira nor the overlay.

## 4. Removed (feature 010 cleanup)

- The `SurfaceScopeBar` refine chips and the view's `filters`/`applyScopeFilters`/`filteredKeys`/`boardNodes`
  chain are removed. `ScopeFilters`/`EMPTY_SCOPE_FILTERS`/`applyScopeFilters` are retired from `scopeQuery.ts`.
- `buildDefaultScopeJql` is **kept** for the picker's custom-JQL default prefill.

## Behavioral acceptance (maps to spec)

- Cross-project surfacing lists real features (SC-1); nothing added without a choice (SC-2).
- A new surface never removes/resets existing nodes; only `removeNode` removes (SC-3).
- Adding a present feature yields exactly one node (SC-4).
- Inspect epic + children from a node in one action, read-only (SC-5); collapsed board stays scannable (SC-6).
- Bad custom query adds nothing + errors (SC-7).
