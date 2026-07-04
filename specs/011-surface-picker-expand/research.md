# Phase 0 Research: Blueprint-First Surfacing, Curated Canvas, Expandable Nodes

Grounded in the current codebase (file:line cited) and the resolved spec (Q1=A blueprint-first picker, Q2=A
additive, Q3=A select-from-list; inspector = side panel; 010 refine chips removed).

---

## R1 — Picker's blueprint source (grouped, all in-scope features)

**Decision**: The picker's default source is `fetchBlueprintHierarchy([team], piName)`
(`blueprintHierarchy.ts:1013`), returning `BlueprintProgramEpicNode[]` — each PE carrying its `features`
(`BlueprintFeatureNode[]`).

**Rationale**: This is the **only** source that (a) carries **Program Epic → Feature grouping** (required by
FR-1.1) and (b) shows **all** in-scope features. The flat `fetchFeatureReviewItems` path drops PE grouping
(`flattenProgramEpicFeatures`, `blueprintHierarchy.ts:1074`) and filters to `children.length > 0`
(`scopedTeamFeatures.ts:108`), so it would silently hide childless/off-train-only features — the opposite of the
triage intent. The blueprint is inherently **cross-project**: team stories are PI+project scoped, but features and
Program Epics are fetched by bare `key in (…)` regardless of project (`blueprintHierarchy.ts:479-491, 859-869`) —
exactly the parent-walk the user described. Per feature the picker needs only key/summary/status/health/child
count — all present on `BlueprintFeatureNode` (`blueprintHierarchy.ts:85-95`); child count = `children.length`
(in-train) or `children.length + offTrain.length` (total). **Hygiene is not needed in the picker** (FR-1.2), so
the blueprint path's lack of hygiene flags is fine.

**Alternatives considered**:
- `fetchFeatureReviewItems(team, piName)` (flat + hygiene) — rejected for the picker: no PE grouping and the
  `children>0` filter hides valid features. (It remains the basis of the *canvas* fetch, see R3.)
- Reconciling blueprint (for grouping) with feature-review (for hygiene) — rejected as unnecessary complexity;
  the picker doesn't show hygiene.

## R2 — Picker's custom-query source

**Decision**: The custom-JQL source reuses `fetchFeatureReviewItemsByJql(jql, …)` (`featureReview.ts:278`). Its
matches populate the same selectable list (flat, ungrouped under a "Custom query" heading). The
passphrase-gated NL→JQL helper (`NlToJqlControl`) moves into this custom-query mode of the picker.

**Rationale**: Reuses the exact fetch already wired for 010's surfacing, with its safe-failure behavior (bad JQL
→ error, nothing added). No PE grouping is available on this path (`fetchFeatureNodesByKeys` carries no PE key),
which is acceptable — custom queries are ad-hoc.

## R3 — Working-set data-flow inversion (query-driven → membership-driven)

**Decision**: The canvas renders the **overlay's node set** (the persisted working set) and fetches live data for
exactly those keys. `useCanvasFeatures` is refactored from JQL-driven to **key-driven**: it fetches
`fetchFeatureReviewItemsByJql('issuekey in (…overlay node keys)')` for the current working-set keys (empty keys →
no fetch, empty canvas). The view builds `canvasNodes` from those items (which correspond 1:1 to overlay keys),
dropping the refine-chip `boardNodes` narrowing.

**Rationale**: Today `canvasNodes` is built from the *last query result* (`FeatureCanvasView.tsx:68`), so a new
surface replaces the set. The overlay's `nodes` map already accumulates additively (`ensureNodeStates` adds and
never overwrites, `useCanvasOverlay.ts:70-85`) — it *is* the working set. Inverting so the canvas reads the
overlay keys makes surfacing additive by construction and makes `removeNode` authoritative. `mapFeaturesToNodes`
still joins by `item.feature.key` (`nodeMapping.ts:99`), so it works unchanged with a key-scoped fetch.

**Constraint (R6 below)**: `fetchFeatureReviewItemsByJql` caps at `maxResults=200` (`featureReview.ts:301`);
working sets beyond ~200 keys must batch the `issuekey in (…)` query.

**Alternatives considered**: Keep query-driven items and accumulate a separate "added keys" list layered on top —
rejected; two sources of truth for "what's on the canvas" (query result vs added set) is exactly the confusion to
avoid. The overlay is the single source of membership.

## R4 — Adding from the picker (additive, dedup)

**Decision**: Selecting features and pressing **Add** calls `controller.ensureNodeStates(...)` for the selected
keys — additive and idempotent. A key already in `overlay.nodes` shows in the picker as **already added** and is a
no-op on Add (no duplicate, arrangement preserved).

