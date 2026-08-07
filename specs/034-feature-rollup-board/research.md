# Phase 0 Research: Feature Roll-Up Board

**Feature**: 034-feature-rollup-board | **Date**: 2026-08-07

Every finding below was read from the codebase, not assumed. File and line references are the evidence.

---

## Part 1 — Framework-First reuse ledger (Article VII)

The gate question: *does the codebase already provide this?* For each capability the board needs:

| Capability the board needs | Already exists? | Where | Decision |
|---|---|---|---|
| Board selection from team settings | ✅ | `hooks/useSprintData.ts:94,944` + `settingsStore.sprintDashboardBoardId` | **Reuse.** Consume the tab's existing `boardId`; never introduce a second picker (FR-001). |
| Fetch issues for a board | ✅ | `useSprintData.ts:662` — `/rest/agile/1.0/board/{id}/issue` | **Reuse the endpoint**, own the call (the board needs extra fields and full paging). |
| Child → Feature across projects | ✅ (one hop) | `utils/featureLink.ts` — configured Feature Link field → default → Epic Link → native `parent` | **Reuse for the single hop.** Chains are new (see gap 1). |
| Fetch Features by key, batched | ✅ | `scopedTeamFeatures.ts:75` (`key in (…)`, 50-key batches) | **Reuse the pattern.** |
| Sub-task sweep | ✅ | `planner/plannerFetch.ts:263` — `parent in (…)`, 50-parent chunks, errors swallowed per chunk | **Mirror it.** Board issues exclude sub-tasks (see unknown 3). |
| Custom-field discovery **by name** | ✅ | `Hygiene/checks/hygieneFieldConfig.ts:93` `loadHygieneFieldConfig` | **Extend additively** with two new families (sub-status, flagged). |
| Sub-status field | ✅ real, and written today | `src/services/jiraEventOutput.js:125-131`; `AdminHub/SprintReleasePanel.tsx:320` (`customfield_10201`) | **Reuse the concept**, discover the id by name client-side. Never hardcode. |
| Flagged / impediment signal | ✅ | `ArtView/hooks/artHelpers.ts:97` `detectImpedimentReasons` — reads `customfield_10021`, blocking links, blocked status, labels | **Reuse directly** for both the flagged indicator and the dependency indicator (FR-011). |
| Transitions + required screen fields | ✅ | `featureReviewFixes.ts:310` `fetchFeatureReviewTransitions`; `:415` `saveFeatureReviewTransition(key, id, fields)` | **Reuse.** One additive extension (see unknown 5). |
| Rendering required transition fields | ✅ | `components/TransitionRequiredFields/index.tsx` | **Reuse unchanged** — satisfies FR-021 including its "must be completed in Jira" honesty. |
| In-place field editing | ✅ | `components/IssueFieldEditors/` + `IssueDetailPanel` optional `fieldEditing` prop (`index.tsx:73,425`) | **Reuse unchanged** — satisfies US7 / FR-048–051 with no new writers. |
| Semantic chips (status, priority, type, assignee, age) | ✅ | `components/IssueMeta/` — all five components ship | **Reuse.** Directly supplies FR-028's non-colour type label. |
| Drag and drop | ✅ | `@dnd-kit/core` + `/sortable` + `/utilities` in `client/package.json:16-18`; used in `MyIssues/Todo/TodoTab.tsx:9,297` | **Reuse. No new dependency.** |
| Shared team config over Confluence | ✅ | `services/confluenceApi.ts:363,383` + three-way merge in `ArtView.tsx:3448-3570` | **Reuse the mechanism**, but as a sibling property — see gap 4. |
| Board-ish column UI | ❌ | `DsuBoard`, `StandupBoard` are section lists, not column boards | **Build** (see gap 3). |
| Status aliasing / vocabulary | ❌ | `MyIssues/StatusMappingEditor.tsx` is Jira→**SNow**, a different concept | **Build** (see gap 2). |

**Reuse verdict**: 15 of 19 capabilities are existing code. Four are gaps.

### Gap 1 — Defect roll-up chain

**Decision**: build `defectRollup.ts` as a pure module.
**Rationale**: `extractFeatureKeyFromIssueFields` (`featureLink.ts:70`) resolves **one hop** from a field value. The
spec's FR-005 precedence — linked dev Story → Story behind a linked QA issue → directly linked Feature → unattributed
— is a **walk over `issuelinks`**, then a hop per candidate. Nothing in the tree walks link chains.
**Alternatives rejected**: extending `featureLink.ts` (it is consumed by the blueprint, hygiene and reports; widening
its contract risks all three for one caller's benefit); doing the walk inline in the fetch layer (unreachable by unit
tests without mocking Jira — Article V requires the logic be testable with zero I/O).

