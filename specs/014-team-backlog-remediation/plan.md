# Implementation Plan: Per-Team Persistent Backlog Remediation

**Branch**: `feature/014-team-backlog-remediation` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/014-team-backlog-remediation/spec.md`

## Summary

Relocate the **actionable** Aging cleanup triage into a **per-team, persistent Backlog Remediation panel on the
Team Dashboard**. The Aging *metrics* report stays in the Reports Hub. Almost everything is reuse — the triage
prompt/parse, action model, actionable table, and bulk-close already exist and are pure/portable. The **only
genuinely new logic** is a per-team persisted **remediation store** plus a pure **reconciliation** step that keeps
handled work from resurfacing (with the FR-013 material-change re-entry rule).

Work is layered so the new, risk-bearing persistence lands and is proven **before** the UI relocation:

1. **Remediation state + reconciliation (pure, TDD)** — the heart. A per-team persisted queue and a pure function
   that merges a freshly-fetched backlog against saved decisions: drop out-of-scope items, hide terminal decisions,
   elapse snoozes, and re-admit an item only on a **material change** (status-category change OR reassignment into
   the team). No Jira, no React, no clock (today injected) → 100% unit-testable. *(FR-007–FR-013, FR-017; SC-001,
   SC-002, SC-003.)*
2. **Backlog fetch extraction** — lift the enriched triage fetch + `toTriageIssue` out of `IssueAgingTab.tsx` into a
   reusable module so the dashboard panel builds the same `AgingTriageIssue[]` the Reports Hub triage did. *(FR-016,
   FR-018.)*
3. **Team-scope resolution** — derive the backlog scope from the active team profile (project / board / roster
   `assignee in (...)`), with an optional **per-team JQL override**. *(FR-004–FR-006.)*
4. **The panel + wiring + Reports Hub cleanup** — a new gated Team Dashboard tab that composes the reused triage
   UI over the persisted queue; remove the actionable triage from the Reports Hub (metrics stay). *(FR-001–FR-003,
   FR-014, FR-015.)*

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19 (client SPA). Frontend-only; no server change.

**Primary Dependencies**: All reuse — `agingTriage.ts` (prompt/parse), `agingTriageActionModel.ts`,
`AgingTriageActionTable.tsx`, `agingBulkTransition.ts` + `AgingBulkClosePanel.tsx`, `storyPointsField.ts`,
`ReportAiPanel.tsx` (self-gating AI shell), feature 012's persistence primitives (`deriveScopeKey`,
`teamScopedStorage`, the `useReallocationDetailsStore` shape), and `featureReviewFixes.ts`
(`fetchFeatureReviewTransitions` / `saveFeatureReviewTransition`).

**Storage**: Browser localStorage, per team, under `tbxBacklogRemediation:<teamProfileId>:<projectKey>:<piName>`
(same construction as `tbxReallocationDetails` via `resolveTeamScopedStorageProfileId` + `deriveScopeKey`). No
server-side entity.

**Testing**: Vitest + React Testing Library. The store's reconciliation is pure logic → exhaustive unit tests
(<10ms, `today` injected): out-of-scope drop, terminal-hide, snooze elapse, material-change re-entry (status
category vs reassignment), cross-team isolation. The panel gets RTL tests (gated render, ingest → persisted queue,
scope override, bulk-close reflected in state).

**Target Platform**: Desktop web browser (SPA).

**Project Type**: Web — React SPA (`client/`).

**Performance Goals**: One team's NOT-Done backlog (tens–low hundreds of items, capped at 2000 like today);
reconciliation is a single linear merge — trivially fast.

**Constraints**: Read-tolerant persistence (corrupt/missing → empty queue, never throw); zero new Jira write paths
(reuse Feature Review transitions); AI-gated exactly as today; no cross-team bleed.

**Scale/Scope**: Per-team queues, single operator per app profile; local persistence only.

## Constitution Check

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ `feature/014-team-backlog-remediation` |
| IV — Code Quality | Small pure functions, doc comments, verb-first names | ✅ Reconciliation decomposes into small pure helpers |
| V — Testing | TDD; fast mocked units before impl | ✅ Layer 1 is pure unit-first; panel gets RTL tests |
| VI — Documentation | CHANGELOG; no ad-hoc docs | ✅ CHANGELOG at implementation; only `specs/014-*` artifacts |
| VII — Framework-First | Reuse, don't rebuild | ✅ Triage stack, persistence pattern, write helpers, AI gate all reused; only the per-team queue + reconciliation are new (no existing module provides them) |
| VIII — Release | Local pipeline only | ✅ N/A until release |
| IX — Vault | No secrets | ✅ None |
| X — Verification | Evidence, not "it compiled" | ✅ quickstart defines behavioral checks; reconciliation proven by unit tests |
| XI — Output Restraint | ≤1 dashboard; no phase narration | ✅ A dashboard *tab*, not a dashboard artifact |

**Framework-First note**: The per-team remediation store and its reconciliation are legitimately custom — no existing
module tracks per-item remediation lifecycle or the FR-013 re-entry rule. Everything around them (triage prompt,
action model, table, bulk-close, AI gate, scoped storage) is reuse. No Complexity Tracking entry required.

**Result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/014-team-backlog-remediation/
├── plan.md · spec.md · research.md · quickstart.md · data-model.md
├── contracts/  (remediation-store.md, reconciliation.md, scope-resolution.md)
└── checklists/requirements.md
```