**Rationale**: `ensureNodeStates` already adds only missing keys and returns the previous overlay unchanged when
nothing is new (`useCanvasOverlay.ts:74-84`) — exactly the additive/dedup semantics (FR-4). "Already added" is
`overlay.nodes[key] !== undefined`.

## R5 — Node removal

**Decision**: Add a `removeNode(issueKey)` mutator to `useCanvasOverlay` that returns `{ …previous, nodes:
<copy without issueKey> }`, mirroring `removeContainer` (`useCanvasOverlay.ts:106-122`). Surface it as a ✕
affordance on the feature node (mirroring `ContainerNode`'s `nodrag` ✕ button, `ContainerNode.tsx:67-82`) and/or a
Remove action in the inspector. Clear `selectedIssueKey` when the selected node is removed.

**Rationale**: No per-node remove exists today (`useCanvasOverlay` mutators list, `useCanvasOverlay.ts:20-34`).
Under the R3 working-set model, `canvasNodes` derives from overlay membership, so removing the key drops the node
from the canvas **and** from the commit diff (commit reads `canvasNodes`, `ReviewCommitPanel.tsx:41` /
`FeatureCanvasView.tsx:136`) — cleanly, exactly as FR-5 intends. Removal is overlay-only; it never touches Jira.

## R6 — Working-set fetch size cap

**Decision**: When the working set exceeds `fetchFeatureReviewItemsByJql`'s `maxResults=200`, batch the
`issuekey in (…)` query into ≤200-key chunks and merge. For ≤200 (the common case) a single call suffices.

**Rationale**: A curated triage canvas rarely exceeds 200 features; batching is a small guard so large sets don't
silently truncate. `log`/note the cap so truncation is never silent.

## R7 — Node inspector (read-only, no new fetch)

**Decision**: A new `NodeInspectorPanel` renders the currently selected node (`selectedNode: CanvasNode`) in a
docked side panel: epic detail (summary, status, assignee, size/points, health, completion, hygiene flags, links)
and the list of **child records** from `node.childStories`. Read-only. Opening another node replaces its
contents; dismissing closes it.

**Rationale**: `CanvasNode` already carries everything needed, including `childStories`
(`canvasTypes.ts:28-50`; `childStories` populated by `nodeMapping.ts:119` from `item.feature.children`), so the
inspector needs **no new fetch** (spec A5). Selection is already tracked (`selectedIssueKey` +
`onSelect`, `FeatureCanvasView.tsx:55,129,85`), and `FeatureNode` is display-only so `onSelect` alone drives the
inspector (`FeatureNode.tsx:5-6,47`). An explicit "open" affordance is optional.

## R8 — Retiring feature 010's refine chips

**Decision**: Remove the label/text/status refine chips (`SurfaceScopeBar.tsx:55-61`), the view's `filters` state
+ `applyScopeFilters`/`filteredKeys`/`boardNodes` chain (`FeatureCanvasView.tsx:58,71-75,112-116`), and the
`ScopeFilters`/`EMPTY_SCOPE_FILTERS`/`applyScopeFilters`/`readIssueLabels` machinery in `scopeQuery.ts:13-68`.
**Keep** `buildDefaultScopeJql` (`scopeQuery.ts:27-36`) — the picker's Custom-JQL source uses it as its default
prefill. `SurfaceScopeBar` itself is removed; the JQL box lives inside the picker.

**Rationale**: In the picker model the canvas shows exactly the curated set, so a post-hoc canvas filter is
redundant (Q2 clarify: refine chips removed). The "find features among many" need moves into the picker's own
search (FR-2.3). Tests exercising the chips (`SurfaceScopeBar.test.tsx`, `scopeQuery.test.ts`,
`FeatureCanvasView.test.tsx`) are updated/removed accordingly.

## R9 — Picker presentation & scope resolution

**Decision**: The picker is a **panel/drawer** opened by an *Add features* action in the canvas header (not an
always-on bar). Team + PI are resolved exactly as the canvas does today
(`findMatchingArtTeam(readStoredArtTeams(), boardId, projectKey)` + `selectedPiValue || readFallbackSelectedPiName`,
`useCanvasFeatures.ts:45-51`), already exposed as `team`/`piName`. When no ART team matches, the blueprint source
shows the configure-ART empty state; the Custom-JQL source still works as a fallback.

**Rationale**: Surfacing is now a deliberate, occasional action; a modal picker keeps the canvas uncluttered and
frames "adding work" as an intentional step (the coaching moment). Reusing the existing scope resolution avoids a
new configuration path.

---

## Resolved unknowns

All Technical Context items are resolved; **no `NEEDS CLARIFICATION` remains**. No new dependency. The only
noted operational constraint is the 200-key working-set fetch cap (R6), handled by batching.
