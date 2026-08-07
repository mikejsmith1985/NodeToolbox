# Implementation Plan: Feature Roll-Up Board

**Branch**: `feature/034-feature-rollup-board` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/034-feature-rollup-board/spec.md`

## Summary

A new **Roll-Up Board** tab on the Team space (Sprint Dashboard) that re-renders the team's already-selected Jira
board as a stack of **Feature swimlanes**. One shared column header row runs across the whole board; each Feature is
a collapsible lane; every issue sits in the column matching its *own* status; parentage is drawn with **per-column
parent containers** (GH #306's rendering). Columns are the team's **own status names**, each mapped to a Jira
status + sub-status pair, published to and pulled from Confluence so the whole team reads the board in one language.

The recon finding that shapes this plan: **almost all of it already exists.** Board selection, board issue fetch,
cross-project Feature resolution, the sub-task sweep, transition-with-screen-fields writing, in-place field editing,
the semantic chip vocabulary, drag-and-drop, and a three-way-merged Confluence config store are all shipped. Four
things are genuinely new, and three of them are pure functions:

| New | Kind | Why it does not exist |
|-----|------|----------------------|
| `defectRollup` precedence chain | pure | `featureLink.ts` resolves **one hop** (child → Feature). A defect reaching its Feature via a QA issue via a Story is a **chain**, and nothing walks it. |
| Column vocabulary + status/sub-status mapping | pure + store | No status-aliasing exists. `StatusMappingEditor` is Jira→SNow, a different concept. |
| Swimlane / column / parent-container layout | pure | No board in the product renders columns; DSU and Standup boards are section lists. |
| Board vocabulary Confluence property | service | See the one Article VII drift in Complexity Tracking. |

Everything else is wiring.

## Technical Context

**Language/Version**: TypeScript 5 / React 18 (client), ES modules

**Primary Dependencies**: React, Zustand (stores), React Router (deep links), `@dnd-kit/core` + `@dnd-kit/sortable`
(**already a dependency** — `client/package.json`), CSS Modules. **No new packages.**

**Storage**:
- Team column vocabulary → Confluence content property (shared) + localStorage mirror
- Personal card order and lane collapse state → localStorage, per person / team / board
- No server-side persistence, no new backend route

**Testing**: Vitest + Testing Library (`npm test` in `client/`). Pure modules unit-tested first (Article V, red → green).

**Target Platform**: Browser client of NodeToolbox, mounted inside the Agile Hub **Team** space

**Project Type**: Client-side feature module inside an existing React SPA

**Performance Goals**: ~300 issues fully rendered and readable within 5 s (SC-012); board opens with every lane
collapsed so first paint is Feature-headers only

**Constraints**:
- Never truncate the issue set (FR-055)
- Never write Jira rank (FR-046)
- No AI on this surface (spec Out of Scope)
- Zero regression to the Sprint Dashboard's existing tabs — this is an **additive tab**, not a refactor of
  `SprintDashboardView` (spec 020 FR rule)

**Scale/Scope**: ~300 issues, ~10–40 Feature lanes, ~4–12 columns; roughly 11 new modules + 8 components, plus 3
small additive edits to shipped files

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Article | Gate | Pre-Phase-0 | Post-Phase-1 |
|---------|------|-------------|--------------|
| **III — Branching** | Work on `feature/*`, never `main` | ✅ `feature/034-feature-rollup-board` | ✅ unchanged |
| **IV — Code Quality** | Self-documenting names, `is/has/can/should/was` booleans, verb-first functions, <40-line functions, file purpose comments, no magic numbers | ✅ enforced in design (named constants for chunk sizes, column ids, storage keys) | ✅ `boardLayout.ts` is split into four named helpers — `computeLaneVitals`, `distributeItemsIntoColumns`, `groupItemsIntoParentContainers`, `orderLanes` — each under 40 lines, with `buildBoardLayout` as the thin composition. Instructed by task T025. |
| **V — Testing** | TDD red → green; unit tests mock all I/O and are fast | ✅ 6 of the 9 logic modules are **pure** and testable with zero mocking | ✅ contracts define the assertions before code |
| **VI — Documentation** | CHANGELOG is the single source of truth; no ad-hoc status docs | ✅ CHANGELOG entry planned; only `specs/033-*` artifacts created | ✅ |
| **VII — Framework-First** | Confirm the codebase does not already provide it; justify drift at the component | ✅ full reuse ledger in [research.md](./research.md); **1** drift | ✅ drift recorded below and in the contract |
| **VIII — Release** | Local pipeline only | ✅ not a release change | ✅ |
| **IX — Vault** | No secret in conversation/file/log | ✅ no credentials involved | ✅ |
| **X — Verification** | Behaviour proved with evidence, not "it compiles" | ✅ [quickstart.md](./quickstart.md) defines live-Jira proofs per user story | ✅ |
| **XI — Output Restraint** | ≤1 dashboard artifact, no phase narration, no unsolicited summaries | ✅ no dashboard produced | ✅ |

**Additional project rule — "surfaces agree by construction"**: the Master Card figures and the child cards are
computed from **one** resolved issue set, and the figures are computed **before** filtering (FR-014). There is no
second computation that could disagree.

**Gate result**: PASS with one recorded Article VII drift (below).

## Project Structure

### Documentation (this feature)

```text
specs/034-feature-rollup-board/
├── plan.md              # This file
├── spec.md              # Feature specification (8 clarifications integrated)
├── research.md          # Phase 0 — reuse ledger and resolved unknowns
├── data-model.md        # Phase 1 — entities, shapes, invariants
├── quickstart.md        # Phase 1 — how to prove it works
├── contracts/
│   ├── board-assembly.md      # fetch → resolve → roll-up, incl. defect precedence
│   ├── board-layout.md        # swimlane / column / parent-container invariants
│   ├── column-vocabulary.md   # vocabulary model, validation, mapping resolution
│   ├── status-move.md         # the write path and its partial-failure honesty rule
│   └── vocabulary-sync.md     # publish / pull via Confluence
├── checklists/
│   └── requirements.md  # spec quality checklist (16/16)
└── tasks.md             # Phase 2 output — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
client/src/views/SprintDashboard/
├── SprintDashboardView.tsx              # EDIT (additive): register the 'rollupboard' tab
├── hooks/useSprintData.ts               # EDIT (additive): 'rollupboard' in DashboardTab union
└── rollupBoard/                         # NEW — the whole feature lives here
    ├── RollupBoardTab.tsx               # tab shell: scope guard, load, error/empty states
    ├── RollupBoardTab.module.css
    ├── components/
    │   ├── BoardColumnHeaderRow.tsx     # the one shared column header row
    │   ├── MasterCardLane.tsx           # one Feature swimlane (collapsible)
    │   ├── MasterCardHeader.tsx         # the eight vitals + child count
    │   ├── ParentContainer.tsx          # per-column grouping label
    │   ├── ChildCard.tsx                # one issue card, type-coloured + labelled
    │   ├── QuickFilterBar.tsx           # type / assignee / fixVersion filters
    │   └── ColumnVocabularyEditor.tsx   # define columns, map, publish, pull
    ├── rollupBoardTypes.ts              # the data-model shapes + named constants
    ├── rollupBoardFetch.ts              # board issues + sub-task sweep + feature sweep
    ├── featureRollup.ts                 # PURE: issue → Feature key + RollUpRoute
    ├── defectRollup.ts                  # PURE: the defect precedence chain
    ├── masterCards.ts                   # PURE: items → Master Cards, incl. the No Feature card
    ├── featureProgress.ts               # PURE: % complete + its basis
    ├── boardColumns.ts                  # PURE: vocabulary model, validation, resolution
    ├── columnOptionSources.ts           # PURE: selectable status / sub-status values for the editor
    ├── boardLayout.ts                   # PURE: lanes × columns × containers (4 helpers, see below)
    ├── boardFilters.ts                  # PURE: quick-filter predicates + container pruning
    ├── statusMoveWriter.ts              # transition + sub-status write path
    ├── boardVocabularyStore.ts          # team vocabulary (local mirror of the shared record)
    ├── boardVocabularySync.ts           # publish / pull against Confluence
    └── boardPreferencesStore.ts         # personal card order + lane collapse state

client/src/services/
└── confluenceApi.ts                     # EDIT (additive): board-vocabulary content property

client/src/views/Hygiene/checks/
├── hygieneFieldConfig.ts                # EDIT (additive): subStatus + flagged field discovery
└── hygieneChecks.ts                     # EDIT (additive): two config keys on HygieneFieldConfig

client/src/views/SprintDashboard/
└── featureReviewFixes.ts                # EDIT (additive): expose transition screen field ids
```

Every new source file gets a sibling `*.test.ts(x)` — required by the repo's pre-commit hook, and by Article V.

**Structure Decision**: the feature is a **self-contained directory under the existing Team-space view**. It is not a
new top-level view, because the board's scope *is* the Team space's already-selected board (FR-001) and inventing a
second board selection is explicitly forbidden. It is not folded into existing files, because
`SprintDashboardView.tsx` is already ~5 000 lines and spec 020 forbids refactoring the merged views. The four edits
to shipped files are all **additive** — a new union member, two new config keys, one new optional interface field,
and one new exported function — so every current caller is byte-identical in behaviour.

## Phase 0 — Research

Complete. See [research.md](./research.md). Summary of what it settled:

- **9 unknowns resolved**, 0 remaining `NEEDS CLARIFICATION`.
- The sub-status field is real and already written server-side (`customfield_10201`); the client discovers it by
  **name** through the existing `loadHygieneFieldConfig` layered-discovery pattern, never by hardcoded id.
- Board issues do **not** include sub-tasks; a second `parent in (…)` sweep is required, and
  `plannerFetch.fetchSubtasksForParents` is the proven pattern to mirror.
- The shared ART workspace **cannot** carry the vocabulary safely — this produced the one Article VII drift.
- The status + sub-status write can be **atomic** when the sub-status field is on the transition screen; when it is
  not, the two-step write needs an explicit honesty rule, which is a **gap in FR-022** (flagged below).

## Phase 1 — Design & Contracts

Complete. Artifacts:

- [data-model.md](./data-model.md) — 11 entities with their invariants; the "parent rendered once" rule is expressed
  as a data invariant, not a UI convention, so it is unit-testable.
- [contracts/board-assembly.md](./contracts/board-assembly.md) — the fetch/resolve pipeline and the defect precedence
  chain, with the exact tie-break and loop-termination rules.
- [contracts/board-layout.md](./contracts/board-layout.md) — the layout invariants that make FR-002 and SC-001
  provable.
- [contracts/column-vocabulary.md](./contracts/column-vocabulary.md) — the vocabulary shape, its validation rules,
  and how an issue resolves to a column (or to `unmapped`).
- [contracts/status-move.md](./contracts/status-move.md) — the write path, atomic vs two-step, and the partial-failure
  rule.
- [contracts/vocabulary-sync.md](./contracts/vocabulary-sync.md) — publish/pull, the separate Confluence property, and
  the back-compat guarantee.
- [quickstart.md](./quickstart.md) — the evidence required to call this done (Article X).

### Build order (dependency-driven, TDD)

1. **Pure core** — `boardColumns` → `defectRollup` → `featureRollup` → `featureProgress` → `boardLayout` →
   `boardFilters`. All six are pure; all six get failing tests first; none needs a mock.
2. **Shipped-file extensions** — field discovery, transition screen ids, Confluence property. Small, additive,
   each with a regression test proving existing callers are unaffected.
3. **Stores** — vocabulary (team) and preferences (personal).
4. **Fetch** — board issues, sub-task sweep, feature sweep, completeness reporting.
5. **Write path** — `statusMoveWriter`.
6. **Components** — header row → lane → container → card → filters → vocabulary editor.
7. **Tab registration** — the two additive edits to `SprintDashboardView` / `useSprintData`.
8. **CHANGELOG**.

Layers 1 and 2 are independent of each other and can proceed in parallel.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **Article VII drift — a new Confluence content property (`nodetoolbox-board-vocabulary`) instead of extending the shared ART workspace payload** | The vocabulary must be shared team-wide, and the shared ART workspace is the product's existing mechanism for exactly that. But it cannot carry this safely in either available form. | **Bumping `SHARED_ART_WORKSPACE_SCHEMA_VERSION` 2 → 3** was rejected because `loadSharedArtWorkspace` **hard-rejects** any payload whose version exceeds the client's own (`confluenceApi.ts:375`) — every client that predates this feature would stop loading the entire workspace, not just the new field. That breaks FR-019e outright. **Adding `boardColumns` to the existing v2 team record** was rejected because `mergeSharedArtTeamRecord` merges strictly over `SHARED_ART_TEAM_FIELD_NAMES` (`ArtView.tsx:3518`); an older client that publishes would silently **drop** the vocabulary, producing exactly the quiet data loss this project's honesty rules forbid. A sibling property has an established precedent in this same file — the Jira template store is kept as its own property, commented "kept independent so the ART schema is untouched" (`confluenceApi.ts:399`) — so this is the codebase's own answer to this problem, reused rather than invented. |

No other gates required justification.

## Resolved: the FR-022 partial-write case

**Raised during Phase 1, confirmed by `/speckit-analyze`, now reconciled in the spec.**

FR-022 originally stated that a failed move returns the card to its original column. That is correct when the write
fails as a unit, but when the sub-status is *not* on the transition screen the write is necessarily two steps, and
the first can succeed while the second fails. Snapping the card back would then display a **falsehood** — Jira really
did change the status.

The spec now carries the carve-out explicitly:

- **FR-022** — refused, or failed **as a unit** ⇒ the card returns to origin.
- **FR-022a** — two-step partial success ⇒ the card does **not** revert; the issue is re-read, rendered at its true
  state, and the message names exactly what was applied and what was not.
- **FR-022b** — the single-step write is preferred whenever the transition screen carries the sub-status field, so
  FR-022a's case arises only when Jira leaves no alternative.

`contracts/status-move.md` §3–§4 and tasks T032/T037 implement precisely this. No open conflict remains.
