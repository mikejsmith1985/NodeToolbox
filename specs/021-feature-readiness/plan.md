# Implementation Plan: Feature Status & Readiness Workspace

**Branch**: `feature/021-feature-readiness` | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-feature-readiness/spec.md`

## Summary

Add a **Readiness tab to the ART View** (the Agile Hub Train space): three PI lenses (Carryover /
Current PI / Upcoming PI) over one shared feature evaluation, a feature listing with the org
dashboard's five hygiene-alert families rendered as flags **with inline fixes** (reusing the proven
`featureReviewFixes` writers, `TransitionRequiredFields`, and the IssueMeta chip vocabulary), and a
**gated propose-only AI insights panel** following the `ArtView/ai` (016) precedent. Everything is
client-side against the existing Jira proxy; two new configurable field families (Estimate NF,
Spark ID/PCode) extend the existing hygiene field-config discovery.

## Technical Context

**Language/Version**: TypeScript (React 18, Vite) — existing client stack only

**Primary Dependencies**: existing only — `jiraApi` proxy helpers, `featureReviewFixes` writers,
`TransitionRequiredFields`, IssueMeta chips, `IssueDetailPanel`, `useAiAssistExchange`,
`extractJsonPayload`, `classifyStatusBucket` (workflowDelivery), `detectImpedimentReasons`
(artHelpers), hygiene field-config discovery (`loadHygieneFieldConfig` / `matchFieldIdsByName`)

**Storage**: localStorage only — reuses `tbxARTSettings` (piFieldId, featureProjectKeys) and
`nodetoolbox-art-teams` (roster, jiraLabel); no new persisted keys required for v1

**Testing**: Vitest + React Testing Library (client), TDD red-first per Article V

**Target Platform**: NodeToolbox SPA (all supported browsers), no server changes

**Project Type**: web client feature inside an existing view (ArtView)

**Performance Goals**: three lens queries ≤ 1 Jira search each (max 200 results/scope, the
existing `piReviewPullFeatures` ceiling); lens switch is pure client re-grouping (no refetch)

**Constraints**: zero new dependencies; NO refactors of existing ArtView tabs (spec FR-012); the
three merged Agile Hub views' 020 guarantees stay intact; honest-empty-state doctrine (GH #167)

**Scale/Scope**: ARTs with up to ~200 features per lens; 5 alert families; 3 lenses

## Constitution Check

| Article | Gate | Status |
|---|---|---|
| I Best route | Reuse-first design; no quick hacks | PASS — every write path and chip is an existing shared module |
| II Process protection | No process management involved | PASS |
| III Branching | `feature/021-feature-readiness` off main | PASS |
| IV Code quality | New modules follow naming/comment rules | PASS (enforced in tasks) |
| V Testing | Red-first vitest for scan, fixes, panel, AI parser | PASS (test tasks precede impl) |
| VI Documentation | CHANGELOG entry; no auxiliary docs beyond specs/ | PASS |
| VII Framework-first | One drift: a Readiness-specific fix control instead of reusing `HygieneFixControl` — justified because readiness alerts need dual-target ownership and PCode normalization that the check-id-keyed hygiene descriptor table cannot express; the control still delegates every WRITE to `featureReviewFixes` | PASS with recorded justification |
| VIII Release | Local pipeline only | PASS |
| IX Vault | No secrets touched | PASS |
| X Verification | Quickstart validation scenarios + evidence-based checks | PASS |
| XI Output restraint | No dashboards/summaries beyond the feature itself | PASS |

Re-evaluated after Phase 1 design: no new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/021-feature-readiness/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── checklists/requirements.md
└── contracts/
    ├── readiness-scan.md
    ├── inline-fixes.md
    └── ai-insights.md
```

### Source Code (repository root)

