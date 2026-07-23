# Implementation Plan: Issue Flow Analysis — where the time actually goes

**Branch**: `feature/026-issue-flow-analysis` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-issue-flow-analysis/spec.md`

## Summary

The Personal Workflow report answers *"how much of my time went where?"*. This adds the question it structurally
cannot answer: **for an issue that got delivered, where did its time go and who held it at each stage** — separating
work from waiting, so a delivery lead can see that a story spent 3 days being worked and 11 waiting in a review queue.

Phase 0 found the work is smaller than the spec assumed. The engine's timeline builder is **already generic**:

```ts
function buildStateSegments<TValue>(originMs, initialValue, changePoints, todayMs): StateSegment<TValue>[]
```

The person-centric engine instantiates it with `boolean` (was-this-mine); this analysis instantiates it with an
**assignee identity**. Identity is discarded at exactly one mapping step (`readOwnershipHistory`), where the raw
changelog values are already in hand. So the reconstruction is not new work — it is the *same* reconstruction with a
different value type, which is what makes NFR-001 ("hands-on time must agree between the two analyses") true by
construction rather than by discipline.

The plan therefore centres on **extracting the shared timeline core** rather than writing a second one, with the
existing engine's 35 tests as the regression guard. On top of it sit one new reader, one aggregation, and the
presentation.

The feature also corrects three ways the existing report currently misleads — team columns that cannot be summed, an
"Issues" metric described as work moved to done when it is work *advanced*, and story points presented as personal
output. Those are **wording-only** changes; no figure moves.

## Technical Context

**Language/Version**: TypeScript + React (client SPA), CSS Modules. Client-only — no server, scheduler, or new
integration.

**Primary Dependencies**: **zero new**. Reuse — the generic segment machinery inside `personalFlow.ts` (extracted);
`businessMillisBetween` (already exported); `flowAuditFetch.ts` (paging + two ceilings + cancellation, feature 025);
`flowAuditDocument.ts` / `flowAuditMetrics.ts` / `flowAuditLinks.ts` (the auditable document);
`buildStandupRosterAssigneeClause` (roster JQL); the Reports Hub team filter.

**Storage**: None. Computed on demand; nothing persisted. Status classification overrides are the only new
configuration, stored with existing report settings.

**Testing**: vitest (`cd client && npm test`), red-first per Article V. The timeline core, the stage builder, the
classifier and the aggregation are all pure — every reconciliation, classification and edge case is unit-testable
with no I/O. `personalFlow.test.ts` must stay green **unmodified** through the extraction; that is the guard.

**Target Platform**: NodeToolbox SPA; light and dark themes; A/A+/A++ text sizes.

**Performance Goals**: bounded by the two ceilings (NFR-006); meaningful progress and cancellation on long runs
(NFR-007).

**Constraints**: one reconstruction shared by both analyses (NFR-001); **working days throughout**, labelled
(FR-006, research R6); scope decides which issues are analysed, never whose stages are shown (FR-000a); totals derived
from stages by summation only (FR-003, research R9); the existing report's behaviour unchanged — descriptions only
(FR-019).

**Scale/Scope**: a roster of ~5–20 people; every issue they completed in the window, each needing its full changelog.

## Constitution Check

*GATE — evaluated pre-Phase-0 and re-checked post-design: **PASS**. No Article VII drift.*

- **Art I (Best route)**: ✅ The extraction is the costlier, correct route — duplicating the timeline logic would have
  been faster and would have violated NFR-001 by construction. R1 was established by reading the code rather than
  assuming a second engine was needed.
- **Art III (Branching)**: ✅ `feature/026-issue-flow-analysis`, merged via PR.
- **Art IV (Code quality)**: ✅ Verb-first (`buildIssueStages`, `classifyStatusFlow`, `summariseStageTotals`),
  `is/has/can` booleans (`isWaitingStatus`, `hasUnclassifiedStatus`), named constants for the classification patterns
  and both ceilings, purpose comment per file, doc comment per export, functions under 40 lines.
- **Art V (Testing, TDD)**: ✅ Red→green per task. The 35 existing engine tests are the extraction's safety net and
  must pass **unmodified** — a changed test would mean changed behaviour.
- **Art VI (Documentation)**: ✅ One CHANGELOG entry. `specs/026-*/` is the exempt pipeline artifact.
- **Art VII (Framework-first)**: ✅ **No drift.** Everything is either extracted from what exists or composed from
  feature 025's modules. The one genuinely new pure concept — a stage — is a capability nothing provides.
- **Art X (Verification & proof)**: ✅ FR-003's reconciliation is shown, not asserted; quickstart validates by
  checking a stage breakdown against an issue's real Jira history.
- **Art XI (Output restraint)**: ✅ No dashboard artifact; no phase narration.

**Gate result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/026-issue-flow-analysis/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — R1..R9
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── issue-timeline.md     # the shared reconstruction (highest risk — touches shipped code)
│   ├── flow-stages.md        # stages, totals, reconciliation, classification
│   └── flow-reporting.md     # team roll-up, honest totals, document integration
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
client/src/views/ReportsHub/
├── issueTimeline.ts               # NEW — extracted shared core: generic segments, origin, working time
├── personalFlow.ts                # CHANGED — consumes issueTimeline instead of owning it (behaviour identical)
├── issueFlow.ts                   # NEW — pure: stages, lead/cycle/wait totals, reconciliation
├── issueFlowStatusClass.ts        # NEW — pure: waiting vs active classification, with unclassified
├── issueFlowRollup.ts             # NEW — pure: per-status aggregates, typical + spread, honest team totals
├── flowAuditFetch.ts              # CHANGED — generalise the person-scoped naming; behaviour unchanged
├── flowAuditMetrics.ts            # CHANGED — flow metric definitions + the corrected Personal Workflow wording
├── flowAuditDocument.ts           # CHANGED — flow sections; waiting-time redistribution notice
├── IssueFlowTab.tsx               # NEW — the Reports Hub tab
└── ReportsHubView.tsx             # CHANGED — register the tab, pass the shared team filter
```

