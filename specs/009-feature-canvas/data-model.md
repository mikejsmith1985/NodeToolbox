# Phase 1 Data Model: Feature Canvas

All entities below are **client-side** (the planning overlay + its in-memory projections).
Jira remains the system of record; nothing here is written to Jira except through the
Commit Diff (see `contracts/jira-writes.md`). Source Jira types (`JiraIssue`, `JiraSprint`,
`JiraVersion`, `BlueprintFeatureNode`, `HygieneFlag`) are reused as-is from
`client/src/types/jira.ts`, `ArtView/blueprintHierarchy.ts`, and
`Hygiene/checks/hygieneChecks.ts` — not redefined.

---

## Persisted entities (the planning overlay blob)

### `CanvasOverlay` (root persisted object)

The single JSON value stored at `tbxFeatureCanvasOverlay:{profileId}:{scopeKey}`.

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | `number` | For forward migration (start at `1`) |
| `profileId` | `string` | Active team profile id (or `'legacy-default'`) |
| `scopeKey` | `string` | Namespaces the overlay per PI. **Derivation**: `` `${projectKey}:${piName}` `` (both from the active team profile/ART context), lowercased with whitespace collapsed; empty PI falls back to `${projectKey}:no-pi`. Deterministic so the same team+PI always resolves the same overlay |
| `nodes` | `Record<string, CanvasNodeState>` | Keyed by Jira issue key |
| `containers` | `CanvasContainer[]` | Release / Sprint / ParkingLot boxes |
| `wipLimit` | `number \| null` | Stage 2 WIP ceiling; `null` = not set |
| `stageState` | `JourneyStageState` | Coach progress for resume |
| `sizeMapping` | `Record<TshirtSize, number>` | Editable S/M/L/XL → points (default S1 M3 L5 XL8) |
| `updatedAtIso` | `string` | Last-saved timestamp (display only; stamped by caller) |

**Validation**: `schemaVersion ≥ 1`; every `containers[].id` unique; every
`nodes[key].containerId` (if set) must reference an existing container id or be dropped on
load (self-healing); `wipLimit`, when set, is a non-negative integer.

### `CanvasNodeState` (per-feature overlay attributes)

Only the overlay-owned attributes are persisted; live Jira fields are re-fetched, never
stored, so the overlay never goes stale on summary/status/assignee.

| Field | Type | Notes |
|-------|------|-------|
| `issueKey` | `string` | Jira key; the join to live data |
| `position` | `{ x: number; y: number }` | Canvas coordinates |
| `size` | `TshirtSize \| null` | Overlay relative size; `null` = unsized (may still have Jira points) |
| `priority` | `MoscowBucket \| null` | `Must \| Should \| Could \| Wont`; `null` = unranked |
| `containerId` | `string \| null` | Container membership; `null` = loose on canvas |
| `isExpanded` | `boolean` | Whether child stories are revealed (Q2=A) |
| `isParked` | `boolean` | Convenience mirror of membership in the ParkingLot container |

**State transitions** (node lifecycle across the coach): `unsurfaced → surfaced` (appears in
overlay after Stage 1) → optionally `parked` (Stage 2) → `ranked` (Stage 3) → `sized`
(Stage 4) → `boxed` (Stage 5, `containerId` set). Transitions are non-destructive and
reversible; re-entering an earlier stage does not clear later attributes.

### `CanvasContainer`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Stable overlay id (e.g. `ctr-<n>`) |
| `kind` | `'release' \| 'sprint' \| 'parkingLot'` | ParkingLot is a singleton per overlay |
| `title` | `string` | Display label |
| `bounds` | `{ x: number; y: number; width: number; height: number }` | Box geometry on canvas |
| `capacityBudget` | `number \| null` | Editable size ceiling; `null` = no budget (ParkingLot) |
| `provenance` | `ContainerProvenance` | How it maps to Jira — see below |

### `ContainerProvenance` (drives Q3=A reconciliation)

| Field | Type | Notes |
|-------|------|-------|
| `state` | `'real' \| 'provisional'` | `provisional` = proposed on canvas, not in Jira yet |
| `jiraSprintId` | `number \| null` | Set when `kind='sprint'` and mapped/created |
| `jiraVersionName` | `string \| null` | Set when `kind='release'` and mapped/created |
| `startDateIso` | `string \| null` | Optional; used when creating a provisional sprint/version |
| `endDateIso` | `string \| null` | Optional |

**Validation**: a `real` sprint container has `jiraSprintId ≠ null`; a `real` release
container has `jiraVersionName ≠ null`; a `provisional` container has both null until commit.
ParkingLot containers are always local (never committed).

### `JourneyStageState`

| Field | Type | Notes |
|-------|------|-------|
| `currentStageId` | `StageId` | `surface \| stabilize \| prioritize \| size \| sequence` |
| `completed` | `Record<StageId, boolean>` | Marks each stage done for resume/skip |

---

## Derived / in-memory entities (never persisted)

### `CanvasNode` (render + logic projection)

Built at load by joining `CanvasNodeState` (overlay) with live data
(`FeatureReviewItem` from `fetchFeatureReviewItems`). Feeds React Flow.