```text
client/src/views/ArtView/
├── ArtView.tsx                       # +1 tab entry {key:'readiness'}, +panel mount, +initial-tab URL param (only shipped file edited beyond field config)
├── hooks/useArtData.ts               # +'readiness' in ArtTab union; +initialTab-from-URL seed (additive)
└── readiness/                        # NEW — everything else lives here
    ├── ReadinessPanel.tsx            # lens strip + summary + listing (thin composition)
    ├── ReadinessPanel.test.tsx
    ├── ReadinessPanel.module.css
    ├── readinessScan.ts              # PURE: one evaluation → lenses + alerts (FR-010)
    ├── readinessScan.test.ts
    ├── readinessFeatureQuery.ts      # JQL builders + fetch (PI-scoped, portfolio-project rule)
    ├── readinessFeatureQuery.test.ts
    ├── ReadinessFixControl.tsx       # per-alert inline fixes (delegates writes to featureReviewFixes)
    ├── ReadinessFixControl.test.tsx
    └── ai/
        ├── readinessAiAssist.ts      # prompt builder + reply parser (kind:'featureReadiness')
        ├── readinessAiAssist.test.ts
        ├── ReadinessAiPanel.tsx      # gated panel (PiReviewAiPanel model)
        └── ReadinessAiPanel.test.tsx

client/src/views/Hygiene/checks/
├── hygieneChecks.ts                  # +estimateFieldIds, +pcodeFieldIds on HygieneFieldConfig (additive, default [])
└── hygieneFieldConfig.ts             # +name matching for ['Estimate (NF)','Estimate'] and ['Spark ID','PCode']
```

## Phase 0: Research → [research.md](./research.md)

All unknowns resolved; key decisions:

1. **Feature discovery JQL** follows the `piReviewPullFeatures` precedent (portfolio-project rule):
   `issuetype = Feature AND cf[<piFieldNumber>] <PI clause>`, scoped by `project in
   (featureProjectKeys)` when configured, else by the roster's `jiraLabel`s, else unscoped —
   NEVER by team projectKey. PI field id from `tbxARTSettings.piFieldId` (default
   `customfield_10301`).
2. **Lens PI derivation** from the ArtView's live `availablePiNames` (sorted): Current = selected
   PI; Upcoming = the next-newer PI name (absent ⇒ lens states "no upcoming PI configured");
   Carryover = up to the 4 next-older PI names with a not-done status filter applied client-side.
3. **Refinement (clarified in spec)** = state-based via `classifyStatusBucket`: To Do bucket ⇒
   unrefined; In Progress/Done buckets ⇒ refined. State groups render by real status names,
   bucketed for counts.
4. **Blocker/risk signals** reuse `detectImpedimentReasons` per feature (pure, JiraIssue-only).
5. **Field families** (Estimate NF, PCode, Product Owner, Target Start/End) resolve through the
   existing hygiene field-name discovery; two additive keys extend `HygieneFieldConfig`.
6. **Deep linking**: ReadinessPanel owns `?readinessLens=` / `?readinessFilter=`; ArtView gains a
   one-time initial-tab seed from `?artTab=` (foreign params already ride through the Agile Hub
   shell untouched — 020 guarantee).

## Phase 1: Design → data-model.md, contracts/, quickstart.md

- **[data-model.md](./data-model.md)** — ReadinessFeature, ReadinessLens, ReadinessAlert,
  field-config additions, AI proposal shapes.
- **[contracts/readiness-scan.md](./contracts/readiness-scan.md)** — lens membership rules, alert
  predicates, the single-evaluation guarantee (FR-010), and the honesty rules (empty scope,
  unconfigured families).
- **[contracts/inline-fixes.md](./contracts/inline-fixes.md)** — alert→writer mapping (all writes
  via `featureReviewFixes`), ownership dual-target rule, PCode normalization, transitions with
  required screen fields.
- **[contracts/ai-insights.md](./contracts/ai-insights.md)** — gating, `{kind:'featureReadiness',
  items[]}` envelope, allowed proposal fields (estimate, targetEnd, dueDate, insight note —
  ownership deliberately excluded from AI writes), per-item accept.
- **[quickstart.md](./quickstart.md)** — runnable validation scenarios per user story.

## Hard rules for implementation

- `readinessScan.ts` is the ONLY place lens membership and alert predicates exist; the panel and
  counts consume its one output (agree-by-construction, FR-010 / SC-003).
- Every Jira write goes through `featureReviewFixes` helpers — no new fetch-to-Jira code paths.
- No behavior change to any existing ArtView tab; `ArtView.tsx` edits are additive only.
- AI panel renders `null` while locked; no AI hint of any kind leaks into the locked UI.
- Empty scope ⇒ explicit message + no healthy zeros; unconfigured field family ⇒ "not checked — no
  matching field" and excluded from counts.
