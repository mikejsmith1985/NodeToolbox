# Implementation Plan: Feature Canvas — Backlog Triage & Planning Board

**Branch**: `feature/feature-canvas` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-feature-canvas/spec.md`

## Summary

Add a **Feature Canvas**: a new top-level, lazy-loaded view that renders scoped Jira
features as freely-positioned, draggable nodes on a pan/zoom surface, and lets a Scrum
Master box those nodes into **release** and **sprint** containers within capacity budgets.
A resumable five-stage coach (Surface → Stabilize WIP → Prioritize → Size → Sequence &
Box) guides the user through recovering a chaotic backlog in short daily sessions. All
arrangement work lives in a persisted, client-side **planning overlay** and never touches
Jira until an explicit **Review & Commit** diff is confirmed; provisional sprints/versions
are reconciled to real Jira objects at commit. A hidden, passphrase-gated AI accelerator
can pre-fill *suggestions* via the existing copy-paste-JSON round-trip, but no stage
depends on it.

**Technical approach** (from research):
- **Rendering**: adopt **React Flow (`@xyflow/react` v12)** for the node canvas — it
  natively provides free x/y node drag, pan/zoom, and container (group) nodes at 200+
  nodes, which `@dnd-kit` structurally cannot (see Framework-First gate below). Loaded via
  the repo's proven on-demand `await import()` / first `React.lazy` route so it stays off
  the shared bundle.
- **Data in**: reuse `fetchFeatureReviewItems` (features + health + completion + hygiene +
  child rollup) at the active ART team + PI scope; reuse `evaluateHygieneIssue` per node.
- **Persistence**: hand-rolled `localStorage` planning-overlay blob keyed
  `tbxFeatureCanvasOverlay:{profileId}:{scopeKey}` via the existing
  `buildTeamScopedStorageKey` idiom — matching how the Sprint Dashboard config persists.
- **Data out (commit)**: reuse existing write helpers (`jiraPut` story points / fixVersion,
  `POST /rest/agile/1.0/sprint/{id}/issue` sprint move); add two **new** writes that the
  proxy already forwards — `POST /rest/agile/1.0/sprint` (create sprint) and
  `POST /rest/api/2/version` (create fixVersion) — for provisional-container reconciliation.
- **AI accelerator**: reuse the `aiAssistStore` Ctrl+Alt+Z gate and mirror
  `releaseAiAssistNotes.ts` (prompt build → strict JSON extract/validate → accept/reject).

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19.2 (client SPA)

**Primary Dependencies**:
- **NEW**: `@xyflow/react` (React Flow v12) — node canvas / pan-zoom / group containers,
  lazy-loaded. This is the single new runtime dependency.
- Existing (reused): `zustand` 5 (overlay state), `react-router-dom` 7 (route),
  `client/src/services/jiraApi.ts` (`/jira-proxy` reads & writes), `recharts` (optional
  mini capacity indicators). `@dnd-kit/*` is unaffected and not used on the canvas surface.
- Backend: existing Express `/jira-proxy` passthrough — **no server change required**.

**Storage**: Client-side `localStorage` planning-overlay JSON blob, team+scope scoped
(`tbxFeatureCanvasOverlay:{profileId}:{scopeKey}`). No backend persistence in this release
(cross-device durability is a documented non-goal; the server-side JSON-file store pattern
in `src/services/dailyChecklistStore.js` is the noted future path). Jira is the system of
record, written only at commit through the existing proxy.

**Testing**: Vitest (`vitest run`) for unit tests of all pure logic (WIP calc, capacity
summation, overlay serialize/deserialize + migration, commit-diff builder, AI JSON
extract/validate). `@testing-library/react` + `@testing-library/user-event` + `jsdom` for
component/interaction tests (drag-into-container, capacity warning state, provisional
reconciliation prompt, manual-parity when AI locked). *(Note: this project's UX harness is
Vitest/RTL/user-event; it does not use Cypress. Constitution Article V's Cypress guidance
is specific to the Forge Terminal codebase, not NodeToolbox.)*

**Target Platform**: Desktop web browser (single-operator SPA view).

**Project Type**: Web — React SPA frontend (`client/`) over an existing Express proxy
(`server.js`). This feature is frontend-only.

**Performance Goals**: Interactive (imperceptible drag latency) at **≥200 nodes** (SC-8);
surface ~150 features in **<60s** (SC-1), gated mostly by the existing feature-fetch, not
rendering.

**Constraints**:
- **No implicit Jira writes** — every mutation flows through the explicit Review & Commit
  diff (sandbox model, Q1=A).
- **Manual parity** — every stage fully operable with AI locked; AI is additive only (SC-9).
- **Minimal dependency footprint** — exactly one new dep (React Flow), lazy-loaded.
- **Reuse-first** — hygiene, blueprint health/completion, WIP classification, scope
  settings, and Jira write helpers are reused, not reimplemented.

**Scale/Scope**: ~150–200 feature nodes per canvas; feature-first nodes expandable to child
stories (Q2=A); one active ART team + PI scope at a time.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Work on a feature branch; PR to main | ✅ On `feature/feature-canvas` |
| IV — Code Quality | Self-documenting names, booleans `is/has/…`, verb-first fns, <40 lines, no magic numbers, purpose + doc comments | ✅ Design decomposes into small pure helpers (see Structure); enforced during implementation |
| V — Testing | TDD; fast mocked unit tests; UX with real events | ✅ Pure logic is unit-first (Red→Green); interaction via RTL/user-event (project's real-events harness) |
| VI — Documentation | CHANGELOG is the single source of truth; no ad-hoc status docs | ✅ CHANGELOG entry added at implementation; only `specs/009-feature-canvas/*` pipeline artifacts created here |
| VII — Framework-First | Confirm the codebase/framework doesn't already provide it; build custom only against a **documented gap**, recorded at the component | ✅ **Documented gap** — see gate note below. React Flow adopted for the pan/zoom node-canvas capability the repo has zero prior art for and `@dnd-kit` cannot provide |
| VIII — Release | Local pipeline only | ✅ N/A until release; `scripts/local-release.ps1` when shipped |
| IX — Vault | No secret enters conversation/file/log | ✅ Feature handles no secrets; AI gate reuses existing passphrase mechanism |
| X — Verification | Evidence, not "it compiles" | ✅ `quickstart.md` defines runnable behavioral checks (surface count, zero-write proof, commit diff) |
| XI — Output Restraint | ≤1 dashboard artifact; no phase narration | ✅ The canvas is a product UI, not an agent output artifact; no `refactor_plan.html` involved |

**Article VII gate note (the key decision)**: There is no `FRAMEWORK-CAPABILITIES.md`
ledger; Article VII requires the justification be recorded *at the component*. The
governing UI framework (React + `@dnd-kit` as the sanctioned drag primitive) does **not**
provide an interactive pan/zoom node canvas: the only `@dnd-kit` usage is a sortable grid
(`HomeView.tsx`), there is **no** `useDraggable`/multi-container/pan-zoom prior art, and
`@dnd-kit`'s collision math structurally breaks under a scaled viewport transform. The only
spatial prior art (`ArtView/dependencyGraph.ts`) is a static, non-interactive computed SVG.
Hand-rolling pan/zoom-over-drag + coordinate storage + container hit-testing at 200 nodes
would be rebuilding the substance of a purpose-built framework — the exact anti-pattern
Article VII guards against. **Decision: adopt React Flow** for the canvas surface, lazy-
loaded to respect the repo's minimal-bundle culture, with the justification comment placed
at the canvas component. No gate violation; the Complexity Tracking table is not required.

**Result: PASS (initial and post-design).**

## Project Structure

### Documentation (this feature)

```text
specs/009-feature-canvas/
├── plan.md              # This file
├── spec.md              # Feature spec (Q1=A, Q2=A, Q3=A resolved)
├── research.md          # Phase 0 output — decisions + rationale
├── data-model.md        # Phase 1 output — overlay & node entities
├── quickstart.md        # Phase 1 output — behavioral validation guide
├── contracts/           # Phase 1 output — Jira write & AI-JSON contracts
│   ├── jira-writes.md
│   └── ai-assist-json.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/
├── App.tsx                                  # +import (lazy), +route const, +<Route> (Suspense)
├── views/
│   ├── Home/homeCardData.ts                 # +AppCardDef tile (section 'agile')
│   └── FeatureCanvas/                        # NEW top-level view
│       ├── FeatureCanvasView.tsx            # Route entry: scope guard, coach shell, canvas host
│       ├── canvas/
│       │   ├── FeatureCanvasBoard.tsx       # React Flow host (nodes, group containers, pan/zoom)
│       │   ├── FeatureNode.tsx              # Node card: status color, size, health, hygiene badge
│       │   ├── ContainerNode.tsx            # Release/Sprint/ParkingLot box + capacity meter
│       │   └── nodeMapping.ts               # FeatureReviewItem[] -> React Flow node/edge model (pure)
│       ├── coach/
│       │   ├── CoachPanel.tsx               # Stage guidance + per-stage controls
│       │   └── stages.ts                    # 5 stage defs: job, decision, completion rule (pure)
│       ├── overlay/
│       │   ├── overlayModel.ts              # Overlay types + defaults (pure)
│       │   ├── overlayStorage.ts            # localStorage load/save/migrate, team+scope keyed (pure)
│       │   └── useCanvasOverlay.ts          # zustand store wrapping overlay
│       ├── logic/
│       │   ├── wip.ts                       # WIP count from status categories (pure)
│       │   ├── capacity.ts                  # container size summation vs budget (pure)
│       │   ├── sizing.ts                    # t-shirt <-> points mapping (pure)
│       │   └── commitDiff.ts                # overlay -> itemized Jira change list (pure)
│       ├── commit/
│       │   ├── ReviewCommitPanel.tsx        # diff UI + provisional reconciliation prompt
│       │   └── commitJira.ts                # executes writes via jiraApi (reuses helpers)
│       └── ai/
│           ├── canvasAiAssist.ts            # prompt build + JSON extract/validate (mirrors releaseAiAssistNotes)
│           └── AiSuggestionPanel.tsx        # gated accept/reject UI
└── services/jiraApi.ts                      # +createSprint(), +createVersion() thin helpers (new endpoints)

client/src/views/FeatureCanvas/**/__tests__/  # Vitest unit + RTL component tests, colocated
```

**Structure Decision**: A **new top-level view** (`client/src/views/FeatureCanvas/`) rather
than a Sprint Dashboard sub-tab — the canvas needs full-page real estate for pan/zoom at
200 nodes, and a sub-tab inside the dashboard's dense tab bar would cramp it. It is
**lazy-loaded** (first `React.lazy` route + a `Suspense` boundary in `App.tsx`) because it
pulls React Flow; this mirrors the existing on-demand `await import('xlsx')` philosophy and
keeps the shared bundle unchanged for users who never open the canvas. Pure logic (mapping,
WIP, capacity, sizing, commit-diff, overlay storage, AI JSON) is isolated into
side-effect-free modules so it is unit-testable in <10ms per Article V, with React Flow and
Jira I/O confined to the component/commit layers.

## Complexity Tracking

> Not required — Constitution Check passes with no unjustified violations. The single new
> dependency (React Flow) is the *resolution* of the Framework-First gate, not a violation
> of it, and is documented at the component per Article VII.