### Gap 2 — Column vocabulary and status/sub-status mapping

**Decision**: build `boardColumns.ts` (pure) + `boardVocabularyStore.ts`.
**Rationale**: no status-aliasing concept exists anywhere in the client.
**Alternatives rejected**: reusing `StatusMappingEditor` — it maps a Jira status to a **SNow** state for the My Issues
health check, is a single-value pairing with no ordering, no sub-status, and no per-team scope. Sharing it would
couple two unrelated features to one shape.

### Gap 3 — Swimlane / column / parent-container layout

**Decision**: build `boardLayout.ts` (pure) plus presentational components.
**Rationale**: the product has no column board. `DsuBoardView` and `StandupBoardView` render labelled *sections* of a
flat list.
**Alternatives rejected**: none available.

### Gap 4 — Where the shared vocabulary lives *(the one recorded Article VII drift)*

**Decision**: a **new Confluence content property** `nodetoolbox-board-vocabulary` on the same database, with its own
schema version — not a field inside `SharedArtWorkspacePayload`.

**Rationale — the two obvious options are both unsafe:**

1. **Bump `SHARED_ART_WORKSPACE_SCHEMA_VERSION` 2 → 3.** `loadSharedArtWorkspace` rejects any payload whose version
   is greater than the client's own:
   ```
   if (loadedSchemaVersion < 1 || loadedSchemaVersion > SHARED_ART_WORKSPACE_SCHEMA_VERSION) { throw … }
   ```
   (`confluenceApi.ts:374-376`). The moment one person on this build publishes, **every colleague on an older build
   loses the entire ART workspace**, not merely the new field. This directly violates FR-019e.
2. **Add `boardColumns` to the v2 team record without a bump.** `mergeSharedArtTeamRecord` merges strictly over the
   `SHARED_ART_TEAM_FIELD_NAMES` allowlist (`ArtView.tsx:3518`, list at `:3226`). An older client that publishes
   rebuilds the team record from that allowlist and **silently drops** the vocabulary — quiet data loss, which this
   project's honesty rules forbid.

**Why the chosen option is reuse rather than invention**: the same service file already solves this exact problem
once. The Jira template library is kept as its own property with its own version, commented:

> *"shared database used by the ART workspace, kept independent so the ART schema is untouched."* —
> `confluenceApi.ts:399`

and treats an absent property as the empty state rather than an error (`:405-415`). Following that precedent gives
FR-019e for free: old clients never read or write the property, so they can neither break on it nor erase it.

**Alternatives rejected**: a server-side store (new backend surface for data that is already Confluence-shaped, and
the team explicitly wants it to live where the rest of their shared config lives); per-browser only (contradicts
FR-019).

---

## Part 2 — Unknowns resolved

### 1. How does the client discover the sub-status field id?

**Resolved**: through `loadHygieneFieldConfig`, extended with a `subStatusFieldIds` family discovered by name
(`Sub-Status`, `Sub Status`, `Substatus`). The server side proves the field exists and is writable
(`jiraEventOutput.js:125-131` PUTs it), and `SprintReleasePanel.tsx:83` shows `customfield_10201` on this instance —
but that is **configuration, not a constant**, so the client discovers it.
**Consequence**: when the family resolves empty, FR-025 fires — columns degrade to status-only and the board says so.
This is the same "not checked — no matching field" honesty the 021 Readiness families use (`hygieneFieldConfig.ts:120`).

### 2. How are the sub-status *values* enumerated for the mapping editor (FR-017)?

**Resolved**: the layered pattern recorded for this Jira instance — this deployment removed the legacy full
`createmeta`, so options must come from a per-issue-type `createmeta` call, or from the transition/edit metadata,
never from a single global call. `fetchFeatureReviewEditMeta(issueKey)` (`featureReviewFixes.ts:188`) already returns
`allowedValues` per field for a real issue, which is sufficient: the editor seeds its options from issues currently in
scope. When no in-scope issue exposes the field, the editor says so rather than offering free text (FR-017).

### 3. Do board issues include sub-tasks?

