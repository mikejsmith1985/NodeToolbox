# Tasks: Monthly Delivery Report — Scheduled AI-Prompt Generator

**Input**: Design documents from `/specs/018-monthly-delivery-report/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — the project constitution mandates TDD (Article V, red → green → refactor). Every
implementation task is preceded by a failing-test task.

**Organization**: Three user stories from spec.md's flows: US1 = Configuration & team snapshot, US2 = On-demand
prompt generation (Run Now → Copy Prompt), US3 = Scheduled monthly automation. US2 is the value core; it depends
on US1's config surface. MVP = US1 + US2 together (config alone delivers nothing; Run Now needs config).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3
- Paths: server `src/`, client `client/src/` (web app, per plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch + the engine-bundle build pipeline every later phase requires

- [X] T001 Create branch `feature/monthly-delivery-report` from up-to-date `main` (NOT from a forge worktree
      branch — the pre-commit hook rejects stale `forge/wt-*` lineage; sync `main` first)
- [X] T002 Create engine entry `client/src/utils/monthlyDeliveryEngine.entry.ts` re-exporting the pure functions
      listed in `contracts/engine-bundle.md` (initially the existing exports only; `resolveDoneEntryDateIso` is
      added in T006). MUST NOT export anything touching browser APIs — top-of-file purpose comment states this.
- [X] T003 Add `build:monthly-delivery-engine` esbuild script to `package.json` (mirror `build:pi-review-engine`:
      `--bundle --platform=node --format=cjs --outfile=src/services/generated/monthlyDeliveryEngine.cjs`) and
      chain it into `prestart`, `prebuild:exe`, `pretest`; run it once and confirm the `.cjs` compiles
- [X] T004 [P] Confirm `src/services/generated/` gitignore coverage includes the new
      `monthlyDeliveryEngine.cjs` (same treatment as `piReviewEngine.cjs`); extend `.gitignore` if needed

**Checkpoint**: `npm run build:monthly-delivery-engine` succeeds; a Node REPL can
`require('./src/services/generated/monthlyDeliveryEngine.cjs')` and call `isDeliveredWorkflowStatusName`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one new ladder helper, the pure date math, and config persistence — everything all three
stories sit on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 [P] RED: add failing vitest cases to `client/src/utils/workflowDelivery.test.ts` for
      `resolveDoneEntryDateIso(issue)`: returns ISO of the MOST RECENT transition into a done-category status
      (`DONE_CATEGORY_STATUS_NAMES`); null when never done, when changelog absent, and when the issue regressed
      out of done afterwards (per data-model.md classification rule 1)
- [X] T006 GREEN: implement `resolveDoneEntryDateIso` in `client/src/utils/workflowDelivery.ts` (pure, <40 lines,
      doc comment explaining the business rule), add it to `monthlyDeliveryEngine.entry.ts` exports, rebuild the
      engine, confirm vitest green
- [X] T007 [P] RED: create `src/services/monthlyDeliveryScheduler.test.js` (Jest) with failing cases for the pure
      helpers: `computeSecondTuesdayDate(year, monthIndex)` (all weekday offsets), `resolveCoveredMonth(today)`
      (prior calendar month, incl. January → December year rollover), `buildCoveredMonthWindow(coveredMonth)`
      (first day 00:00 local → last day 23:59:59.999, incl. leap February), and
      `hasAlreadyFiredThisMonth(storedDate, today)` (`YYYY-MM` prefix compare)
- [X] T008 GREEN: implement those pure helpers in `src/services/monthlyDeliveryScheduler.js` (named constants, no
      magic numbers, exported for tests per the scopeChange precedent)
- [X] T009 Extend the `scheduler:` whitelist in `saveConfigToDisk` (`src/config/loader.js`, ~lines 155–183) with
      the `monthlyDelivery` block (`isEnabled`, `scheduleTime`, `featureLinkFieldId`, `teams[]` — shapes per
      data-model.md); add/extend a loader Jest case proving the block round-trips through save→load (the
      confirmed silent-drop gotcha)

**Checkpoint**: Foundation ready — engine bundle exposes the full contract, date math proven, config persists

---

## Phase 3: User Story 1 — Configuration & Team Snapshot (Priority: P1)

**Goal**: The Admin Hub panel exists; the user can snapshot Team Dashboard teams into server config, set
time/enable, save, and the config survives a restart (spec "Configuration flow", FR-004/005/006 groundwork)

**Independent Test**: quickstart.md scenario 1 — snapshot, save, `GET /api/monthly-delivery/config` returns the
teams, `toolbox-proxy.json` contains them, restart preserves them

### Tests for User Story 1 (RED first)

- [X] T010 [P] [US1] Create `test/unit/monthlyDeliveryRoute.test.js` *(landed at `src/routes/monthlyDelivery.test.js` — the pre-commit hook requires co-located tests)* (Jest, `piReviewSchedulerRoute.test.js`
      pattern) with failing cases: GET returns defaults when unset; POST sanitises (`scheduleTime` regex →
      fallback `"08:00"`, teams with empty `projectKey` dropped, `featureLinkFieldId` default), mutates
      `configuration.scheduler.monthlyDelivery` in place, and calls `saveConfigToDisk`; 400 on invalid body
- [X] T011 [P] [US1] Create `client/src/views/AdminHub/MonthlyDeliveryPanel.test.tsx` (vitest, `installFetch`
      stub pattern from `PiReviewSchedulerPanel.test.tsx`) with failing cases: loads and renders config; Snapshot
      Teams reads a mocked `useSettingsStore` `sprintDashboardTeamProfiles` and lists `{name, projectKey}`; Save
      POSTs the mapped snapshot body; dirty flag set on edit and cleared on save (`role="status"` shows saved)

### Implementation for User Story 1

- [X] T012 [US1] GREEN (server): create `src/routes/monthlyDelivery.js` — `createMonthlyDeliveryRouter(configuration)`
      with `GET /api/monthly-delivery/config` + `POST /api/monthly-delivery/config` per `contracts/http-api.md`
      (sanitisers as small named functions, `SCHEDULE_TIME_PATTERN` constant); mount in `server.js` beside the PI
      Review router (~line 146)
- [X] T013 [US1] GREEN (client): create `client/src/views/AdminHub/MonthlyDeliveryPanel.tsx` — config section
      only (enable toggle, time input, snapshotted team list, Snapshot Teams button reading
      `useSettingsStore((s) => s.sprintDashboardTeamProfiles)` mapped to `{teamName, projectKey, boardId}` plus
      `featureLinkFieldId` from the ART settings source, Save). `StandupBriefingPanel` structure, AdminHub module
      CSS classes, file purpose comment
- [X] T014 [US1] Register the tab in `client/src/views/AdminHub/AdminHubView.tsx`: extend the `AdminHubTab` union,
      `ADMIN_HUB_TAB_OPTIONS` (label `📅 Monthly Delivery`), import + `<section role="tabpanel">` block; stub the
      panel and extend the settings-store mock in `client/src/views/AdminHub/AdminHubView.test.tsx` (line ~161)
      so the view suite stays green

**Checkpoint**: quickstart scenario 1 passes end-to-end (config round-trip + restart survival) — US1 done

---

## Phase 4: User Story 2 — On-Demand Prompt Generation (Priority: P2) 🎯 completes the MVP

**Goal**: Run Now produces the full classified, Feature-grouped, all-teams prompt; last run persists; the panel
shows it with Copy Prompt (spec "Ad-hoc flow", FR-007–FR-018 minus scheduling)

**Independent Test**: quickstart.md scenarios 2 & 3 — real run against Jira, month attribution spot-checked in
issue history, honest per-team failure, prompt pastes cleanly into the in-house agent

### Tests for User Story 2 (RED first)

- [X] T015 [P] [US2] Create `src/services/monthlyDeliveryReport.test.js` (Jest, fully mocked I/O) with failing
      cases per data-model.md classification rules: Production via done-entry in window; Production via released
      fixVersion without in-month transition (`isDeliveredIssue` precondition); External Test via
      `resolveDeliveryDateIso` in window; Production-beats-External precedence; prior-month External entry NOT
      re-reported; missing changelog excluded; Feature grouping via candidate fields → `parent.key` → "No
      Feature"; dedupe across the two queries
- [X] T016 [P] [US2] Add failing prompt-builder cases to `src/services/monthlyDeliveryReport.test.js` per
      `contracts/prompt-format.md`: instructions-then-banner-then-teams order, fixed bucket order, sorted Feature
      groups with "No Feature" last, sorted issue lines with exact line format, "No recorded deliveries this
      month." for empty teams, "DATA UNAVAILABLE: reason" for failed teams, every configured team present in
      config order (snapshot-style assertions on the full text)
- [X] T017 [P] [US2] Add failing route cases to `test/unit/monthlyDeliveryRoute.test.js`: `POST run-now` → 200
      with RunResult, 400 when teams empty, 409 while a run is in progress; per-team Jira failure stays inside a
      200 (`teams[].status === 'error'`); `GET status` returns persisted RunResult verbatim incl. `promptText`,
      `{hasRun: false}` before any run
- [X] T018 [P] [US2] Add failing panel cases to `MonthlyDeliveryPanel.test.tsx`: Run Now disabled while dirty
      (PiReview gating precedent); Run Now POSTs and refreshes status without clobbering unsaved edits; last-run
      line renders `ranAtIso`/`coveredMonth`/per-team outcomes incl. error teams; prompt in readonly textarea;
      Copy Prompt disabled when empty, writes clipboard (stubbed) and flips to `✓ Copied!`; when the saved config
      has zero teams, the panel shows a "no teams configured — snapshot and save first" notice and Run Now is
      disabled (FR-006)

### Implementation for User Story 2

- [X] T019 [US2] GREEN (data): in `src/services/monthlyDeliveryReport.js` implement the Jira fetch layer —
      `searchJiraIssuesPaginated` (`startAt` loop, drift justification comment per research.md D3), query A
      (`status CHANGED DURING` JQL builder with `yyyy/MM/dd` dates), query B (project `/versions` fetch filtered
      to `released === true` + in-window `releaseDate`, then `fixVersion in (...)` search), key-based dedupe;
      fields `summary,status,issuetype,fixVersions,<featureLinkFieldId>,customfield_10108,customfield_10014,parent`,
      `expand=changelog`; `makeJiraApiRequest` from `src/utils/httpClient`
- [X] T020 [US2] GREEN (classification): same file — `classifyDeliveryRecords` using the bundled engine
      (`resolveDoneEntryDateIso`, `resolveDeliveryDateIso`, `isDeliveredIssue`) per data-model.md rules 1–4, and
      `groupRecordsByFeature` (engine `extractFeatureKeyFromIssueFields` + one batched `key in (...)` summary
      fetch per run, key-fallback on fetch failure)
- [X] T021 [US2] GREEN (prompt): same file — `buildMonthlyDeliveryPrompt(coveredMonth, ranAtIso, trigger,
      teamSections)` exactly per `contracts/prompt-format.md`; deterministic sorting; all tests from T016 green
- [X] T022 [US2] GREEN (orchestration): in `src/services/monthlyDeliveryScheduler.js` implement
      `runMonthlyDeliveryNow(configuration, deps = {})` — per-team try/catch → TeamOutcome (`ok`/`empty`/`error`,
      counts, honest messages), module-level in-progress guard, RunResult write via `writeLastRunResult` /
      `readLastRunResult` to `monthly-delivery-last-run.json` (env override `TBX_MONTHLY_DELIVERY_RESULTS_PATH`,
      piReview results-file pattern); injectable `deps` (jira request, now) for tests
- [X] T023 [US2] GREEN (routes): add `POST /api/monthly-delivery/run-now` (no body; 409 overlap; 400 no teams)
      and `GET /api/monthly-delivery/status` to `src/routes/monthlyDelivery.js` per `contracts/http-api.md`
- [X] T024 [US2] GREEN (panel): extend `MonthlyDeliveryPanel.tsx` — Run Now button (dirty-gated + warning line),
      last-run status display (per-team outcomes, error styling), readonly prompt `<textarea>`, Copy Prompt via
      `navigator.clipboard.writeText` with transient `✓ Copied!` label and disabled-when-empty
      (StandupBriefingPanel idiom), and the zero-teams notice + Run Now disabling from T018 (FR-006)

**Checkpoint**: quickstart scenarios 2 & 3 pass against real Jira — attribution spot-check, honest failure,
clean paste into the in-house agent. **MVP complete** (US1 + US2)

---

## Phase 5: User Story 3 — Scheduled Monthly Automation (Priority: P3)

**Goal**: The run fires itself — once per month on the 2nd Tuesday at the configured time, with same-month
catch-up, never double-firing (spec "Primary flow", FR-001/002/004)

**Independent Test**: quickstart.md scheduler-trigger validation — DI tick tests for every fire/skip case, plus
the optional live catch-up smoke

### Tests for User Story 3 (RED first)

- [X] T025 [P] [US3] Add failing DI-tick cases to `src/services/monthlyDeliveryScheduler.test.js`
      (`piReviewScheduler.test.js` pattern — injected `currentTime`, `today`, `firedDates`, `recordFired`,
      `runReport`): disabled → idle; no teams → idle WITHOUT writing fired state; before 2nd Tuesday → idle; on
      2nd Tuesday before `scheduleTime` → idle; on it at/after → fires once and records; later same month
      (catch-up) → fires regardless of time; re-tick same month → guarded; next month → fires again; overlap
      (running set) → skipped; a manual run (`runMonthlyDeliveryNow`, `trigger: 'manual'`) never calls
      `recordFired` and a subsequent same-month scheduled tick still fires (FR-003); config mutated between
      ticks (e.g. `scheduleTime` or `isEnabled` change) is honored on the next tick without restart (FR-004)

### Implementation for User Story 3

- [X] T026 [US3] GREEN: implement `checkAndFireMonthlyDelivery(configuration, options = {})` and
      `startMonthlyDeliveryScheduler(configuration)` (60-second `setInterval`, stop function, fired state seeded
      via `loadFiredDates('monthlyDelivery')` / recorded via `recordFiredDate`, fire rule per data-model.md state
      diagram, scheduled runs call the same `runMonthlyDeliveryNow` with `trigger: 'scheduled'`)
- [X] T027 [US3] Wire `startMonthlyDeliveryScheduler(configuration)` into the `server.js` startup block
      (~line 665, beside the sibling schedulers)

**Checkpoint**: all DI-tick cases green; optional live smoke (set time 2 min out on a post-2nd-Tuesday day,
clear fired key, restart → fires once; second restart → does not)

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] Add the feature entry to `CHANGELOG.md` (`## [Unreleased]`, Keep-a-Changelog style — the single
      source of truth for the behavior change)
