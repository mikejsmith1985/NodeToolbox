# Implementation Plan: PI Planning Automation

**Branch**: `feature/028-pi-planning-automation` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/028-pi-planning-automation/spec.md`

## Summary

Add an AI-assisted PI planner to the PI Review surface that turns the PI Review picture (roster, per-sprint capacity, Feature sizes, PI dates, production release schedule) into a reviewable, rules-driven plan: a Feature→Story breakdown, the standard sub-task scaffold (internal test + deploy INT/REL/PROD), a capacity-mapped sprint schedule, and populated Target Start / Target End / Due dates — all propose-only, per-item accepted, and written to Jira only on acceptance.

**Technical approach — reuse-first (Framework-First gate).** The recon confirmed the heavy machinery already exists:

- **Scheduling + capacity mapping + assignment** are already delivered by the deterministic **`FeatureCanvas/planner`** engine (`buildCapacityPlan`, `capacityTypes.ts`). It consumes `PlanItem { devPoints, internalTestPoints, externalTestPoints, bucket, rankInBucket, assignee }` + `PersonCapacity { roles, pointsPerSprint }` and produces `ProjectedSprint[]` with per-person `SprintPersonLoad`, `AssignmentProposal[]`, a `BottleneckReport`, a completion date, and `unschedulableItemKeys`. That is exactly US2 (capacity map), the velocity-based effort→duration basis (Q1, via `pointsPerSprint`), capability-filtered assignment (Q2), the sprint calendar/projection with `isBeyondPiEnd`, and the honest states — **already built and unit-tested.**
- **Every Jira write primitive exists**: `createIssue` (POST /issue), `createSprint`, `getBoardSprints`, `assignIssueToSprint`, `savePiReviewFeatureDates` (Target Start/End + `duedate`), `saveFeatureReviewFixVersion`, and name→id custom-field discovery (`loadHygieneFieldConfig` / `matchFieldIdsByName`).
- **The propose-only AI pattern exists**: `ArtView/ai/piReviewAiAssist.ts` + `extractJsonPayload` + `useAiAssistStore` gate + the reusable `ReportAiPanel` copy-prompt/paste-reply shell.

The genuinely **new** work is therefore narrow and mostly pure: (1) a Feature→Story **breakdown proposal** ingested from AI (`{kind:'piPlan'}`); (2) a pure **working-day + deploy-cadence date engine** that maps a scheduled Story to its five dates (Target Start, Target End=code-in-INT, internal-test-end, INT/REL/PROD, Due); (3) a **production release schedule** derived from PI-window fixVersions with a monthly-cadence suggestion; (4) **Jira write flows** for creating a Story under a Feature and its Sub-tasks with `parent`, reusing the existing primitives for dates/fixVersion/sprint; (5) an **idempotency read** of a Feature's existing children; and (6) the PI Review **planner panel** that ties it together, reusing `ReportAiPanel` and the planner UI.

## Technical Context

**Language/Version**: TypeScript (client, strict) with React + Zustand; Node.js/Express server used only as the authenticated Jira proxy.

**Primary Dependencies**: **No new dependencies** (Framework-First). Reuse: `FeatureCanvas/planner/*`, `services/jiraApi.ts`, `ArtView/piReviewJira.ts` writers, `ArtView/ai/*` pattern, `components/ReportAiPanel`, `Hygiene/checks/hygieneFieldConfig.ts` (field discovery), `SprintDashboard/hooks/useStandupRosterStore.ts`, `ArtView/hooks/artHelpers.ts` (`parsePiDateRange`).

**Storage**: none new. Jira is the source of truth. Draft plan state is ephemeral/session (Zustand), consistent with PI Review's `hasUnsavedChanges` model; no persistence of proposals.

**Testing**: vitest (client unit — pure engine, date math, AI parse/apply, Jira-write payload builders with mocked proxy) following TDD (red→green). Existing planner tests must stay green.

**Target Platform**: NodeToolbox desktop (packaged Electron/exe) + browser dev; client-only feature reaching Jira through the existing `/jira-proxy`.

**Project Type**: Web application (client + server proxy) — the planner is client-side.

**Performance Goals**: interactive. The deterministic engine (breakdown expansion + `buildCapacityPlan` + date cadence) for a single team/PI (tens of Features, low-hundreds of proposed issues) completes well under ~1s; AI is manual copy/paste (or the optional auto-dispatch). Jira writes are per-accepted-item, sequenced with clear progress.

**Constraints**: propose-only (no automated/background AI writer); AI gated behind `useAiAssistStore`; agree-by-construction (capacity map and schedule share the one `PlanResult`); all date math in working days; zero regressions to the three PI Review host surfaces (Team Dashboard, PO Tool, ArtView) and to `FeatureCanvas/planner`.

**Scale/Scope**: one team + one PI per run; ~10–40 Features; each Feature → a handful of Stories; each Story → up to 4 sub-tasks; low-hundreds of proposed issues per PI.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Status | Notes |
|---------|--------|-------|
| III — Branching | ✅ | Work on `feature/028-pi-planning-automation`; PR to main. |
| IV — Code Quality | ✅ | Self-documenting names, verb-first funcs <40 lines, file/purpose + doc comments, no magic numbers (cadence constants named). |
| V — Testing (TDD) | ✅ | Pure engine, date cadence, AI parse/apply, and write-payload builders are unit-first; a failing test precedes each. |
| VI — Documentation | ✅ | CHANGELOG updated on behavior change; only `specs/028-*` pipeline docs added. |
| VII — Framework-First | ✅ | **Strongly satisfied** — reuse planner engine + all Jira primitives + AI pattern + field discovery. Drift is scoped to genuine gaps (below), each justified at the component. |
| VIII — Release | ✅ | `scripts/local-release.ps1` only; no Actions. |
| IX — Vault Zero-Knowledge | ✅ | No secrets in feature; Jira auth stays server-injected via the proxy. |
| X — Verification & Proof | ✅ | quickstart.md defines live-Jira acceptance evidence; engine determinism proven by tests (SC-003). |
| XI — Output Restraint | ✅ | No new dashboards; no auto summaries. |

**Framework-First drift ledger** (documented gaps — the only custom infrastructure, each recorded at its component):

| New component | Why the framework doesn't provide it |
|---------------|--------------------------------------|
| `piPlanDates.ts` (working-day + deploy-cadence engine) | The planner computes sprint placement and a completion date but has no notion of Target Start / code-in-INT Target End / the INT≤24h, REL+5-working-day, PROD-on-fixVersion cadence or working-day rolling. No existing module does calendar cadence. |
| `piPlanReleaseSchedule.ts` | No existing code reads PI-window fixVersions as a release calendar or proposes a monthly-cadence release. `saveFeatureReviewFixVersion` only *sets* a version. |
| `piPlanJira.ts` create-Story / create-Sub-task-with-`parent` flows | `createIssue` exists but no caller creates a Story under a Feature or a Sub-task with a `parent`; that orchestration is new (writes delegate to the existing primitive). |
| `featureChildren.ts` (read a Feature's existing Stories/sub-tasks) | No current fetch requests `subtasks` or traverses a Feature's child Stories; required for idempotency (FR-055). |
| `ArtView/ai/piPlanAiAssist.ts` (`{kind:'piPlan'}`) | New envelope for the breakdown proposal; mirrors the existing `piReview` AI module shape. |

No unjustified violations → **gate passes**. Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/028-pi-planning-automation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── planning-engine.md
│   ├── date-cadence.md
│   ├── ai-assist-json.md
│   └── jira-writes.md
├── checklists/
│   └── requirements.md  # (from /speckit-specify)
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
client/src/views/ArtView/
├── piPlan/                          # NEW — the planner feature (pure engine + UI)
│   ├── piPlanTypes.ts               # data contracts (PlanProposal, PlanItem draft, ScheduledStory, DatedItem)
│   ├── piPlanBreakdown.ts           # expand accepted breakdown → planner PlanItem[] (70/30 dev/test split, 13-pt cap check)
│   ├── piPlanDates.ts               # NEW pure: working-day calendar + deploy cadence (Target Start/End, INT/REL/PROD, Due)
│   ├── piPlanReleaseSchedule.ts     # NEW pure: PI-window fixVersions → release calendar + monthly-cadence suggestion
│   ├── piPlanEngine.ts              # orchestrates: breakdown → buildCapacityPlan (REUSE) → dates → PlanProposal (agree-by-construction)
│   ├── piPlanJira.ts                # write flows: create Story/Sub-tasks, set dates/fixVersion, create/assign sprint (delegate to primitives)
│   ├── featureChildren.ts           # read existing child Stories/sub-tasks for idempotency
│   ├── PiPlanPanel.tsx              # UI: gated ReportAiPanel + proposal review + per-item accept
│   ├── PiPlanCapacityMap.tsx        # UI: per-person/per-sprint committed-vs-available (from PlanResult)
│   ├── PlanProposalTable.tsx        # UI: per-item accept/dismiss/override
│   └── *.test.ts(x)                 # unit tests (TDD) alongside each module
├── ai/
│   ├── piPlanAiAssist.ts            # NEW — buildPiPlanAiPrompt + parsePiPlanAiReply ({kind:'piPlan'})
│   ├── piPlanAiFetch.ts             # NEW — assemble prompt-only context (roster, capacity, features, releases, rules)
│   └── piPlanAiApply.ts             # NEW — pure apply of an accepted breakdown suggestion
└── (PiReviewTab.tsx / PoToolView mount)  # add a Planner tab/panel entry point (additive, default-off; hosts unchanged)

REUSE (unchanged): FeatureCanvas/planner/{capacityPlanner,capacityTypes,sprintNaming,bottleneck}.ts,
services/jiraApi.ts (createIssue/createSprint/getBoardSprints/createIssueLink),
ArtView/piReviewJira.ts (savePiReviewFeatureDates), SprintDashboard/featureReviewFixes.ts (saveFeatureReviewFixVersion,
saveFeatureReviewStoryPoints), Hygiene/checks/hygieneFieldConfig.ts (field discovery),
SprintDashboard/hooks/useStandupRosterStore.ts, ArtView/hooks/artHelpers.ts (parsePiDateRange),
components/ReportAiPanel, store/aiAssistStore.ts.
```

**Structure Decision**: Web app; the feature is client-side under a new `client/src/views/ArtView/piPlan/` module plus a new `ArtView/ai/piPlan*` trio, mounted additively on the existing PI Review surface. It **reuses the FeatureCanvas planner engine as-is** for scheduling/capacity/assignment and the existing Jira primitives for all writes. No host-surface refactors (FR — no regression to Team Dashboard / PO Tool / ArtView / Canvas).

## Complexity Tracking

> No Constitution violations require justification. Framework-First drift is limited to the documented gaps in the ledger above, each of which is a genuine capability the codebase lacks; no simpler reuse exists for them.
