# Contract: Surfacing Picker Sources (Area 1)

Defines the internal contracts for the picker's two candidate sources and how selection adds to the canvas. All
reuse existing `/jira-proxy` reads; **no new server endpoint, no new dependency**.

---

## 1. Blueprint source (default, grouped) — `usePickerCandidates` blueprint mode

- Input: the active `team: ArtTeam` and `piName: string` (resolved exactly as the canvas does today —
  `findMatchingArtTeam(readStoredArtTeams(), boardId, projectKey)` + `selectedPiValue || readFallbackSelectedPiName`).
- Fetch: `fetchBlueprintHierarchy([team], piName)` → `BlueprintProgramEpicNode[]` (cross-project parent-walk;
  `blueprintHierarchy.ts:1013`).
- Map → `PickerGroup[]`: one group per Program Epic (`programEpicKey`, `programEpicSummary`), each feature →
  `PickerFeature` `{ key, summary, status, health, childCount = children.length + offTrain.length, programEpicKey }`.
- Shows **all** in-scope features (not the `children>0` subset the flat feature-review path applies).
- **No hygiene** on this path (not needed by the picker).
- Empty / no-team: returns no groups; the picker shows the "configure ART team" guidance for this source.

## 2. Custom-JQL source — `usePickerCandidates` jql mode

- Input: a user `jql` string (seeded from `buildDefaultScopeJql` for convenience; freely editable).
- Fetch: `fetchFeatureReviewItemsByJql(jql)` → `FeatureReviewItem[]` (`featureReview.ts:278`).
- Map → a single `PickerGroup` (`programEpicKey: null`, heading "Custom query") whose features are
  `PickerFeature` `{ key, summary, status, health, childCount = totalChildCount, programEpicKey: null }`.
- **Safe failure**: a malformed/unauthorized `jql` rejects → the picker shows a clear error and adds nothing;
  the canvas is unchanged.
- The passphrase-gated **NL→JQL helper** (`NlToJqlControl`) is available in this mode only (invisible when AI
  locked); it proposes a `jql` string the user can accept into the box.

## 3. Selection & search

- Each `PickerFeature` row is selectable via a checkbox; `select-all` / `clear-all` operate on the currently
  listed (post-search) rows.
- A **search** box filters the listed candidates by key / summary / label (client-side). This replaces feature
  010's canvas refine chips.
- Rows where `isAlreadyOnCanvas` (`overlay.nodes[key] !== undefined`) are shown as **already added** and are not
  selectable.

## 4. Add (additive) → overlay

- Pressing **Add** calls `controller.ensureNodeStates(selectedKeys.map(key => createNodeState(key, x, y)))` for
  the selected keys not already on the canvas.
- `ensureNodeStates` is additive and idempotent (`useCanvasOverlay.ts:70-85`): existing keys are untouched
  (arrangement preserved), new keys are added. No duplicates.
- Adding never removes or resets any existing node (FR-4).

## Invariants

- Manual parity: both sources and Add work with AI locked; the NL→JQL helper is additive-only.
- A source error adds nothing and never mutates the overlay/canvas.
- The picker is transient — it holds no persisted state; membership lives solely in `overlay.nodes`.
