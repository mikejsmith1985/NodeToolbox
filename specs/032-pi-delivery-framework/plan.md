# Implementation Plan: PI Delivery Framework — Plan-Once, Monitor-Continuously

**Branch**: `feature/032-pi-delivery-framework` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/032-pi-delivery-framework/spec.md`

## Summary

Restructure the shipped 028 PI planner so that a repository maps **1:1 to a coding Sub-task** (not to a Story):
one Story bridges the repositories it touches under a primary owner, each repo becomes an independently-assignable
coding sub-task, and a single SL-test sub-task plus per-story INT/REL/PROD deploy sub-tasks complete the scaffold.
The whole PI (5 sprints) is generated from **one** propose-only AI prompt whose input is a deterministic **PI
Planning Fact Sheet** assembled by a fixed query set, so the AI reasons only over stated facts and any
repo/person/sprint/key it invents is rejected on ingest. Every date, capacity number, sprint assignment, and
bottleneck finding is **rule-derived**; the AI supplies only the story decomposition and a mitigation narrative.
A monitoring surface then reports adherence (burn-up, sub-task aging, SL-test queue, freshness, commit-vs-complete)
with explicit replan triggers, so the team monitors instead of re-planning.

**The technical spine is reuse.** Recon confirmed the heavy machinery exists: `buildCapacityPlan` already
load-balances `PlanItem`s across people by role and **already emits a `BottleneckReport` naming the limiting role**
(dev vs `internalTest`) — so parallel per-repo assignment and the SL-test-throughput bottleneck are reuse, not new
code. The 028 engine (`piPlanEngine`, `piPlanDates`, `piPlanReleaseSchedule`, `piPlanJira`) already dates INT/REL/PROD
on working days, suggests monthly releases, and writes Stories+sub-tasks under a parent. The **new** work is narrow:
move the capacity unit from Story → coding sub-task, add the repo-subtask scaffold (replacing 031's
`repoStoryBreakdown`), the fact-sheet assembler + schema, the extra deterministic bottleneck checks
(key-person/dependency/PROD-carry), the `{kind:'piDeliveryPlan'}` AI module, and the monitoring signal set.

## Technical Context

**Language/Version**: TypeScript 5.x (client), React 18 function components.

**Primary Dependencies**: existing only — `FeatureCanvas/planner` (`buildCapacityPlan`, `capacityTypes`), the 028
`ArtView/piPlan/*` engine, `componentClassificationStore` (031), `useStandupRosterStore`, `featureReviewFixes`
(Jira writers), `jiraApi` primitives, `useAiAssistStore` + `extractJsonPayload`/`repairJsonPayload`, `workflowDelivery`
(velocity), `loadHygieneFieldConfig` (name→id field discovery). **No new npm dependencies.**

**Storage**: none new for v1 — the fact sheet is computed live from Jira reads + stores; monitoring reads live Jira.
(A later phase persists repo→contributor affinity; out of scope.)

**Testing**: `vitest` for the pure client engine/lib modules (unit, mocked I/O, TDD red→green); no server code.

**Target Platform**: browser SPA (the existing PO Tool / ArtView surface on :3000).

**Project Type**: web application, **client-only** feature (mirrors 028 — no server engine bundle needed).

**Performance Goals**: whole-PI plan generation is a single prompt/paste cycle; ingest + engine recompute is
interactive (<1s for a typical PI of a few dozen Stories). No throughput/latency SLAs.

**Constraints**: propose-only, AI-gated, per-item accept, never AI-attributed (Article IX + AI rules). Jira workflows
and statuses are **fixed** and MUST NOT be modified. Sub-task states limited to To Do / In Progress / Done (+cancel).
All dates on **working days**. 80% load factor; Sprint-5 Week-1 delivery cutoff.

**Scale/Scope**: one ART's PI — ~10–40 Features, ~68 known repo components, a roster of ~10–20 people, 5 sprints.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Work on `feature/032-*`, PR to main | ✅ on `feature/032-pi-delivery-framework` |
| IV — Code Quality | Self-documenting names, <40-line functions, file/exported doc comments | ✅ enforced in tasks; mirrors 028 module style |
| V — Testing | TDD, mocked I/O, fast unit tests before implementation | ✅ every new pure module gets a `.test.ts` first (vitest) |
| VI — Documentation | CHANGELOG updated; no ad-hoc status docs (specs/ exempt) | ✅ CHANGELOG entry in the PR; only `specs/032-*` artifacts |
| VII — Framework-First | Reuse before build; justify custom against a documented gap | ✅ **core of this plan** — see Framework-First Ledger below |
| IX — Vault Zero-Knowledge | No secrets in code/logs | ✅ N/A (reuses env-injected Jira auth) |
| X — Verification & Proof | Behaviour proven with evidence | ✅ vitest suites + the quickstart live-Jira validation |
| XI — Output Restraint | ≤1 dashboard; no phase-name narration | ✅ no new dashboard files |

**AI-rules gate (Article IX / project AI rules)**: planning is a manual prompt/paste cycle behind `useAiAssistStore`,
per-item accept, never AI-attributed; AI-supplied dates/capacity/bottlenecks are ignored and unknown keys rejected on
ingest. ✅ satisfied by FR-017, FR-019, FR-020, FR-027.

**No violations.** No Complexity-Tracking exceptions required.

### Framework-First Ledger (Article VII)

| Capability | Verdict | Source / documented gap |
|-----------|---------|--------------------------|
| Load-balance work across people by role | **Reuse** | `buildCapacityPlan` (`capacityPlanner.ts`) |
| SL-test-throughput bottleneck (dev vs test limiting role) | **Reuse** | `PlanResult.bottleneck: BottleneckReport` already names `limitingRole` + people-needed |
| Over-commitment / unschedulable surfacing | **Reuse** | `PlanResult.sprintsBeyondPiEnd`, `unschedulableItemKeys` |
| INT/REL/PROD working-day dating, monthly release suggestion | **Reuse** | `piPlanDates.ts`, `piPlanReleaseSchedule.ts` |
| Story + sub-task create under a parent, sprint assign, Target Start/End+due, fixVersion | **Reuse** | `piPlanJira.ts`, `featureReviewFixes.ts`, `jiraApi` |
| Repo/domain classification (allowlist) | **Reuse** | `componentClassificationStore` (031) |
| Component name→id resolution, field id name-discovery | **Reuse** | 031 `componentResolve`, `loadHygieneFieldConfig` |
| AI prompt/ingest envelope, JSON repair | **Reuse** | `piReviewAiAssist`/`piPlanAiAssist` pattern, `extractJsonPayload`+`repairJsonPayload` |
| Velocity basis | **Reuse** | `workflowDelivery.ts` |
| **Capacity unit = per-repo coding sub-task** (parallel assignees) | **Build** | 028 unit is the Story; feeding coding sub-tasks as `PlanItem`s is new orchestration |
| **Repo→sub-task scaffold** (replaces story-per-repo) | **Build** | replaces 031 `repoStoryBreakdown`; new `piPlanRepoSubtasks` |
| **PI Planning Fact Sheet** assembler + schema | **Build** | no single deterministic bundle exists today |
| **Extra bottlenecks**: key-person/single-owner-repo, dependency order, PROD-carry | **Build** | `BottleneckReport` covers only limiting-role |
| **80% load factor + Sprint-5-Week-1 delivery window** | **Build** | thin: scale `pointsPerSprint`; cap the delivery window |
| **Monitoring signals + replan triggers** | **Build** | new `piPlanMonitor` (reads live Jira + GH-intake freshness) |
| **`{kind:'piDeliveryPlan'}` prompt embedding the fact sheet + allowlist ingest** | **Build** | extends the `{kind:'piPlan'}` module |

## Project Structure

### Documentation (this feature)

```text
specs/032-pi-delivery-framework/
├── plan.md              # this file
├── research.md          # Phase 0 — the design decisions + alternatives
├── data-model.md        # Phase 1 — entities + type changes to piPlanTypes
├── contracts/           # Phase 1 — the module contracts
│   ├── fact-sheet.md
│   ├── repo-subtask-generation.md
│   ├── bottleneck-detection.md
│   ├── ai-delivery-plan.md
│   └── monitoring-signals.md
├── quickstart.md        # Phase 1 — live-Jira validation walkthrough
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created here)
```

### Source Code (client, all under the existing PI-plan tree)

```text
client/src/views/ArtView/piPlan/
├── piPlanTypes.ts                 # MODIFY: SubTaskKind → add 'coding'+'slTest'; add repo fields to sub-task payload; FactSheet types
├── piPlanRepoSubtasks.ts          # NEW: one coding sub-task per repo + SL-test + INT/REL/PROD; partition dev points; idempotent (REPLACES repoStoryBreakdown)
├── piPlanFactSheet.ts             # NEW: assemble the deterministic PI Planning Fact Sheet from the query set
├── piPlanBottlenecks.ts           # NEW: deterministic key-person/dependency/PROD-carry checks (wraps PlanResult.bottleneck)
├── piPlanMonitor.ts               # NEW: on-track signals + replan triggers (US5)
├── piPlanEngine.ts                # MODIFY: capacity unit = coding sub-task; roll Story dates up from children; apply load factor + Sprint-5 window
├── piPlanCapacity.ts              # MODIFY: 80% load factor; Sprint-5 Week-1 delivery cutoff / Week-2 innovation exclusion
├── piPlanJira.ts                  # MODIFY: write coding sub-tasks (repo on component field) + SL-test + deploys; relabel IT→SL
├── ai/
│   ├── deliveryPlanPrompt.ts      # NEW: build the {kind:'piDeliveryPlan'} prompt embedding the fact sheet
│   └── deliveryPlanIngest.ts      # NEW: parse reply → decomposition + mitigations; allowlist-reject unknown keys
└── repoStoryBreakdown.ts          # REMOVE (superseded) — with its test

client/src/views/ArtView/PiDeliveryPlanTab.tsx   # NEW (or extend the 028 Planner tab): fact-sheet review, prompt, ingest, per-item accept, bottlenecks, monitor
client/src/views/ArtView/PiDeliveryMonitor.tsx   # NEW: the monitoring surface (US5)
```

**Host edit**: additive — mount the delivery-plan tab beside the existing Planner (a few lines in `ArtView`/`PoToolView`);
no existing tab logic touched (028 Planner remains for non-repo-driven use until fully migrated).

## Architecture (the spine)

```
PI Review (committed Features)
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ QUERY SET  →  piPlanFactSheet.assemble()  →  PI Planning Fact │  (deterministic)
│  Features · repo/domain classes · roster+capabilities ·       │
│  per-sprint capacity(80%) · PI sprints · existing children ·  │
│  fixVersion schedule · velocity · field/status config         │
└──────────────────────────────────────────────────────────────┘
        │                                   │
        │ embed verbatim                    │ feed
        ▼                                   ▼
  deliveryPlanPrompt  ──(user pastes into own AI)──►  reply
        │                                   │
        ▼                                   │
  deliveryPlanIngest  ── allowlist-reject unknown keys ──┐
        │ decomposition (repos→Stories) + mitigations    │
        ▼                                                 ▼
  piPlanEngine (capacity unit = coding sub-task)  ◄─ buildCapacityPlan (REUSE)
        │  · per-repo parallel assignment (load-balanced)
        │  · SL-test = own capacity stream → BottleneckReport (REUSE)
        │  · dates recomputed from rules (INT/REL/PROD, working days)
        ▼
  piPlanBottlenecks (+ key-person / dependency / PROD-carry)
        │
        ▼
  reviewable PlanProposal  ── per-item accept ──►  piPlanJira (writes)
        │
        ▼
  piPlanMonitor  ──►  on-track signals + replan triggers (monitor, not plan)
```

**Agree-by-construction**: the fact sheet the engine plans from is the exact fact sheet embedded in the prompt; the
`PlanResult` that drives assignment is the same object the bottleneck report reads; dates are recomputed, never trusted.

## Phase 0 — Research (see research.md)

Resolves: (R1) how the capacity unit moves Story→coding-sub-task without breaking the 70/30 machinery; (R2) how the
Story's Target Start/End roll up from its children; (R3) how SL-test-as-own-constraint maps onto the existing
`internalTest` role + `BottleneckReport`; (R4) the fact-sheet schema and each query's existing source; (R5) the
80% load factor + Sprint-5-Week-1 window mechanics; (R6) repo dev-point partition across coding sub-tasks; (R7) the
`{kind:'piDeliveryPlan'}` envelope + allowlist-reject rules; (R8) the monitoring signal computations + replan-trigger
thresholds; (R9) the disposition of 031's `repoStoryBreakdown`.

## Phase 1 — Design & Contracts

- **data-model.md** — the `piPlanTypes` changes (dynamic sub-task kinds with repo fields; `FactSheet`,
  `RepoCodingSubtask`, `Bottleneck`, `MonitorSignal`, `ReplanTrigger`) and their validation rules.
- **contracts/fact-sheet.md** — the query set → fact-sheet schema, each field's source, and the determinism contract.
- **contracts/repo-subtask-generation.md** — the scaffold rules (one coding sub-task per repo, SL-test, deploys),
  point partition, idempotency, titles, component-field placement; the replacement of `repoStoryBreakdown`.
- **contracts/bottleneck-detection.md** — what the engine flags (SL-test throughput via `BottleneckReport`,
  key-person, dependency order, PROD-carry) and the AI-mitigation attachment rule.
- **contracts/ai-delivery-plan.md** — the `{kind:'piDeliveryPlan'}` prompt shape + reply schema + allowlist-reject.
- **contracts/monitoring-signals.md** — the five on-track signals + the replan triggers and thresholds.
- **quickstart.md** — the live-Jira end-to-end validation (commit Features → generate → paste → accept → monitor).
- **Agent context** — update the `CLAUDE.md` SPECKIT markers to point at this plan.

## Phase 2 — Tasks

Produced by `/speckit-tasks`. Expected shape: Setup (types) → Foundational (fact sheet + engine unit shift) →
US1 (generation) → US2 (repo→sub-task) → US3 (dates/capacity/windows) → US4 (bottlenecks) → US5 (monitoring) →
Polish (remove `repoStoryBreakdown`, CHANGELOG). TDD throughout.

## Risks & Mitigations

- **Capacity-unit shift is the highest-risk change** — moving from Story→coding-sub-task touches `piPlanEngine`'s core.
  *Mitigation*: keep the Story-level path working for non-repo Features; add the sub-task-unit path behind the repo
  presence; re-run the 028 engine tests unmodified as a regression gate (a change there means behaviour drifted).
- **031 overlap** — `repoStoryBreakdown` is superseded. *Mitigation*: remove it and its test in Polish only after the
  repo-subtask path is green; confirm no other importer.
- **Sub-task explosion** — mitigated by design (deploys per-story, not per-repo) and asserted in US2 tests.
- **AI hallucination** — mitigated by the fact-sheet allowlist ingest (FR-020) and deterministic dates/bottlenecks.