**Structure Decision**: Everything that carries risk is pure and sits in `*.ts` beside the engine it extends —
matching the repo's established shape. `IssueFlowTab.tsx` holds fetching and presentation, no analysis.

The split into four pure modules is deliberate: **timeline** (what happened), **stages** (how it partitions),
**classification** (what the partition means), and **roll-up** (what it adds to) fail for different reasons and are
tested separately. Classification in particular is a judgement call that will be revised — isolating it means
revising it cannot disturb the arithmetic.

**The riskiest task is the first**: extracting `issueTimeline.ts` modifies shipped, well-tested code. It is
behaviour-preserving by definition, which is exactly why the existing tests must pass untouched.

## Phase 1 — Design summary

**Data model** ([data-model.md](./data-model.md)): `HolderSegment` and `StatusSegment` (the two reconstructed
timelines), `FlowStage` (their intersection — the atomic unit), `StatusFlowClass`, `IssueFlow` (stages plus the three
totals), and `StageRollup`.

**Contracts**:
- [`issue-timeline.md`](./contracts/issue-timeline.md) — the extracted shared core. **Highest risk**: the only
  contract that changes shipped behaviour, and the only one whose acceptance test is "35 existing tests still pass,
  unmodified".
- [`flow-stages.md`](./contracts/flow-stages.md) — stage construction, the three totals, and the reconciliation that
  makes them checkable.
- [`flow-reporting.md`](./contracts/flow-reporting.md) — roll-ups, honest team totals, and the document sections.

**Quickstart** ([quickstart.md](./quickstart.md)) — validates by taking one issue's stage breakdown and checking it
against that issue's real history in Jira.

**Agent context**: `CLAUDE.md` updated to point at this plan.

## Complexity Tracking

*No Article VII violations to justify.*

The one new abstraction — a **stage**, the intersection of a status span and a holder span — is a capability nothing
in the codebase provides, and it is the minimum needed to answer the question the spec poses. Everything else is
extracted from existing code or composed from feature 025's modules.

**Recorded for the reviewer**: the extraction into `issueTimeline.ts` is a refactor of shipped code with **no intended
behaviour change**. If `personalFlow.test.ts` requires *any* modification to pass, the extraction has changed
behaviour and should be reverted — not have its tests adjusted to fit.
