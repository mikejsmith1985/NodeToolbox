# Phase 0 Research: Feature Canvas

All decisions are grounded in the current NodeToolbox codebase (see cited files) and the
resolved spec clarifications (Q1=A sandbox+commit, Q2=A feature-first nodes, Q3=A
provisional containers).

---

## R1 — Canvas rendering: React Flow (`@xyflow/react`) vs hand-rolled on `@dnd-kit`

**Decision**: Adopt **React Flow (`@xyflow/react` v12)** for the canvas surface, loaded
lazily (first `React.lazy` route + `Suspense` boundary in `App.tsx`).

**Rationale**:
- The feature's defining capability is a **pan/zoom node canvas with container grouping at
  200+ nodes** (spec FR-1, FR-6, SC-8). The repo has **zero prior art** for this: the only
  `@dnd-kit` usage is a sortable grid in `client/src/views/Home/HomeView.tsx` (`useSortable`
  only — no `useDraggable`, no multi-container droppable, no pan/zoom). The only spatial code
  (`client/src/views/ArtView/dependencyGraph.ts` + `DependenciesTab.tsx`) is a *static*,
  non-interactive computed-layout SVG.
- `@dnd-kit` **structurally cannot** provide pan/zoom: it has no viewport transform, and its
  pointer/collision math assumes untransformed space — a CSS `scale()`/`translate()`
  viewport breaks its delta and collision calculations unless hand-compensated with custom
  modifiers (`@dnd-kit/modifiers` isn't even installed). Hand-rolling this is the hardest,
  most error-prone part and has no in-repo reference.
- **Framework-First (Article VII)** favors *not* rebuilding the substance of a purpose-built
  framework. React Flow natively delivers exactly the three gap areas (free x/y drag,
  pan/zoom, parent/group container nodes with membership) and is built for hundreds of nodes.
  Choosing it *is* the framework-first move; the "documented gap" is that the codebase has no
  canvas capability and its sanctioned drag primitive can't supply one.
- Bundle concern is mitigated by the repo's proven **on-demand import** pattern
  (`await import('xlsx')` at `client/src/views/JiraIntake/lib/parseSubmissions.ts:52` and two
  others). Lazy-loading the canvas route keeps React Flow off the shared bundle for everyone
  who never opens it. React Flow v12 supports React 19 + Vite.

**Alternatives considered**:
- **Hand-rolled on `@dnd-kit` + CSS transforms** — no new dependency and matches the
  minimal-deps culture, but requires hand-building the viewport transform, zoom-compensation
  modifiers, coordinate storage/restore, container hit-testing, and 200-node perf/virtual-
  ization from scratch, with no prior art for any of it. Highest custom-code volume and
  highest risk on exactly the capability that is the feature's core. Rejected.
- **Konva / Fabric (canvas-2D)** — powerful but imperative, non-DOM; loses HTML node cards,
  accessibility, and CSS reuse; even heavier and further from repo idioms. Rejected.
- **Extend the existing SVG layout engine (`dependencyGraph.ts`)** — it computes coordinates
  but has no drag/pan/zoom/interaction; extending it to a full interactive canvas is
  effectively option "hand-rolled." Rejected for the same reasons.

**Article VII record**: The justification comment is placed at `FeatureCanvasBoard.tsx`
(the component that introduces React Flow), per the constitution's "recorded at the
component" requirement, and summarized in `plan.md` Constitution Check.

---

## R2 — Planning overlay persistence

**Decision**: Persist the overlay as a single JSON blob in **`localStorage`**, keyed
`tbxFeatureCanvasOverlay:{profileId}:{scopeKey}` using the existing
`buildTeamScopedStorageKey` idiom (`client/src/views/SprintDashboard/hooks/teamScopedStorage.ts:11`).
Wrap access in a small zustand store (no `persist` middleware — the app hand-rolls storage).

**Rationale**:
- Matches the established pattern exactly: `useDashboardConfig` persists its whole config as
  one team-scoped JSON blob (`tbxSprintDashboardConfig:{profileId}`,
  `useDashboardConfig.ts:80`); no store in the app uses zustand `persist`
  (`settingsStore.ts:472`, `aiAssistStore.ts:32` both hand-roll).
- Data volume is tiny: ~200 nodes × (position + size + priority + container id) ≈ tens of KB,
  far under the `localStorage` budget. `canUseLocalStorage()` guarding + try/catch degrade to
  in-memory in private mode (mirrors `settingsStore.ts:144`).
- Per-`{profileId, scopeKey}` keying gives each team+PI its own overlay and supports the
  legacy→scoped one-time migration helper already in `teamScopedStorage.ts:30`.

**Alternatives considered**:
- **Backend JSON-file store** (mirroring `src/services/dailyChecklistStore.js` +
  `src/routes/checklistState.js`) — enables cross-device durability, but the spec makes the
  canvas single-operator and no `/api` route stores arbitrary planning JSON today; this is
  deferred as the documented future path, not built now. Rejected for this release.
- **IndexedDB** — unnecessary for tens-of-KB data; no IndexedDB usage exists in the repo to
  follow. Rejected.

---

## R3 — Where the tool lives + how it sources scope

**Decision**: A **new top-level lazy route** `/feature-canvas`. It sources work by calling
`fetchFeatureReviewItems(team, selectedPiName, fieldConfig, spFieldId)` at the **active ART
team + selected PI** (read from settings/ART context), and loads boxable containers from
`GET /rest/agile/1.0/board/{id}/sprint?state=active,future` and
`GET /rest/api/2/project/{key}/versions`.

**Rationale**:
- Registering a top-level view is a known 4-edit pattern: import + route const + `<Route>`
  in `App.tsx` (routes block ~`:171-206`, before the `*` catch-all) + a Home `AppCardDef` in
  `homeCardData.ts:35` (section `'agile'`).
- Nodes are features (Q2=A), and features + health + completion + hygiene + child rollup are
  exactly what `fetchFeatureReviewItems` returns (`featureReview.ts:181`,
  `FeatureReviewItem` `:32`) — the richest existing source, already ART/PI-scoped. This
  avoids extracting the private, non-exported `buildScopedProjectJql`
  (`SprintDashboardView.tsx:386`, local helper) and reuses the same empty-state contract
  (require a matched ART team, else "configure ART settings").
- The active team profile and persisted scope are readable by any view directly from
  `useSettingsStore` (`sprintDashboardActiveTeamProfileId` etc.,
  `SprintDashboardView.tsx:6457`), keeping the canvas in sync with the Team Dashboard's
  team/PI choice. The canvas provides a minimal read-only scope header (team + PI) and does
  not re-implement scope selection.

**Alternatives considered**:
- **Sub-tab inside `SprintDashboardView`** — reuses the tab bar and scope state in-place, but
  the dense tab row cramps a full pan/zoom canvas and the 200-node surface wants the whole
  page. Rejected (kept as a possible secondary entry point later).
- **Extract `buildScopedProjectJql` to a shared module and support all 3 scope modes for
  sourcing** — more general, but unnecessary now since feature sourcing is PI/ART-oriented;
  the Sprint/FixVersion modes matter for *boxing targets*, which are loaded separately.
  Deferred.

---

## R4 — Commit writes & provisional-container reconciliation

**Decision**: Reuse existing write helpers for assignments; add two thin **new** helpers for
creating provisional containers, all through the existing `/jira-proxy` (no server change).

| Commit action | Endpoint / shape | Source |
|---------------|------------------|--------|
| Assign issue → sprint | `POST /rest/agile/1.0/sprint/{id}/issue` body `{issues:[key]}` | existing `moveIssueToSprint` (`useSprintData.ts:909`) |
| Assign issue → fixVersion | `PUT /rest/api/2/issue/{key}` body `{update:{fixVersions:[{set:[{name}]}]}}` | existing `saveFeatureReviewFixVersion` (`featureReviewFixes.ts:313`) |
| Set story points | `PUT /rest/api/2/issue/{key}` body `{fields:{[spField]:n}}` | existing `saveFeatureReviewStoryPoints` (`featureReviewFixes.ts:326`) |
| (optional) Set priority | `PUT /rest/api/2/issue/{key}` body `{fields:{priority:{name}}}` | standard; priority is overlay-only unless user opts to commit it |
| **Create sprint** (provisional→real) | **NEW** `POST /rest/agile/1.0/sprint` body `{name, originBoardId, startDate?, endDate?, goal?}` → `{id}` | new `createSprint()` in `jiraApi.ts` |
| **Create version** (provisional→real) | **NEW** `POST /rest/api/2/version` body `{name, project, releaseDate?, released?}` → `{id,name}` | new `createVersion()` in `jiraApi.ts` |

**Rationale**:
- The proxy forwards arbitrary `/rest/...` paths, so the two new POSTs need no backend work.
  `jiraPost<{id:number}>()` captures the returned id (`jiraApi.ts:138` parses JSON bodies);
  `jiraPut` returns void for 204 (`:161`).
- **Reconciliation order (Q3=A)**: at commit, each provisional container is first resolved to
  a real Jira object — either create it (`createSprint`/`createVersion`) or map it to an
  existing one the user picks — *before* any member assignment is written. This is enforced in
  `commitJira.ts` so no assignment references a non-existent container.

**Alternatives considered**: Writing assignments and creating containers in one interleaved
pass — rejected; a failed create would orphan assignments. Two-phase (resolve containers →
write assignments) is safer and matches the diff the user approved.

---

## R5 — Story-point field resolution

**Decision**: Resolve the SP field id with the same precedence the existing writer uses:
per-team `DashboardConfig.customStoryPointsFieldId` (from `tbxSprintDashboardConfig:{profileId}`,
`useDashboardConfig.ts:47`) → `tbxARTSettings.spFieldId`
(`readStoredStoryPointsFieldId()`, `featureReviewFixes.ts:59`) → fallback `customfield_10028`
→ `customfield_10016`.

**Rationale**: There is no single global SP field id; the write path in `featureReviewFixes.ts`
already implements this precedence with a `10028→10016` retry on failure. Reusing it keeps
commit writes consistent with Feature Review and avoids a new configuration surface.

---

## R6 — Hidden AI accelerator

**Decision**: Gate all AI affordances behind the existing `aiAssistStore` unlock
(`aiAssistStore.ts:32`, session key `tbxAiAssistUnlocked`, Ctrl+Alt+Z). Implement the
round-trip by mirroring `client/src/views/SprintDashboard/hooks/releaseAiAssistNotes.ts`:
`buildPrompt(context)` → user pastes reply → `extractJsonPayload()` strips assistant
chatter/markdown fences → strict field validation → suggestions surfaced for per-item
accept/reject.

**Rationale**: This is the sanctioned, already-hardened pattern (robust to Copilot noise,
descriptive validation errors). Suggestions only mutate the overlay when accepted, so removing
the accelerator entirely leaves the workflow fully functional (SC-9, FR-9.4). No always-on
outbound AI channel and no AI text in any user-facing stage guidance.

**Alternatives considered**: The automated dispatch/poll variant
(`useAiAssistExchange.ts` → `/api/ai-assist/dispatch`) — out of scope; the copy-paste path is
sufficient and keeps the accelerator fully manual/optional.

---

## R7 — Sizing scale

**Decision**: T-shirt sizes **S/M/L/XL** with a documented point mapping
(S=1, M=3, L=5, XL=8 — Fibonacci-adjacent), editable per overlay. Existing story points, when
present, are shown as-is and also contribute to capacity; a canvas size maps to points at
commit via R5.

**Rationale**: The team has never pointed; t-shirt sizing is faster and lower-friction for
first-pass relative sizing (spec Story D). A fixed default mapping makes capacity math work
immediately while remaining transparent and adjustable. Sizing is an overlay attribute until
commit (FR-5.3), so no premature Jira writes.

---

## Resolved unknowns

All Technical Context items are resolved; **no `NEEDS CLARIFICATION` remains**. React Flow is
the only new dependency; everything else reuses existing modules, patterns, and the proxy.
