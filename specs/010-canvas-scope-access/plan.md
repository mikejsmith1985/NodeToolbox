# Implementation Plan: Canvas Surface Scoping & AI-Tools Access Hardening

**Branch**: `feature/canvas-scope-access` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-canvas-scope-access/spec.md`

## Summary

Two independent, separately-releasable adjustments to the shipped Feature Canvas (009) and the
Admin Hub, driven by review feedback:

- **Area 1 — Surface scoping.** Replace the canvas's fixed team+PI surfacing with a **user-defined
  query** on Stage 1: a JQL input (pre-filled from the active team + PI), deterministic refine
  filters (label / text / status), and — passphrase-gated only — a **natural-language → JQL**
  helper. Surfaced features keep their health/completion and hygiene indicators.
- **Area 2 — Access hardening.** Remove the admin-unlock-visible **"Hidden prompt tools" checkbox**
  and its orphan flag so unlocking admin reveals no AI (the Ctrl+Alt+Z passphrase stays the sole,
  owner-only AI path). Fix Admin Access so it **requires entered credentials** instead of silently
  unlocking on empty/default fields. Optionally gate the currently-ungated **Dev Panel** behind
  admin to match the intended admin scope.

**Technical approach** (from research):
- **Area 1 surfacing**: the health/completion math (`computeBlueprintHealth`,
  `computeCompletionPercent`) is PI-*independent* but private in `blueprintHierarchy.ts`. Export a
  `fetchFeatureNodesByKeys(featureKeys, options)` that reuses the existing private child-discovery
  JQL + node builder, then add `fetchFeatureReviewItemsByJql(jql, …)` to `featureReview.ts` that
  shares the per-item build/hygiene loop with the existing PI-scoped function. Hygiene reuse is
  already per-issue (`evaluateHygieneIssue` + `fetchFeatureReviewFieldConfig`). Raw JQL runs via the
  existing `jiraGet('/rest/api/2/search?jql=…')` pattern (no shared helper exists; mirror
  `useCanvasFeatures`'s own `enrichWithIssueLinks`). `useCanvasFeatures` becomes **JQL + explicit
  Surface trigger** driven; a new header **Surface scope bar** holds the input/filters/NL helper.
- **Area 2 removal**: `isAiEnabled`/`tbxFeatureAIVisible` has **zero consumers outside AdminHub**
  (confirmed by full grep) — deleting the checkbox + flag needs no rewiring. The Ctrl+Alt+Z
  passphrase has **five** independent listeners; we delete only the admin *checkbox*, not the
  passphrase tab. The silent-unlock fix is two lines in `useAdminHubState.ts` (`tryUnlock`) — drop
  the `|| DEFAULT_…` fallbacks and require non-empty input; the server already rejects truly-empty
  input.

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19 (client SPA). Backend Express unchanged.

**Primary Dependencies**: **None new.** Reuses `blueprintHierarchy` (health/completion + child
discovery), `hygieneChecks` (`evaluateHygieneIssue`), `featureReview` (item building +
`fetchFeatureReviewFieldConfig`), `jiraApi` (`jiraGet` search), `aiAssistStore` (Ctrl+Alt+Z gate),
`canvasAiAssist` (copy-paste round-trip), and the existing Admin Hub flow.

**Storage**: No change. The canvas overlay (localStorage) and admin unlock (sessionStorage
`tbxAdminUnlocked`) are untouched. The orphan `tbxFeatureAIVisible` flag is *removed*. No server or
persistence change; `/api/admin-verify` is unchanged.

**Testing**: Vitest + `@testing-library/react` + `user-event` (project harness). Pure logic
(default-JQL builder, refine filters, NL→JQL parsing) unit-first; component/hook tests for the
scope bar, the JQL-driven fetch hook, the admin checkbox removal, and the admin credential-entry
requirement.

**Target Platform**: Desktop web browser (SPA).

**Project Type**: Web — React SPA (`client/`) over an existing Express proxy. Frontend-only; **no
server change**.

**Performance Goals**: Surfacing a query result is bounded by the existing feature fetch (same as
009); no new performance-sensitive path. Canvas rendering is unchanged.

**Constraints**:
- **Manual parity (Area 1)** — every scoping capability works with AI locked; NL→JQL is additive.
- **No AI on admin unlock (Area 2)** — unlocking admin (password) must reveal zero AI.
- **No silent admin unlock** — real entered credentials required.
- **No regression** to admin-gated operational features (SNow/GitHub config, connectivity creds,
  advanced controls, dev utilities) or to the passphrase-gated AI surfaces.
- **Minimal dependency footprint** — no new dependencies.

**Scale/Scope**: Small, surgical change set across two areas; ~8–10 source files touched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ On `feature/canvas-scope-access` |
| IV — Code Quality | Self-documenting names, small functions, doc/purpose comments | ✅ New helpers are small and pure; enforced during implementation |
| V — Testing | TDD; fast mocked units; real-events UX | ✅ Pure JQL/filter/NL logic unit-first; RTL for scope bar + admin changes |
| VI — Documentation | CHANGELOG is source of truth; no ad-hoc docs | ✅ CHANGELOG entries at implementation; only `specs/010-*` pipeline artifacts here |
| VII — Framework-First | Don't rebuild what the codebase provides | ✅ **Reuse-only** — no new infra; export/extract existing blueprint + hygiene + search; no new deps |
| VIII — Release | Local pipeline only | ✅ N/A until release (`scripts/local-release.ps1`) |
| IX — Vault | No secret in conversation/file/log | ✅ No secret handled. The admin default `admin:toolbox` is pre-existing source, not a vault secret; the change removes the client's silent submission of it |
| X — Verification | Evidence, not "it compiles" | ✅ `quickstart.md` defines behavioral checks (query-scoped surface, no-AI-on-admin-unlock, no empty-field unlock) |
| XI — Output Restraint | ≤1 dashboard artifact; no phase narration | ✅ No dashboard artifact involved |

**Framework-First note (Article VII)**: This feature adds **no** new abstraction. Area 1 *extracts
and exports* existing private functions (`fetchFeatureNodesByKeys` reusing the blueprint's own
child-discovery + node builder; `computeBlueprintHealth`/`computeCompletionPercent` are already the
right primitives) rather than reimplementing health/completion. Area 2 is pure deletion + a
two-line credential-entry fix. No custom-vs-framework tension exists; the Complexity Tracking table
is not required.

**Result: PASS (initial and post-design).**

## Project Structure

### Documentation (this feature)

```text
specs/010-canvas-scope-access/
├── plan.md              # This file
├── spec.md              # Feature spec (Q1=A, Q2=A, Q3=work-as-designed)
├── research.md          # Phase 0 — decisions + rationale
├── data-model.md        # Phase 1 — scope-query & filter entities; removed/changed state
├── quickstart.md        # Phase 1 — behavioral validation guide
├── contracts/
│   ├── surface-scope.md # Area 1: JQL surfacing + NL→JQL contract
│   └── admin-access.md  # Area 2: what changes / what is preserved in Admin
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/
├── views/
│   ├── ArtView/blueprintHierarchy.ts          # +export fetchFeatureNodesByKeys (reuse private child-fetch + node builder)
│   ├── SprintDashboard/featureReview.ts        # +fetchFeatureReviewItemsByJql; extract shared buildFeatureReviewItem
│   ├── FeatureCanvas/
│   │   ├── canvas/scopeQuery.ts                # NEW (pure): default-JQL builder + refine filters (label/text/status)
│   │   ├── canvas/SurfaceScopeBar.tsx          # NEW: JQL input + Surface button + filter chips + gated NL→JQL helper
│   │   ├── canvas/useCanvasFeatures.ts         # JQL + explicit-Surface-trigger fetch (replaces auto team+PI effect)
│   │   ├── FeatureCanvasView.tsx               # render SurfaceScopeBar in a header region; wire surface + refine
│   │   └── ai/canvasAiAssist.ts                # +'scopeQuery' kind (NL description → proposed JQL)
│   └── AdminHub/
│       ├── AdminHubView.tsx                     # remove "Hidden prompt tools" checkbox + its props; (optional) gate Dev Panel behind isAdminUnlocked
│       └── hooks/useAdminHubState.ts            # remove isAiEnabled/FEATURE_AI_KEY; require non-empty entered credentials in tryUnlock

client/src/views/**/**.test.ts(x)               # colocated sibling tests (repo convention)
```

**Structure Decision**: The **Surface scope bar** is a new header region in `FeatureCanvasView`
(not a CoachPanel stage control), because surfacing is **view-level** (it changes the whole feature
set), whereas the CoachPanel mutates per-node overlay state. Area 1's data path adds one export to
`blueprintHierarchy` and one JQL-sourced function to `featureReview`, keeping health/completion
computation in its existing home (no duplicated math). Area 2 touches only the two Admin Hub files
and is mostly deletion. Pure logic (`scopeQuery.ts`, the NL→JQL parse in `canvasAiAssist.ts`) is
isolated for <10ms unit tests (Article V); Jira I/O stays in the fetch hook/functions.

## Complexity Tracking

> Not required — Constitution Check passes with no violations. No new dependencies or abstractions;
> the change reuses/extracts existing primitives and deletes an orphan flag.
