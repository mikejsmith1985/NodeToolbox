# Implementation Plan: Scheduled PI Review Save to Confluence

**Branch**: `feature/015-pi-review-scheduler` | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/015-pi-review-scheduler/spec.md`

## Summary

Add an **optional, per-team server-side scheduler** that refreshes a PI Review Confluence page from Jira on a daily
`HH:MM` — the manual "Save to Confluence" button, on a timer — while leaving that button unchanged as the urgent
escape hatch. A run **appends** newly-matched PO+PI Features and **reconciles** the Jira-owned columns (Priority,
Point Estimate, Dependency, Risks, + Notes migration) exactly as the manual save does, **never removing rows** and
**preserving** all human-curated content (carry-over, feature title, committed, capacity, commitment boundary,
grouping, confidence). Managed from a new Admin Hub panel with Run-now + last-run status.

The design is **overwhelmingly reuse**. The genuinely new work is a scheduler service + route + Admin Hub panel + a
`configuration.scheduler.piReview` config block — all direct mirrors of the existing Standup Briefing triad — plus
**two tiny seams** that let the existing save engine run server-side. The single real risk is making
`piReviewTable.ts` DOM-implementation-agnostic; research (R1) reduced that to replacing **three `instanceof` guards**
with tag/`nodeType` predicates and **injecting the parser** at one factory.

Work is layered so the risky DOM-portability lands and is proven **before** any scheduler wiring:

1. **DOM-agnostic save engine (client, TDD)** — replace the 3 runtime `instanceof HTML*Element` guards with
   predicates and inject the `DOMParser` at `buildStorageDocument`. Prove parity with existing client tests + a new
   linkedom round-trip test. *(R1, R2; no behavior change to the manual save.)*
2. **Server-side refresh core (server, TDD)** — `refreshPiReviewPage` orchestrating reused pure logic
   (`buildDirectFeatureJql`, `reconcilePiReviewRowsWithJira`, the engine) over injected `makeJiraApiRequest` /
   `makeConfluenceApiRequest` / linkedom / `nowIso`. Prove the INV-1…INV-5 invariants. *(FR-006–FR-012, FR-016.)*
3. **Scheduler + config** — `configuration.scheduler.piReview` in `loader.js`; `piReviewScheduler.js` (60-s tick,
   `schedulerFiredState`, per-team overlap guard); start in `server.js`. *(FR-001–FR-005, FR-013–FR-015.)*
4. **Route + Admin Hub panel** — `/api/pi-review-scheduler/*` route; `PiReviewSchedulerPanel.tsx` (copy of Standup)
   registered in `AdminHubView.tsx`; CHANGELOG. *(FR-017–FR-022.)*

## Technical Context

**Language/Version**: Server — Node (CommonJS, packaged via `@yao-pkg/pkg`). Client — TypeScript ~5.x, React 19 (ESM).

**Primary Dependencies**: Reuse — `schedulerFiredState.js`, `httpClient.js` (`makeJiraApiRequest`,
`makeConfluenceApiRequest`), `loader.js` config plumbing, the Standup Briefing scheduler/route/panel as templates;
and the PI Review pure logic (`buildDirectFeatureJql`, `reconcilePiReviewRowsWithJira`, `parsePiReviewTable` /
`writePiReviewTable` / `writePiReviewCapacitySummary` / `writeConfidenceVoteTable`, `extractPiReviewFeatureKey`).
**New dependency**: `linkedom` (server, pure-JS, pkg-safe) as the headless DOM host.

**Storage**: Server config file (`%APPDATA%\NodeToolbox\toolbox-proxy.json`) under `scheduler.piReview`; fired-state in
`scheduler-fired-state.json`. No browser storage; no new secret store (auth reuses `configuration.jira/confluence`).

**Testing**: Jest (server, node env) for the refresh core + scheduler + config; Vitest + RTL (client) for the engine
seam refactor and the Admin Hub panel. Refresh core is pure-with-injected-deps → exhaustive fast unit tests (INV-1…5).

**Target Platform**: Windows desktop (server exe) + browser SPA.

**Project Type**: Web — Node server (`src/`) + React SPA (`client/`).

**Performance Goals**: One team = a handful of pages; each run is one Jira search + one batched issue fetch + one
Confluence GET/PUT. Trivial load; the 60-s tick is O(teams).

**Constraints**: `pkg`-safe deps only (linkedom yes, jsdom no); no new Jira/Confluence write paths (reuse the REST
helpers); server-side auth via existing credentials only (no secret entered by this feature); manual save untouched.

**Scale/Scope**: Per-team schedules, single server instance; local config only.

## Constitution Check

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ `feature/015-pi-review-scheduler` |
| IV — Code Quality | Small pure fns, doc comments, verb-first names | ✅ `refreshPiReviewPage` + injected deps decompose into small helpers |
| V — Testing | TDD; fast mocked units first | ✅ Layer 1–2 are unit-first (engine parity, INV-1…5) before any wiring |
| VI — Documentation | CHANGELOG; no ad-hoc docs | ✅ CHANGELOG at Layer 4; only `specs/015-*` artifacts |
| VII — Framework-First | Reuse, don't rebuild | ✅ Scheduler triad, fired-state, REST helpers, PI Review logic all reused; only new: linkedom host + config block + panel. See note. |
| VIII — Release | Local pipeline only | ✅ N/A until release (`local-release.ps1`) |
| IX — Vault | No secrets handled | ✅ Reuses existing server creds; no secret entered/stored/logged by this feature |
| X — Verification | Evidence, not "compiles" | ✅ quickstart INV-1…5 + 5 e2e scenarios |
| XI — Output Restraint | ≤1 dashboard; no phase narration | ✅ An Admin Hub *panel*, not a dashboard artifact |

**Framework-First note**: The headless-DOM host is a genuine, documented gap — Node has no DOM, and re-implementing
the ~1200-line save engine would guarantee drift from the manual save (the exact fragility to avoid). `linkedom` is
the minimal framework-provided fill (R1); the two seams keep **one** shared engine. Everything else — scheduling,
fired-state, REST, config persistence, panel — is reuse. No Complexity Tracking entry required.

**Result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/015-pi-review-scheduler/
├── plan.md · spec.md · research.md · data-model.md · quickstart.md
├── contracts/  (pi-review-scheduler-api.md, refresh-run.md)
└── checklists/requirements.md
```

### Source Code (repository root) — planned

```text
client/src/views/ArtView/
├── piReviewTable.ts                 # EDIT: replace 3 `instanceof HTML*Element` guards with isElementNode/
│                                    #       isRowElement/isCellElement; inject DOMParser into buildStorageDocument
│                                    #       (native DOMParser passed by existing client callers — no behavior change)
├── piReviewTable.test.ts            # EDIT/ADD: parity under injected parser; predicate guards
└── piReviewEngine.entry.ts          # NEW: re-exports the pure engine fns; esbuild bundles THIS to the server CJS

src/services/generated/
└── piReviewEngine.cjs               # GENERATED (gitignored) by `build:pi-review-engine` (esbuild); required by
                                     #       the server refresh core. One source (the TS above), never hand-edited.

src/services/
├── piReviewRefresh.js               # NEW: refreshPiReviewPage(page, team, deps, configuration) -> PiReviewRunResult
│                                    #       (reuses the shared engine via linkedom; INV-1…5). Pure orchestration + DI.
├── piReviewRefresh.test.js          # NEW: INV-1…5, skip reasons, conflict retry (all mocked)
├── piReviewScheduler.js             # NEW: startPiReviewScheduler(configuration) 60-s tick + fired-state + overlap
│                                    #       guard; runPiReviewTeamNow(...) for the route. Copy standupBriefingScheduler.
└── piReviewScheduler.test.js        # NEW: time-match, once-per-day, catch-up, disabled-skip, no-overlap

src/routes/
└── piReviewScheduler.js             # NEW: create…Router -> GET/POST /config, POST /run-now, GET /status
                                     #       (mirror standupBriefing.js)

src/config/
└── loader.js                        # EDIT: scheduler.piReview defaults (buildDefaultConfig), merge (applyFileConfig),
                                     #       explicit persist block (saveConfigToDisk). No OBFUSCATED field (no secret).

server.js                            # EDIT: import+start piReviewScheduler; mount the new router

client/src/views/AdminHub/
├── PiReviewSchedulerPanel.tsx       # NEW: copy of StandupBriefingPanel — per-team rows (enable, time, PO, PI field,
│                                    #       pages), Run now, last-run status; fetch to /api/pi-review-scheduler/*
├── PiReviewSchedulerPanel.test.tsx  # NEW: RTL — config load/save, run-now result, status render
└── AdminHubView.tsx                 # EDIT: tab union + ADMIN_HUB_TAB_OPTIONS + render branch

package.json                         # EDIT: add `linkedom` (server dep) + `esbuild` (devDep); add
                                     #       `build:pi-review-engine` script (esbuild → src/services/generated/
                                     #       piReviewEngine.cjs), wired into build:client/build:exe/pretest/prestart
.gitignore                           # EDIT: ignore src/services/generated/
CHANGELOG.md                         # EDIT: [Unreleased] entry (Layer 4)
```

**Structure Decision**: The engine edit stays in `piReviewTable.ts` (one shared engine, no fork) — the seams are
behavior-neutral for the browser (it keeps passing the native `DOMParser`). The server pieces mirror the Standup
triad 1:1 so they slot into the established scheduler conventions. The refresh **core** is separated from the
**scheduler** (`piReviewRefresh.js` vs `piReviewScheduler.js`) so the invariant-heavy logic is unit-tested without any
timer, and `run-now` and the tick share the exact same core.

## Complexity Tracking

> Not required — Constitution Check passes. The one new dependency (`linkedom`) fills a real DOM gap and is justified
> in the Framework-First note; everything else is reuse.

## Phasing & checkpoints

- **Layer 1 (now) — DOM-agnostic engine (client, TDD).** Predicate guards + injected parser in `piReviewTable.ts`.
  **Checkpoint**: existing `piReviewTable.test.ts` still green (native DOM) **and** a new linkedom round-trip test
  green; `cd client && npm run build` clean. No change to the manual save's behavior.
- **Layer 2 — refresh core (server, TDD).** `piReviewRefresh.js` over injected deps. **Checkpoint**: INV-1…INV-5 +
  skip-reason unit tests green (`npm test`).
- **Layer 3 — scheduler + config.** `piReviewScheduler.js`, `loader.js` block, `server.js` start. **Checkpoint**:
  scheduler unit tests (time-match/once-per-day/catch-up/no-overlap) green; config round-trips through
  `saveConfigToDisk`.
- **Layer 4 — route + panel + CHANGELOG.** `/api/pi-review-scheduler/*`, `PiReviewSchedulerPanel.tsx`,
  `AdminHubView.tsx`. **Checkpoint**: quickstart Scenarios A–E pass; both builds clean; CHANGELOG updated.

## Dependencies & sequencing

Layer 1 -> Layer 2 (refresh core needs the DOM-agnostic engine). Layer 2 -> Layer 3 (scheduler drives the core).
Layer 3 -> Layer 4 (panel drives config + run-now). Each layer is independently testable and shippable behind the
disabled-by-default toggle.
