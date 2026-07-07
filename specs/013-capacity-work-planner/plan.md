# Implementation Plan: Prioritizer + Deterministic Capacity Work Planner

**Branch**: `feature/013-capacity-work-planner` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/013-capacity-work-planner/spec.md`

## Summary

Reframe the Feature Canvas into a **prioritizer** and add a **deterministic, role-aware capacity planner**. The
work splits into four layers, deliberately ordered so the highest-value, lowest-risk piece (the pure engine) ships
and is proven before the riskier UI reframe and the config-dependent classification:

1. **Capacity engine (pure, deterministic)** — the heart. Input: already-classified, already-sized work items +
   the roster's per-role capacity + the PI window. Output: projected 2-week sprints (per-person load by role),
   dev→test sequencing, assignment/rebalance **proposals**, the **bottleneck + staffing-gap** report, and the
   **completion projection beyond the PI**. No Jira, no UI, no clock (today injected) → 100% unit-testable. *(FR-4
   through FR-13; SC-1,2,3,4,5,8.)*
2. **Role classification (structure-first)** — maps a Jira item to dev / internal-test / external-test from
   structured signals (QA sub-task type, external-test link/project), with a summary/description **fallback** only
   when ambiguous, and a **synthesized** internal-test cost when none exists. *(FR-7,8,8a; SC-6.)* **Needs the
   instance's concrete signal values (A3) before it can be wired.**
3. **Data fetch expansion** — pull **sub-tasks** (points/assignee/type) and **child issue links** the canvas does
   not fetch today; resolve the **defect source** (A4). *(FR-2; A5.)*
4. **Prioritizer UI + output** — ranked drag-order within MoSCoW buckets, bucket selection for the planner, and the
   **read-only projection + copy-out** (optional gated narration). *(FR-1,3,14,15.)* Highest UI risk (touches the
   shipped canvas) — done last, behind the proven engine.

**This plan's first deliverable is Layer 1 (the pure engine).** Layers 2–4 are scoped here but built after the
engine is green and after the operator confirms the A3/A4 values.

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19 (client SPA). Frontend-only; no server change.

**Primary Dependencies**: None new for the engine. Reuses feature 012 roster **role capabilities**
(`RosterRoleCapabilities`), `piSchedule` (PI start/end), and later the canvas overlay + Jira fetch layer.

**Storage**: Engine is pure (no storage). Intra-bucket priority order persists in the existing canvas overlay
(localStorage). No server-side entity.

**Testing**: Vitest. The engine is pure logic → exhaustive unit tests (<10ms, `today` injected): capacity fill,
multi-role pooling, dev→test sequencing with tester-capacity slip, unassigned proposal + rebalance, bottleneck
headcount for both targets, projection past the PI end, determinism (same input → same output). Classification gets
its own pure unit tests once signals are known. UI gets RTL tests in Layer 4.

**Target Platform**: Desktop web browser (SPA).

**Project Type**: Web — React SPA (`client/`).

**Performance Goals**: Selected backlog is tens–low-hundreds of items; a greedy fill is trivially fast.

**Constraints**: Deterministic and explainable (SC-1, SC-8); read-only, zero Jira writes (SC-7); capacity never
exceeded (SC-2); classification structure-first with a single AI fallback seam (A8).

**Scale/Scope**: One team's roster (<30 people) × the selected backlog; single operator.

## Constitution Check

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ `feature/013-capacity-work-planner` |
| IV — Code Quality | Small pure functions, doc comments | ✅ Engine decomposes into small pure helpers |
| V — Testing | TDD; fast mocked units | ✅ Pure engine is unit-first; classification + UI tested per layer |
| VI — Documentation | CHANGELOG; no ad-hoc docs | ✅ CHANGELOG at implementation; only `specs/013-*` artifacts |
| VII — Framework-First | Reuse, don't rebuild | ✅ Reuses roster roles, piSchedule, overlay; the engine is genuinely new (no framework provides role-aware capacity projection) |
| VIII — Release | Local pipeline only | ✅ N/A until release |
| IX — Vault | No secrets | ✅ None |
| X — Verification | Evidence | ✅ quickstart defines behavioral checks; engine proven by unit tests |
| XI — Output Restraint | ≤1 dashboard; no phase narration | ✅ The projection is a view, not a dashboard artifact |

**Framework-First note**: The capacity engine is legitimately custom — no dependency provides role-aware,
priority-ordered sprint projection with bottleneck headcount math. Everything around it is reuse (roster roles,
PI schedule, overlay persistence, AI gate). No Complexity Tracking entry required.

**Result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/013-capacity-work-planner/
├── plan.md · spec.md · data-model.md · quickstart.md
├── contracts/  (capacity-engine.md, classification.md — the latter finalized once A3 is confirmed)
└── checklists/requirements.md
```

### Source Code (repository root) — planned

```text
client/src/views/FeatureCanvas/planner/
├── capacityTypes.ts          # NEW: PlanInput, PlanItem, PersonCapacity, ProjectedSprint, BottleneckReport, PlanResult
├── capacityPlanner.ts        # NEW (pure): buildCapacityPlan(input, todayIso) — fill, sequence, propose, project
├── bottleneck.ts             # NEW (pure): limiting-role detection + additional-headcount math (both targets)
├── roleClassification.ts     # NEW (pure): structured classification + synth test cost (fallback wired in Layer 2)
└── (Layer 4) PlannerPanel.tsx, prioritizer canvas changes, copy-out summary
```

**Structure Decision**: A new `planner/` folder isolates the deterministic engine from the existing canvas code so
Layer 1 lands with zero risk to the shipped board. `capacityPlanner.ts` orchestrates small pure helpers
(`bottleneck.ts`, sizing, sequencing). Classification lives beside it but its structured rules are filled from the
confirmed A3 config. The UI reframe reuses the existing overlay for the ranked priority order.

## Complexity Tracking

> Not required — Constitution Check passes. The one custom component (the capacity engine) is justified above; all
> surrounding pieces are reuse.

## Phasing & checkpoints

- **Now**: Layer 1 engine (pure, TDD) — buildable without any pending input.
- **Blocked on operator input**: Layer 2 classification (needs A3: QA sub-task type name, external-test project
  key / link type) and Layer 3 fetch (needs A4: defect source).
- **After engine proven + input received**: Layers 2–4, then release.
