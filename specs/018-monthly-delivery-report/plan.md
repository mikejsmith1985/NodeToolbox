# Implementation Plan: Monthly Delivery Report — Scheduled AI-Prompt Generator

**Branch**: `feature/monthly-delivery-report` (to be created at implementation start — current forge worktree
branches are rejected by the pre-commit hook) | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-monthly-delivery-report/spec.md`

## Summary

A new server-side scheduler generates, on the 2nd Tuesday of each month at a configurable time (default 08:00),
one plain-text AI prompt covering every snapshotted team: Stories/Tasks that reached **Production** (done-category
entry in the covered month, or a fix version released in that month) or **External Test** (entered the delivered
run — "Ready for QA" or later — in that month), attributed via changelog and grouped under parent Features. The
prompt and per-team outcomes persist to a results file, surfaced in a new Admin Hub panel with Run Now and Copy
Prompt. Delivery classification reuses `workflowDelivery.ts` bundled server-side via the established esbuild
engine pattern; the scheduler reuses the PI Review chassis with a new once-per-month guard. Full decision log:
[research.md](./research.md).

## Technical Context

**Language/Version**: Server — Node.js CommonJS (`src/`); Client — TypeScript + React 18 (`client/src/`)

**Primary Dependencies**: Express (existing server), zustand (existing client store), esbuild (existing bundler,
`build:pi-review-engine` precedent). **Zero new dependencies.**

**Storage**: `%APPDATA%\NodeToolbox\toolbox-proxy.json` (scheduler config, via `src/config/loader.js` whitelist);
`%APPDATA%\NodeToolbox\scheduler-fired-state.json` (fired state, shared module);
`%APPDATA%\NodeToolbox\monthly-delivery-last-run.json` (new results file, env override
`TBX_MONTHLY_DELIVERY_RESULTS_PATH`)

**Testing**: Server — Jest (`src/services/*.test.js`, `test/unit/*.test.js`), DI-tick pattern from
`test/unit/piReviewScheduler.test.js`; Client — vitest + @testing-library
(`PiReviewSchedulerPanel.test.tsx` / `StandupBriefingPanel.test.tsx` fetch-stub pattern)

**Target Platform**: Windows desktop deployment of the NodeToolbox server + browser client (existing)

**Project Type**: Web application (Express server + React client, existing repo layout)

**Performance Goals**: Full run for ≤10 teams completes in <5 minutes (SC-002); ~2–3 Jira requests per team plus
one Feature-summary batch and one versions fetch per team

**Constraints**: No UI outside Admin Hub (FR-019); no new delivery channels; prompt must paste cleanly into a
chat agent (FR-015); per-team failures must not abort the run and must be reported honestly (FR-018, GH #167
lesson); config must survive the `saveConfigToDisk` whitelist

**Scale/Scope**: ~10 teams, hundreds of issues/month/team worst case (paginated Jira search, `startAt` loop —
a deliberate improvement over the 200-cap precedent, justified in research.md D3)

## Constitution Check

*GATE evaluated against `.specify/memory/constitution.md` — all Articles pass; re-checked post-design (Phase 1).*

| Article | Status | Evidence |
|---|---|---|
| III Branching | ✅ | Implementation starts on `feature/monthly-delivery-report`; never on `main`; PR to merge |
| IV Code Quality | ✅ | Plan names verb-first functions, `is/has` booleans, named constants; functions <40 lines (chassis already conforms) |
| V Testing (TDD) | ✅ | Red→green per module: pure helpers (second-Tuesday, month window, classification, prompt builder) unit-tested first; DI-tick tests; route tests; panel vitest tests. Unit layer fully mocked |
| VI Documentation | ✅ | CHANGELOG.md entry required; no auxiliary status docs; `specs/018-*` tree is the exempt pipeline artifact |
| VII Framework-First | ✅ | Reuses: scheduler chassis, `schedulerFiredState`, `isScheduledTimeReached`, `workflowDelivery.ts` (bundled), `featureLink.ts`, esbuild engine pattern, Admin Hub panel idioms. Documented gaps only: once-per-month guard, `released`-flag read, pagination loop, client→server team snapshot — each recorded in research.md with justification |
| VIII Release | ✅ | No release-process changes; ships via `local-release.ps1` as usual |
| IX Vault Zero-Knowledge | ✅ | Uses existing server Jira/Confluence config; no secrets in prompt, code, or logs |
| X Verification & Proof | ✅ | quickstart.md defines end-to-end evidence: real run, prompt inspected, month attribution spot-checked against Jira changelog |
| XI Output Restraint | ✅ | One Admin Hub panel; no dashboards, no unsolicited summaries |

**Complexity Tracking**: no violations to justify — table omitted.

## Project Structure

### Documentation (this feature)

```text
specs/018-monthly-delivery-report/
├── plan.md              # This file
├── research.md          # Phase 0 — decision log D1–D7
├── data-model.md        # Phase 1 — entities & classification rules
├── quickstart.md        # Phase 1 — end-to-end validation guide
├── contracts/
│   ├── http-api.md      # Router endpoints + config JSON shapes
│   ├── engine-bundle.md # Bundled engine exports + build constraint
│   └── prompt-format.md # The prompt artifact structure (FR-013–FR-015)
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── monthlyDeliveryScheduler.js        # NEW — chassis: tick, once-per-month guard, run orchestration,
│   │                                      #        results-file persistence (piReviewScheduler pattern)
│   ├── monthlyDeliveryReport.js           # NEW — data layer: Jira queries (A+B, paginated), changelog
│   │                                      #        classification via bundled engine, Feature grouping,
│   │                                      #        prompt builder (pure, exported for tests)
│   ├── monthlyDeliveryScheduler.test.js   # NEW — Jest: DI-tick, second-Tuesday math, once-per-month guard
│   ├── monthlyDeliveryReport.test.js      # NEW — Jest: classification, grouping, prompt builder (mocked I/O)
│   └── generated/
│       └── monthlyDeliveryEngine.cjs      # GENERATED — esbuild output (gitignored like piReviewEngine.cjs)
├── routes/
│   └── monthlyDelivery.js                 # NEW — createMonthlyDeliveryRouter(configuration)
├── config/
│   └── loader.js                          # EDIT — add scheduler.monthlyDelivery to saveConfigToDisk whitelist
server.js                                  # EDIT — mount router (~line 146 area), start scheduler (~line 665)
test/unit/
└── monthlyDeliveryRoute.test.js           # NEW — Jest route tests (piReviewSchedulerRoute.test.js pattern)

client/src/
├── utils/
│   ├── workflowDelivery.ts                # EDIT — add pure month-attribution helper(s) for done-entry date
│   ├── workflowDelivery.test.ts           # EDIT — vitest for the new helpers (red first)
│   └── monthlyDeliveryEngine.entry.ts     # NEW — re-exports pure fns from workflowDelivery + featureLink
├── views/AdminHub/
│   ├── AdminHubView.tsx                   # EDIT — tab union + ADMIN_HUB_TAB_OPTIONS + tabpanel block
│   ├── MonthlyDeliveryPanel.tsx           # NEW — panel (StandupBriefingPanel model)
│   └── MonthlyDeliveryPanel.test.tsx      # NEW — vitest (installFetch stub pattern)
package.json                               # EDIT — build:monthly-delivery-engine + pre-hooks
CHANGELOG.md                               # EDIT — feature entry
CLAUDE.md                                  # EDIT — 018 entry + engine-bundle standing constraint
```

**Structure Decision**: Two-file server split keeps every function under the 40-line rule and separates the
schedule chassis (timers, fired state, persistence) from the pure/report layer (queries, classification, prompt) —
mirroring how `piReviewScheduler.js` delegates to `piReviewRefresh.js`. The engine entry lives in `client/src/utils/`
beside its sources because, unlike the 015 engine, it bundles utils not an ArtView feature.

## Design essentials (details in contracts/ and data-model.md)

- **Fire rule**: fire once per calendar month when `today > secondTuesday(currentMonth)` (catch-up) or
  `today === secondTuesday && isScheduledTimeReached(scheduleTime, now)`; guard compares fired-state `YYYY-MM`
  prefix. Covered month = calendar month before the current one, always.
- **Run Now**: same run function with `trigger: 'manual'`, bypassing guard and never writing fired state (FR-003).
- **Classification precedence**: Production > External Test; an issue appears exactly once (FR-010/011); rules
  formalized in data-model.md.
- **Honest failures**: per-team try/catch → `status: 'error'` outcome + "DATA UNAVAILABLE" prompt section; a run
  only reports "ok" for teams whose queries all succeeded (FR-014/018).
- **Post-design constitution re-check**: pass — no new dependencies, no rebuilt infrastructure, all custom pieces
  carry recorded gap justifications (research.md table).