- [X] T029 [P] Update `CLAUDE.md` 018 block: status → implemented, and promote the engine-bundle standing
      constraint (changes to `workflowDelivery.ts`/`featureLink.ts` must keep `npm run
      build:monthly-delivery-engine` + server Jest green) to match the 015 precedent wording
- [X] T030 Full regression sweep: `npm test` (server Jest incl. new suites), `cd client && npx vitest run`,
      `npm run build:pi-review-engine`, `npm run test:dom`, `cd client && npx vite build` — all green; then
      execute the remaining quickstart regression guardrails (existing scheduler routes spot-check)
- [X] T031 Open the PR (`feature/monthly-delivery-report` → `main`) with the spec/plan links and the quickstart
      evidence summary; squash-merge per house branching strategy

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002 → T003; T004 anytime
- **Foundational (Phase 2)**: needs Phase 1 (T003's bundle). T005→T006 and T007→T008 are independent pairs;
  T009 independent. BLOCKS all stories
- **US1 (Phase 3)**: needs Phase 2 (T009 for persistence). T010/T011 parallel RED; T012 unblocks T017's route
  surface later; T013 → T014
- **US2 (Phase 4)**: needs US1's router file (T012) and panel file (T013) to extend, plus T006/T008. RED tasks
  T015–T018 all parallel; GREEN order T019 → T020 → T021 → T022 → T023 → T024
- **US3 (Phase 5)**: needs T008 (date helpers) + T022 (run function). T025 → T026 → T027
- **Polish (Phase 6)**: needs all stories; T028/T029 parallel; T030 before T031

### Parallel Opportunities

- Phase 2: `{T005+T006}` ∥ `{T007+T008}` ∥ `T009` — three independent files
- Phase 3 RED: T010 ∥ T011 (server test file vs client test file)
- Phase 4 RED: T015 ∥ T016* ∥ T017 ∥ T018 (*T015/T016 share a file — write together or sequence)
- Phase 6: T028 ∥ T029

## Implementation Strategy

**MVP = Phases 1–4** (US1 + US2): after T024 the user can snapshot teams, Run Now, and copy a real prompt —
full manual value even before scheduling exists. **STOP and VALIDATE** with quickstart scenarios 1–3 there.
Phase 5 then adds automation without touching US1/US2 surfaces (it reuses `runMonthlyDeliveryNow` verbatim).
Sequential single-developer order: T001 → … → T031. Commit per task or logical pair (`feat:`/`test:` prefixes);
every commit keeps the suite green.

## Notes

- Verify each RED task genuinely fails before its GREEN counterpart (Article V).
- All functions <40 lines, verb-first names, `is/has` booleans, named constants (Article IV) — the cited
  precedent files already model this.
- The `saveConfigToDisk` whitelist (T009) is the highest-risk silent failure — do not defer it.
