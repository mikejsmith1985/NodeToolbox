---
description: "Task list for Scheduled PI Review Save to Confluence"
---

# Tasks: Scheduled PI Review Save to Confluence

**Input**: Design documents from `specs/015-pi-review-scheduler/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED and TDD-ordered — the constitution (Article V) mandates a failing test before implementation.
Write each test task first, watch it fail, then implement.

**Organization**: Setup → Foundational (the DOM-agnostic engine + server-consumable bundle + the refresh core that
every user story relies on) → one phase per user story in priority order → Polish. This spans the Node server
(`src/`, CommonJS) and the React SPA (`client/`, TS/ESM).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 (from spec.md); Setup/Foundational/Polish carry no story label
- All paths are repository-relative.

---

## Phase 1: Setup (Shared)

- [X] T001 Add a `## [Unreleased]` stub entry to `CHANGELOG.md` naming feature 015 (scheduled PI Review Save to
  Confluence, Admin Hub-managed), to be fleshed out in Polish
- [X] T002 [P] Add `linkedom` to **server** `dependencies` and `esbuild` to `devDependencies` in `package.json` and
  install; confirm `linkedom` resolves for Node (`node -e "require('linkedom')"`) and is bundled by the pkg build.
  `esbuild` is the bundler for the shared engine (T008)

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: Make the existing save engine run server-side and build the refresh core. **Every user story is blocked
until these are green.** Delivers the SC-002 "100% preserved" and SC-003 "never emptied" guarantees at the core.

### Layer 1 — DOM-agnostic save engine (client) ⚠️ tests first

- [X] T003 [P] Update/extend `client/src/views/ArtView/piReviewTable.test.ts` to assert engine behavior is unchanged
  when a `DOMParser` is injected, and that the row/cell/element guards accept native DOM nodes — write first, watch
  fail (per research.md R1)
- [X] T004 Replace the three runtime `instanceof HTML*Element` guards (lines ~387/401/421/676/682/688/898/1097) with
  small predicates `isElementNode` (`nodeType===1`), `isRowElement` (`tagName==='tr'`), `isCellElement`
  (`td`/`th`) in `client/src/views/ArtView/piReviewTable.ts`
- [X] T005 Inject the parser at the single seam: `buildStorageDocument(storageValue, domParser = /* native */ ...)`
  in `client/src/views/ArtView/piReviewTable.ts`, threading the injected parser only where `buildStorageDocument` is
  called; all existing client callers keep the native `DOMParser` (no behavior change)
- [X] T006 Checkpoint: `cd client && npx vitest run` (piReviewTable + PiReviewTab green) and `npm run build` clean —
  proves the manual save is byte-for-byte unaffected

### Layer 2a — Server-consumable engine bundle ⚠️ test first

- [X] T007 [P] `test/server-dom/piReviewEngine.dom.spec.js` (Node `node --test`, real linkedom — see tooling note): requires
  the generated engine, injects linkedom's `DOMParser`, parses a PI Review table + capacity snapshot server-side, and
  asserts a body with **stacked duplicate Team Capacity blocks collapses to exactly one** on write (FR-012, server
  path) plus the project-clause-free JQL. Run via `npm run test:dom`. ✅ green
> **Tooling note (discovered during T007):** linkedom's transitive `css-select` ships ESM that **Jest's CommonJS
> runtime cannot load** (Node loads it natively). So **DOM-hosted server tests run on Node's native test runner**
> (`node --test`, files named `*.dom.spec.js` under `test/server-dom/`, via `npm run test:dom`); **mock-only server
> tests stay in Jest**. This
> keeps real-linkedom fidelity without a babel/transform battle. Applies to T007 and T009.

- [X] T008 Bundle the shared PI Review engine to a **CommonJS** module via **esbuild** — one source, no
  hand-maintained twin (research.md R2):
  - Create the entry `client/src/views/ArtView/piReviewEngine.entry.ts` re-exporting the pure functions the server
    needs: from `piReviewTable.ts` (`buildStorageDocument` + `parsePiReviewTable` / `writePiReviewTable` /
    `writePiReviewCapacitySummary` / `writeConfidenceVoteTable` / `parsePiReviewCapacitySummary`),
    `reconcilePiReviewRowsWithJira` (`piReviewJira.ts`), `buildDirectFeatureJql` (`piReviewPullFeatures.ts`), and
    `extractPiReviewFeatureKey` / `createEmptyPiReviewRow`.
  - Add npm script `build:pi-review-engine` → `esbuild <entry> --bundle --platform=node --format=cjs
    --outfile=src/services/generated/piReviewEngine.cjs`. **Gitignore** the generated file; it is never hand-edited.
  - Wire that script as a prerequisite of `build:client`, `build:exe`, `pretest`, and `prestart`, so the artifact is
    regenerated from the single TS source on every build/test/dev run (no drift). `pkg` bundles it because it is
    `require`d under `src/`.
  - The client keeps importing the TS source directly; only the server consumes the generated `.cjs`, injecting
    linkedom's `DOMParser`.

