# Implementation Plan: Delivery Forecast

**Branch**: `feature/036-delivery-forecast` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/036-delivery-forecast/spec.md`

## Summary

Turn story points into time, and time into a verdict — on two clocks that do not coincide.

The product already writes three dates per issue from a policy (`issueDateRules.ts`) and already knows how far a card
has moved through a team's own workflow (`readColumnCredit`). It has never multiplied the two. This feature adds the
arithmetic **once**, in pure modules, and shows the result on three surfaces: a daily forecast on **Today**, vital
tiles and card badges on the **Roll-Up Board**, and a new **Forecast** tab carrying release capacity, the external-test
window, and Feature-level PI DoD.

The technical shape is dictated by a rebase already in flight. `chore/migrate-field-id-debt-2` centralised field ids
behind `jiraFieldMapping.ts` and enforces it with a ratchet test that fails on any new file naming one. Every new
module here is therefore **pure and field-blind**: it receives points, statuses and dates as data. That constraint is
not overhead — it is what makes the whole engine unit-testable with no Jira at all.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 18

**Primary Dependencies**: React, Zustand, `@dnd-kit` (already present) — **no new package**

**Storage**: `localStorage` via `services/artSettingsStore.ts` (`tbxARTSettings`) and
`rollupBoard/boardVocabularyStore.ts`. No server storage, no wire-format change.

**Testing**: Vitest (`npm run test:client`, root `client/`). Server Jest and `test:dom` are untouched.

**Target Platform**: Browser client of the NodeToolbox app

**Project Type**: Client-only feature inside an existing React SPA

**Performance Goals**: The forecast is pure arithmetic over an already-fetched issue set (board ceiling ~300 issues,
hygiene ceiling per team). One added Jira request per Forecast-tab version-list load; **zero** added requests on
Today and the Roll-Up Board.

**Constraints**:
- No new file may name a `customfield_*` id (`fieldMappingBoundary.test.ts` ratchet).
- `workflowDelivery.test.ts` and `piPlanDates.test.ts` must pass **unmodified**.
- `RollupBoardTab.tsx` (2,694 lines) and `SprintDashboardView.tsx` (~6,800 lines) are not refactored.
- No new dependency; no automated AI channel.

**Scale/Scope**: 12 new pure modules, 4 new components, 1 new tab, 6 additive edits to shipped files.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design.*

| Article | Gate | Verdict |
|---|---|---|
| **III — Branching** | Work on `feature/036-delivery-forecast`; never `main` | ✅ Planned. Current worktree is `forge/wt-*` and must be branched from `main` before any code (recorded hazard: forge worktree branches are stale and rejected by the pre-commit hook). |
| **IV — Code Quality** | Self-documenting names, `is/has/can/should/was` booleans, verb-first functions, <40-line functions, no magic numbers, file purpose comment, exported doc comments | ✅ Every constant in this design is named (`CODE_FREEZE_LEAD_DAYS`, `EXTERNAL_TEST_WINDOW_WEEKS`). Engine functions are single-purpose by construction. |
| **V — Testing** | TDD red→green→refactor; unit tests mock all I/O and run fast | ✅ Every new module is **pure** — clock and calendar injected, no fetch. This is the cheapest possible TDD surface. One test file per source file (also a pre-commit requirement). |
| **VI — Documentation** | `CHANGELOG.md` is the single source of truth; no ad-hoc status docs | ✅ CHANGELOG updated in each behaviour-changing commit. Only `specs/036-delivery-forecast/` artifacts created. |
| **VII — Framework-First** | Confirm the codebase does not already provide it; build custom only against a documented gap | ✅ See the ledger below. **19 of 27 capabilities are reuse.** Two drifts, both recorded. |
| **VIII — Release** | Local pipeline only | ✅ No workflow files touched. |
| **IX — Vault** | No secret in conversation, file or log | ✅ Not applicable — no credentials involved. |
| **X — Verification** | Behaviour verified with evidence, not "it compiles" | ✅ `quickstart.md` gives runnable scenarios with expected numbers; the engine's determinism makes each one assertable. |
| **XI — Output Restraint** | ≤1 dashboard artifact, no phase narration, no unsolicited Markdown | ✅ No dashboard file. Spec Kit artifacts only. |

### Article VII — Framework-First ledger

**Reuse (19)** — nothing new is written for any of these:

| Capability | Existing provider |
|---|---|
| Code-freeze date | `issueDateRules.ts` — Target End is already release − 21 days |
| Due-date / Target-End policy | `issueDateRules.deriveIssueDates` |
| Driving fix version selection | `issueDateRules.readDrivingFixVersion` |
| Bulk date write + changelog read | `derivedDateFix.ts` → `saveFeatureReviewSimpleField` |
| Column part-credit | `rollupBoard/featureProgress.readColumnCredit` |
| Feature progress figure | `rollupBoard/featureProgress.computeFeatureProgress` |
| Working-day arithmetic | `piPlan/piPlanDates.ts` (relocated — see Drift 1) |
| Issue set with points/fixVersions/assignee/column/sub-status | `rollupBoard/rollupBoardFetch.ts` |
| Multi-team scan across saved profiles | `Today/hooks/useTodayDashboard.ts` + `hygieneScan.runHygieneScan` |
| Sub-status field discovery by name | `hygieneFieldConfig.subStatusFieldIds` |
| Story-points / PI / Feature-Link field resolution | `services/jiraFieldMapping.ts` |
| ART settings read + defaulting | `services/artSettingsStore.ts` |
| Team board vocabulary + column order | `rollupBoard/boardVocabularyStore.loadTeamVocabulary` |
| Fix-version list for a project | `piPlan/piPlanReleaseSchedule.fetchPiWindowFixVersions` |
| Roster + role capabilities | `SprintDashboard/hooks/useStandupRosterStore.ts` |
| Gated propose-only AI shell | `ReportsHub/ReportAiPanel.tsx` |
| Reply extraction from a pasted blob | `utils/extractJsonPayload.ts` |
| Swimlane vital tiles | `rollupBoard/laneVitals.buildLaneVitalTiles` |
| Card rendering with optional context | `rollupBoard/components/ChildCard.tsx` |

**New work (8)** — each against a documented gap:

| New module | Gap it fills |
|---|---|
| `forecast/effortModel.ts` | Nothing converts points → remaining working days. `piPlanDates.effortToWorkingDays` is private and has no credit concept. |
| `forecast/forecastWindows.ts` | Nothing expresses code-freeze / external-test / PI windows as one comparable shape. |
| `forecast/issueForecast.ts` | Nothing produces a per-issue latest-start verdict. |
| `forecast/capacityLoad.ts` | `buildCapacityPlan` plans *future* sprints from velocity; nothing assesses *current* assigned load against a deadline. |
| `forecast/intReadiness.ts` | `workflowDelivery` stops at "Ready for QA"; nothing knows the earlier INT line. |
| `forecast/devSlChain.ts` | Nothing schedules SL effort after dev completion. |
| `forecast/featureSizing.ts` | `detectDefectUndersize` covers defect buckets only, counts sub-tasks, and feeds a different surface. |
| `forecast/releaseDateResolve.ts` | Nothing reads a release date out of a version **name**. |

**Recorded drifts (2)**:

> **Drift 1 — relocating the working-day primitives.**
> `isWorkingDay` / `rollToWorkingDay` / `addWorkingDays` / `workingDaysBetween` and the `WorkingCalendar` type move
> from `views/ArtView/piPlan/piPlanDates.ts` to `client/src/utils/workingDays.ts`; `piPlanDates.ts` re-exports them.
> **Justification**: this feature's consumers are Hygiene, MyIssues and SprintDashboard. Importing from `ArtView/piPlan`
> would make the shared date policy depend on the PI planner — a layering inversion — and duplicating the arithmetic
> would create the fourth copy of a weekend rule in a codebase currently deleting exactly that class of duplication.
> **Proof it is behaviour-preserving**: `piPlanDates.test.ts` must pass unmodified.

> **Drift 2 — extending `issueDateRules.ts` rather than adding a module beside it.**
> `IssueDateInput` gains three **optional** fields and `deriveIssueDates` gains one precedence step.
> **Justification**: FR-013, and the module's own header — *"those three would otherwise each carry their own copy and
> drift"*. A parallel Target Start rule is the precise defect the module exists to prevent.
> **Proof it is additive**: every field optional; absent, the output is today's output. `issueDateRules.test.ts` passes
> unmodified, with new cases appended.

**Verdict: PASS.** No unjustified violation. The Complexity Tracking table is therefore empty.

## Project Structure

### Documentation (this feature)

```text
specs/036-delivery-forecast/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── effort-and-windows.md
│   ├── issue-forecast.md
│   ├── capacity-load.md
│   ├── int-readiness-and-chain.md
│   ├── release-date-resolve.md
│   ├── forecast-ai.md
│   └── surface-wiring.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
client/src/
├── utils/
│   └── workingDays.ts                       # NEW (Drift 1) — relocated primitives + WorkingCalendar
├── services/
│   ├── artSettingsStore.ts                  # EDIT — 3 additive settings
│   └── jiraFieldMapping.ts                  # unchanged (consumed, never copied)
├── views/
│   ├── Hygiene/
│   │   ├── checks/issueDateRules.ts         # EDIT (Drift 2) — optional inputs, one precedence step
│   │   ├── derivedDateFix.ts                # EDIT — pass the new optional inputs through
│   │   └── hooks/hygieneScan.ts             # EDIT — request subStatusFieldIds
│   ├── MyIssues/Today/
│   │   ├── ForecastSection.tsx              # NEW
│   │   ├── ForecastSection.module.css       # NEW
│   │   └── hooks/useTodayDashboard.ts       # EDIT — expose one forecast field
│   └── SprintDashboard/
│       ├── SprintDashboardView.tsx          # EDIT — one TAB_OPTIONS entry + one mount
│       ├── hooks/useSprintData.ts           # EDIT — 'forecast' joins the DashboardTab union
│       ├── forecast/                        # NEW — the engine, shared by all three surfaces
│       │   ├── effortModel.ts
│       │   ├── forecastWindows.ts
│       │   ├── issueForecast.ts
│       │   ├── capacityLoad.ts
│       │   ├── intReadiness.ts
│       │   ├── devSlChain.ts
│       │   ├── featureSizing.ts
│       │   ├── releaseDateResolve.ts
│       │   ├── forecastSettings.ts
│       │   ├── ForecastTab.tsx
│       │   ├── ForecastTab.module.css
│       │   └── ai/
│       │       ├── forecastAiAssist.ts
│       │       └── ForecastAiPanel.tsx
│       └── rollupBoard/
│           ├── laneVitals.ts                # EDIT — optional 3rd parameter, 2 extra tiles
│           ├── defaultBoardColumns.ts       # EDIT — Internal Test Ready row
│           ├── RollupBoardTab.tsx           # EDIT — compute once, pass down. No refactor.
│           └── components/
│               ├── ChildCard.tsx            # EDIT — optional forecast prop
│               └── MasterCardLane.tsx       # EDIT — render the 2 extra tiles
```

Every `*.ts` / `*.tsx` above gains a sibling `*.test.ts(x)` — the pre-commit hook requires it, and Article V demands
the test precede the code.

**Structure Decision**: The engine lives at `views/SprintDashboard/forecast/` rather than `utils/` because its domain
types (`RollupBoardItem`, `BoardColumn`, `MasterCard`) are the Roll-Up Board's. Today imports **across** into it, which
is the same direction Today already imports Hygiene's `hygieneChecks.ts`. The one genuinely cross-cutting piece — the
working-day calendar — is the only thing promoted to `utils/`.

## Design in three layers

### Layer 1 — Pure engine (no I/O, no React, no field ids)

| Module | Answers |
|---|---|
| `workingDays.ts` | How many working days between two dates, given weekends and holidays? |
| `effortModel.ts` | How many working days of work are **left** in this issue? |
| `forecastWindows.ts` | What are the release, code-freeze, external-test and PI windows, and how many working days does each hold? |
| `releaseDateResolve.ts` | What day does this fix version release, and did its name and field agree? |
| `issueForecast.ts` | What is this issue's latest start date, and is it ahead, on track, due to start today, or behind? |
| `intReadiness.ts` | Is this issue at the INT line? Is this Feature? What is holding it? |
| `devSlChain.ts` | When can SL start, and when does the Feature reach DoD? |
| `capacityLoad.ts` | Who is over capacity, by how much, and does the release fit at all? |
| `featureSizing.ts` | Have this Feature's children outgrown its estimate? |

Each takes plain data and a `todayIso`. No `Date.now()`, no `fetch`, no storage.

### Layer 2 — Configuration and composition

- `forecastSettings.ts` reads `pointsPerWorkingDay`, `holidayIsoDates` and `featureSizingTolerancePercent` from
  `artSettingsStore`, validates them, and builds one `ForecastConfig`. Invalid values are **rejected and reported**,
  never silently corrected.
- One `computeForecast(input, config)` entry point produces the whole result set. **FR-043 is satisfied structurally**:
  there is exactly one function to call, so no surface can derive its own verdict.

### Layer 3 — Surfaces

All three call `computeForecast` and render slices of one result. None re-derives anything.

## Ordering and parallelism

| Phase | Contents | Parallel? |
|---|---|---|
| **P1 Foundation** | `workingDays.ts` (+ `piPlanDates` re-export), `artSettingsStore` settings, `forecastSettings.ts` | Sequential — everything depends on it |
| **P2 Engine** | `effortModel`, `forecastWindows`, `releaseDateResolve`, `intReadiness`, `featureSizing` | ✅ Five independent files |
| **P3 Engine (dependent)** | `issueForecast` (needs P2), `devSlChain` (needs intReadiness), `capacityLoad` (needs effortModel) | ✅ Three independent files |
| **P4 Date policy** | `issueDateRules` extension, `derivedDateFix` pass-through, `hygieneScan` sub-status field | Sequential — one shared file chain |
| **P5 Surfaces** | Today section, board lane/card, Forecast tab | ✅ Three disjoint file areas |
| **P6 AI** | Three prompt kinds + panel | After P5 |

P2, P3 and P5 are genuinely disjoint and suit parallel worktree agents. P1 and P4 must be sequential — P4 touches one
file chain that three surfaces read.

## Risks

| Risk | Mitigation |
|---|---|
| The field-id rebase lands mid-implementation and conflicts | New modules name **zero** field ids, so they cannot conflict with a migration whose entire content is field ids. The three edited shipped files are edited additively. |
| Relocating working-day primitives changes PI planner behaviour | `piPlanDates.test.ts` passes unmodified, or the move is reverted. Non-negotiable. |
| The new PI DoD rule silently shifts an existing metric | `workflowDelivery.ts` is not modified and `workflowDelivery.test.ts` passes unmodified. `intReadiness.ts` imports its constants, exports its own verdict. |
| A team without the Internal Test Ready column gets a wrong forecast | The chain reads status + sub-status directly, never the column. The column is presentation only. |
| Over-capacity noise from counting full size on nearly-done work | FR-002's credit rule, reusing the board's own column order. |
| An AI reply changes a number | The reply schema has **no numeric field**. Keys not present in the prompt are rejected on ingest. |
| Forecast and progress bar disagree on the same lane | Both read `readColumnCredit` over the same ordered column ids from `loadTeamVocabulary`. |

## Complexity Tracking

*No Constitution Check violations require justification. The two Article VII drifts are recorded in the ledger above
with their behaviour-preservation proofs, and neither adds a project, a dependency, or an abstraction layer.*