| Field | Source | Notes |
|-------|--------|-------|
| `issueKey`, `position`, `size`, `priority`, `containerId`, `isExpanded` | overlay | as above |
| `summary`, `status`, `statusCategoryKey`, `assignee` | live `JiraIssue` | display + WIP calc |
| `storyPoints` | live blueprint/issue | shown as-is; feeds capacity if no overlay `size` |
| `health`, `completionPercent` | live `BlueprintFeatureNode` | node visuals |
| `hygieneFlags` | `evaluateHygieneIssue(featureIssue, ctx)` | badge count |
| `childStories` | `BlueprintFeatureNode.children` | revealed when `isExpanded` |
| `dependencies` | live `JiraIssue.fields.issuelinks` | `{ targetKey, type, direction }[]` for FR-6.4 blocker indicators. **Requires the feature fetch to request the `issuelinks` field** (add to `fetchFeatureReviewItems`' field set or a companion fetch); empty when the issue has no links |
| `effectivePoints` | derived | `size ? sizeMapping[size] : (storyPoints ?? 0)` — the capacity unit |

### `ContainerCapacity` (Stage 5 meter)

| Field | Type | Derivation |
|-------|------|-----------|
| `containerId` | `string` | — |
| `total` | `number` | Σ `effectivePoints` of member nodes (`capacity.ts`) |
| `budget` | `number \| null` | from `CanvasContainer.capacityBudget` |
| `status` | `'under' \| 'at' \| 'over'` | compare `total` vs `budget` (`null` budget ⇒ `under`) |
| `overBy` | `number` | `max(0, total − budget)` when budget set |

### `WipSnapshot` (Stage 2)

| Field | Type | Derivation |
|-------|------|-----------|
| `inProgressCount` | `number` | count of surfaced nodes whose `statusCategoryKey='indeterminate'` (`wip.ts`) |
| `limit` | `number \| null` | `CanvasOverlay.wipLimit` |
| `overflow` | `number` | `max(0, inProgressCount − limit)` when limit set |
| `parkedCount` | `number` | count of nodes with `isParked` |

### `CommitDiff` + `CommitDiffItem` (transient, pre-write)

Produced by `commitDiff.ts` from the overlay vs live Jira state; shown in Review & Commit;
never persisted. See `contracts/jira-writes.md` for the write shapes each item maps to.

**Feature→sprint expansion (FR-6.1a)**: a feature boxed into a *sprint* does not emit one
`sprintAssign` for the feature key; `commitDiff.ts` expands it into **one `sprintAssign` per
child story** (`issueKey` = each story), because Jira sprints hold stories, not epics. A
feature with no child stories emits a single `sprintAssign` for the feature itself. A
feature boxed into a *release* emits one `versionAssign` for the feature key (fixVersion is
set on the feature directly). This keeps `CanvasNodeState` feature-keyed while producing
Jira-correct writes.

| `CommitDiffItem` field | Type | Notes |
|------------------------|------|-------|
| `kind` | `'sprintAssign' \| 'versionAssign' \| 'pointsSet' \| 'prioritySet' \| 'createSprint' \| 'createVersion'` | one write per item |
| `issueKey` | `string \| null` | null for `createSprint`/`createVersion` |
| `containerId` | `string \| null` | the target box (for assign/create items) |
| `from` | `string \| number \| null` | current Jira value (for display) |
| `to` | `string \| number` | proposed value |
| `dependsOn` | `string \| null` | id of a `createSprint`/`createVersion` item that must succeed first (Q3=A ordering) |
| `selected` | `boolean` | user can include/exclude per item before writing |

### `AiSuggestionSet` (transient, gated)

| Field | Type | Notes |
|-------|------|-------|
| `kind` | `'priorityOrder' \| 'staleCandidates' \| 'duplicateCandidates' \| 'sprintGrouping'` | which analysis |
| `items` | `AiSuggestion[]` | each `{ issueKey, proposedValue, rationale, accepted: boolean }` |

Only `accepted` items mutate the overlay; rejecting all is a no-op (SC-9 / FR-9.2).

---

## Enumerations

- `TshirtSize = 'S' \| 'M' \| 'L' \| 'XL'`
- `MoscowBucket = 'Must' \| 'Should' \| 'Could' \| 'Wont'`
- `StageId = 'surface' \| 'stabilize' \| 'prioritize' \| 'size' \| 'sequence'`
- `ContainerKind = 'release' \| 'sprint' \| 'parkingLot'`

---

## Relationships (summary)

- `CanvasOverlay` **1—N** `CanvasNodeState` (by issue key) and **1—N** `CanvasContainer`.
- `CanvasNodeState.containerId` **N—1** `CanvasContainer.id` (optional).
- `CanvasNode` = `CanvasNodeState` ⋈ live `FeatureReviewItem` (join on `issueKey`) — the
  overlay stores *only* arrangement attributes; all display/status/points/health/hygiene are
  live, so reopening the canvas never shows stale Jira data (SC-10 restores *arrangement*,
  not a snapshot of Jira).
- `CommitDiffItem.dependsOn` → a `createSprint`/`createVersion` item, enforcing that
  provisional containers become real before member assignments are written (Q3=A).