### Layer 2b — Refresh core (server) ⚠️ tests first

- [ ] T009 [P] Write `test/server-dom/piReviewRefresh.dom.spec.js` (Node `node --test`, real linkedom — see tooling note)
  proving the invariants from contracts/refresh-run.md — passing mocked `makeJiraApiRequest` / `makeConfluenceApiRequest`
  + a fixed `nowIso` as injected deps, but using the **real** generated engine
  (`src/services/generated/piReviewEngine.cjs`) under linkedom so preserve/reconcile are meaningful: INV-1 (empty
  query → `no-op`, no PUT), INV-2 (capacity/boundary/grouping/
  confidence + carry-over/feature-title/committed preserved), INV-3 (only priority/estimate/dependency/risks/notes may
  change, matching `reconcilePiReviewRowsWithJira`), INV-4 (one conflict → retry then succeed; always-conflict →
  `failed`), INV-5 (no row removed), plus skip reasons (blank PO → `skipped`; no Confluence creds → `failed`; invalid
  page → `failed`) — write first, watch fail
- [ ] T010 Implement `refreshPiReviewPage(page, team, deps, configuration)` in `src/services/piReviewRefresh.js` per
  contracts/refresh-run.md steps 1–8, `require`ing the generated engine (`src/services/generated/piReviewEngine.cjs`)
  for parse/reconcile/write + `buildDirectFeatureJql`; deps injected (`makeJiraApiRequest`, `makeConfluenceApiRequest`,
  `domParser` = linkedom's, `nowIso`); returns a `PiReviewRunResult`

**Checkpoint**: `npm test` (server) green for T007/T009; both builds clean.

---

## Phase 3: User Story 1 — Set-and-forget freshness (Priority: P1) 🎯 MVP

**Goal**: At a per-team `HH:MM`, with no browser open, the configured page refreshes from Jira (append + reconcile).

**Independent test**: Configure a team via the config file, set a time ~1 min out, confirm the page refreshes once at
that time and does not run twice; a same-day restart after the time still runs once (catch-up).

### Tests first ⚠️

- [ ] T011 [P] [US1] Write `src/config/loader.test.js` (or extend) proving `scheduler.piReview` round-trips: defaults
  present in `buildDefaultConfig`, values merged by `applyFileConfig`, and persisted by `saveConfigToDisk` with **no**
  credential fields — write first, watch fail
- [ ] T012 [P] [US1] Write `src/services/piReviewScheduler.test.js`: tick fires a due team at its `HH:MM` (clock +
  fired-state injected), once-per-day guard, catch-up after a late start, disabled team skipped, and no-overlap when a
  prior run is still in progress — write first, watch fail

### Implementation

- [ ] T013 [US1] Implement the `scheduler.piReview` config block in `src/config/loader.js` — defaults in
  `buildDefaultConfig`, merge in `applyFileConfig`, explicit persist in `saveConfigToDisk` (mirror `hygieneMonitor`);
  no `OBFUSCATED_CREDENTIAL_FIELDS` entry
- [ ] T014 [US1] Implement `src/services/piReviewScheduler.js` — `startPiReviewScheduler(configuration)` (60-s
  `setInterval`, `schedulerFiredState` once-per-day + catch-up, in-memory per-team overlap guard) and
  `runPiReviewTeamNow(configuration, teamRef)`; each page routed through `refreshPiReviewPage`; **persists** the last
  `PiReviewRunResult` (status, timestamp, message, counts) per team/page to the scheduler state store so the Admin Hub
  shows history across restarts (FR-019)
- [ ] T015 [US1] Import and start `startPiReviewScheduler(configuration)` in `server.js` bootstrap alongside the other
  schedulers

**Checkpoint**: scheduler + config tests green; a file-configured team refreshes on the tick (quickstart Scenario C).

---

## Phase 4: User Story 5 + User Story 4 — Run now, per-team control & visibility (Priority: P2)

**Goal**: Configure and monitor the schedule from the Admin Hub; trigger an immediate run and see success/failure.

**Independent test**: In the Admin Hub PI Review Scheduler panel, add/enable a team, click Run now, see a
success/failure result with a timestamp; toggling one team never affects another.

### Tests first ⚠️

- [ ] T016 [P] [US5] Write `src/routes/piReviewScheduler.test.js` per contracts/pi-review-scheduler-api.md — GET/POST
  `/config` (validation, no credentials echoed), POST `/run-now` (per-page results, skip reasons), and GET `/status`
  returning the **persisted** last-run summary after a simulated restart (FR-019) — write first, watch fail
- [ ] T017 [P] [US4] Write `client/src/views/AdminHub/PiReviewSchedulerPanel.test.tsx` (RTL) — loads config, edits a
  team row (enable, time, PO, PI field, pages), saves, runs-now and renders the returned result + last-run status —
  write first, watch fail

### Implementation

- [ ] T018 [US5] Implement `src/routes/piReviewScheduler.js` (`createPiReviewSchedulerRouter`) with GET/POST `/config`,
  POST `/run-now`, GET `/status` per the contract; mount at `/api/pi-review-scheduler` in `server.js`
- [ ] T019 [US4] Implement `client/src/views/AdminHub/PiReviewSchedulerPanel.tsx` — copy `StandupBriefingPanel.tsx`;
  per-team rows (enable toggle, `HH:MM`, PO assignee, PI field id, pages list of URL+PI name), Save, Run now, last-run
  status column; direct `fetch` to `/api/pi-review-scheduler/*`
- [ ] T020 [US4] Register the panel in `client/src/views/AdminHub/AdminHubView.tsx` — add the tab key to the
  `AdminHubTab` union, an entry in `ADMIN_HUB_TAB_OPTIONS`, and a render branch

**Checkpoint**: route + panel tests green; quickstart Scenarios A, B pass end-to-end.

---

## Phase 5: User Story 3 — Manual save unchanged (Priority: P3)

**Goal**: The manual "Save to Confluence" button behaves exactly as before; scheduled and manual agree (no drift).

**Independent test**: Manual save produces the same Jira-owned columns a scheduled run would; full PiReviewTab suite
passes unchanged.

- [ ] T021 [US3] Verification task — confirm `client/src/views/ArtView/PiReviewTab.tsx` and its save path are
  untouched by the Layer 1 seams: run the full `client` vitest suite (PiReviewTab + piReviewTable green) and record
  that the native-DOM callers still pass the native parser; note the no-drift guarantee in the CHANGELOG entry

---

## Phase 6: Polish & Cross-Cutting

- [ ] T022 [P] Flesh out the `CHANGELOG.md` `[Unreleased]` entry: what the scheduler does, the preserve-vs-refresh
  boundary, per-team Admin Hub config + Run now, and that the manual button is unchanged
- [ ] T023 Run the full suites and builds green: `npm test` (server), `cd client && npx vitest run`,
  `cd client && npm run build`; `npx eslint` clean on all changed files
- [ ] T024 Execute quickstart Scenarios A–E against a real PI Review page and record the evidence (Article X):
  Run-now refresh preserves manual content; no-op leaves rows intact; scheduled fire + catch-up; manual unaffected;
  conflict retry-then-report

---

## Dependencies & sequencing

```
Setup (T001–T002)
  └─> Foundational
        Layer 1 engine seams (T003→T004→T005→T006)
          └─> Layer 2a bundle (T007→T008)
                └─> Layer 2b refresh core (T009→T010)
                      ├─> US1 scheduler+config (T011,T012 → T013,T014 → T015)      [MVP]
                      │     └─> US5+US4 route+panel (T016,T017 → T018,T019 → T020)
                      │           └─> US3 no-regression verify (T021)
                      └─> Polish (T022 [P], T023, T024)
```

- **Blocking**: Foundational (T003–T010) blocks all user stories. Within it, Layer 1 → 2a → 2b is strictly ordered.
- **US1** is the MVP: once T015 lands, a file-configured team refreshes on schedule (no UI yet).
- **US5/US4** (panel) depends on US1's config + scheduler. **US3** is a verification pass after the UI lands.

## Parallel execution examples

- **Setup**: T002 [P] runs alongside T001.
- **Foundational tests**: T007 [P] and T009 [P] are authored in parallel (different files), but implementations T008
  then T010 are ordered (T010 requires the bundle).
- **US1 tests**: T011 [P] and T012 [P] in parallel (loader vs scheduler test files).
- **Phase 4 tests**: T016 [P] (route, server) and T017 [P] (panel, client) in parallel.
- **Polish**: T022 [P] alongside T023/T024 prep.

## Implementation strategy

- **MVP = Phase 1 + 2 + 3** (through T015): scheduled refresh works, configured via the config file, with all
  preservation/no-empty/conflict invariants proven. Shippable behind the disabled-by-default toggle.
- **Increment 2 = Phase 4**: the Admin Hub panel + Run now makes it usable without hand-editing config.
- **Increment 3 = Phase 5 + 6**: no-regression verification, CHANGELOG, and the real-page quickstart evidence.
- Ship each increment behind the per-team `isEnabled` toggle (default off), so nothing runs until a user opts in.

## Total: 24 tasks

- Setup: 2 · Foundational: 8 (T003–T010) · US1: 5 · US5+US4: 5 · US3: 1 · Polish: 3