### Source Code (repository root) — planned

```text
client/src/views/SprintDashboard/backlogRemediation/
├── remediationTypes.ts            # NEW: RemediationStatus, RemediationItem, RemediationQueue, ItemFingerprint, TeamScope
├── remediationReconcile.ts        # NEW (pure): reconcile(saved, freshlyFetched, todayIso) → next queue (drop/hide/elapse/re-admit)
├── remediationReconcile.test.ts   # NEW: exhaustive unit tests
├── useBacklogRemediationStore.ts   # NEW: per-team persisted store (key tbxBacklogRemediation:<profile>:<scope>), modeled on useReallocationDetailsStore
├── useBacklogRemediationStore.test.ts
├── remediationScope.ts            # NEW: resolveTeamScope(profile, override) → backlog JQL (project/board/roster clause)
├── remediationScope.test.ts
├── BacklogRemediationPanel.tsx     # NEW: gated panel — fetch → prompt → ingest → reconcile → AgingTriageActionTable
└── BacklogRemediationPanel.test.tsx

client/src/views/ReportsHub/
├── agingBacklogFetch.ts           # NEW: extracted enriched fetch + toTriageIssue (from IssueAgingTab.tsx); imported by the panel
├── IssueAgingTab.tsx              # EDIT: remove the actionable triage UI; keep the metrics report only
└── (agingTriage.ts, agingTriageActionModel.ts, AgingTriageActionTable.tsx, agingBulkTransition.ts,
     AgingBulkClosePanel.tsx, storyPointsField.ts — reused in place, unchanged)

client/src/views/SprintDashboard/
├── SprintDashboardView.tsx        # EDIT: add tab to TAB_OPTIONS + renderActiveTabPanel branch; propagate scope to the store
└── hooks/useSprintData.ts         # EDIT: add the new tab key to the DashboardTab union
```

**Structure Decision**: A new `backlogRemediation/` folder under `SprintDashboard/` isolates the genuinely new
state + reconciliation so Layer 1 lands with zero risk to the shipped dashboard. The pure triage modules stay in
`ReportsHub/` and are imported in place (cross-view imports already exist — `AgingBulkClosePanel` imports the
SprintDashboard write helpers today), avoiding a risky file move. The one extraction (`agingBacklogFetch.ts`) lets
the metrics tab keep its lighter fetch while the panel reuses the enriched one.

## Complexity Tracking

> Not required — Constitution Check passes. The custom pieces (per-team queue + reconciliation) are justified above;
> everything else is reuse.

## Phasing & checkpoints

- **Layer 1 (now)**: `remediationTypes` + `remediationReconcile` + store, pure/TDD — buildable and provable with no
  UI. **Checkpoint**: reconciliation unit tests green (drop/hide/snooze/material-change/isolation).
- **Layer 2**: extract `agingBacklogFetch.ts`; the Reports Hub metrics still render (regression guard).
- **Layer 3**: `remediationScope.ts` (team-profile-derived JQL + per-team override).
- **Layer 4**: `BacklogRemediationPanel.tsx` + dashboard tab wiring; remove the triage from `IssueAgingTab`; CHANGELOG.
  **Checkpoint**: quickstart end-to-end (two teams, persistence across reload, no resurfacing, bulk-close reflected).