**Resolved**: **no.** Nothing in the client requests `subtasks`, and the agile board endpoint returns the board's own
issues. A second sweep is required: `parent in (<board issue keys>)`, chunked — the shape proven by
`plannerFetch.fetchSubtasksForParents` (`:263-272`, chunk size 50) and by `hygieneScan.ts:276`.
**Consequence**: FR-004 (sub-task → parent's Feature) and FR-037 (out-of-scope parent) both depend on this sweep
running before roll-up.

### 4. Can the status and sub-status be written atomically?

**Resolved**: **sometimes, and the difference is detectable.** `saveFeatureReviewTransition(key, id, fields)` posts
`{transition, fields}` — so if the sub-status field is on the transition screen, one call sets both.
`fetchFeatureReviewTransitions` requests `expand=transitions.fields`, which returns **every** screen field, but then
filters to `required === true` (`:319-320`). The information needed is fetched and discarded.
**Decision**: additively expose the unfiltered screen field ids on `FeatureReviewTransition`, so the writer can choose
atomic vs two-step. Existing callers read `requiredFields` and are unaffected.

### 5. What happens when the two-step write half-succeeds?

**Resolved**: this is a real case with no spec coverage. See `contracts/status-move.md` and the Open Item in
[plan.md](./plan.md). **Decision**: never revert the card on a partial success — re-read and render the truth,
reporting precisely what was and was not applied. Reverting would display a state Jira does not hold.

### 6. Where does the board mount?

**Resolved**: as a **tab on `SprintDashboardView`**, which the Agile Hub **Team** space mounts unchanged
(`AgileHubView.tsx:87`). The Team space is where board selection already lives, so FR-001 is satisfied by
construction. Registration is one new member of the `DashboardTab` union (`useSprintData.ts:55-70`) plus one tab
entry — the same additive shape `featurereview` and `backlogremediation` already use.
**Alternatives rejected**: a new top-level view (would need its own board selection — forbidden by FR-001); a new
Agile Hub space (spec 020 fixed the space set at three plus Search).

### 7. How is "% complete" derived (FR-012)?

**Resolved**: no existing rollup computes it; `featureProgress.ts` is new but trivial. Points-weighted when **every**
contributing child carries an estimate, issue-count-weighted otherwise, with the basis returned alongside the number
so FR-012 is satisfied by the return shape rather than by remembering to display it.
**Gotcha carried in**: story points on this instance are a **dropdown**, and the field id varies —
`readIssueStoryPointsDisplayValue` (`featureReviewFixes.ts:574`) and `getStoryPointsCandidateFieldIds` (`:561`)
already handle option objects and candidate ids. Reuse both; never read a raw number.

### 8. Is there a drag-and-drop precedent to follow?

**Resolved**: yes — `TodoTab.tsx` uses `DndContext` + `useDraggable`/`useDroppable` with a `PointerSensor`, and puts
the drag listeners on a **grip area** so buttons inside the card stay clickable (`:70`). The board needs both that
pattern (cards → columns) and `@dnd-kit/sortable` (lane reordering), which is already installed.

### 9. Does anything today read Smart Checklist data?

**Resolved**: **no** — the only occurrences are prose in `SprintDashboardView.tsx` and spec 032. Consistent with the
spec's clarification, checklist items are out of scope for v1; FR-054's read-only indicator renders only if a
checklist field turns out to be present on an in-scope issue, and is otherwise absent rather than empty.

---

## Part 3 — Risks carried into implementation

| Risk | Mitigation |
|---|---|
| A defect links to two Stories under different Features; precedence picks one and the other is invisible | FR-007 requires unchosen candidates to be listed on the card; the resolver returns **all** candidates plus the chosen route, so the UI cannot omit them |
| Link chains loop (defect → QA → defect) | The walk carries a visited set and terminates; the loop is reported as a hygiene note (spec edge case) |
| `parent in (…)` sweep silently fails for one chunk | Chunk failures are swallowed for enrichment in the planner precedent — **not acceptable here** (FR-055). Chunk failures must surface as an incomplete-load warning naming what is missing |
| 300 issues × lanes × columns re-rendering on every filter keystroke | Layout is pure and memoised on `(issues, vocabulary, filters)`; lanes open **collapsed** so first paint is headers only |
| Column drop targets and lane sortables both live under drag-and-drop | Two separate `DndContext`s with distinct sensors — card→column and lane→lane never share a drag surface |
| Adding a tab touches a ~5 000-line shipped file | Both edits are additive (one union member, one tab entry); the existing `SprintDashboardView` test suite is the regression proof |
