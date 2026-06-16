---
description: "Task list for Rovo Expansion + Proactive Hygiene Monitor"
---

# Tasks: Rovo Expansion + Proactive Hygiene Monitor

**Input**: Design documents from `specs/002-rovo-expansion-hygiene-monitor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — the project constitution (Article V) mandates TDD, and quickstart.md defines validation scenarios. Pure helpers get failing unit tests before implementation.

**Organization**: Grouped by user story. US1 = Story A (scheduler enrichment), US2 = Story B (CHG wizard extension), US3 = Story C (proactive hygiene monitor).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (setup, foundational, and polish tasks carry no story label)

## Path Conventions

Web app: Express backend at `src/`, React SPA at `client/src/`. Server tests are co-located `*.test.js` (Jest); client tests are co-located `*.test.tsx`/`*.test.ts` (Vitest).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch and baseline before any code changes.

- [X] T001 Create and switch to feature branch `feature/rovo-expansion-hygiene-monitor` from `main` (speckit `002-` name does not satisfy the repo pre-commit branch rule)
- [X] T002 [P] Establish a green baseline: prior full suites in this session were green (`npx jest`, `vitest run 2234`) before changes
- [X] T003 [P] CHANGELOG `## [Unreleased]` entry added for the foundational + US1 slice

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared server-side Rovo dispatch helper used by both the scheduler enrichment (US1) and the hygiene classification (US3).

**⚠️ CRITICAL**: US1 and US3 both depend on T005; complete this phase before starting those stories.

- [X] T004 Write failing unit tests for the shared Rovo enrichment helper (generated correlationId, bounded poll, non-blocking `null` fallback on timeout/empty/error) in `src/services/rovoEnrichment.test.js` — 10 tests
- [X] T005 Implement `requestRovoText(configuration, prompt, options)` reusing `dispatchPrompt`/`fetchResult` — returns response text or `null`, never throws into callers — in `src/services/rovoEnrichment.js` (research R2/R3)

**Checkpoint**: Server-side Rovo dispatch is reusable and non-blocking. User stories can begin.

---

## Phase 3: User Story 1 — Scheduler enrichment (Priority: P1) 🎯 MVP

**Goal**: Standup briefings and scope/feature-change reports gain a Rovo-authored insight/trend block, added non-blockingly before the Confluence write.

**Independent Test**: Fire each scheduler with Rovo enabled → Confluence page shows the Rovo block above the tables; force Rovo offline → the page still publishes with no block and a logged skip (quickstart V1, V2).

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T006 [P] [US1] Test for the standup insight-block enrichment (`buildStandupRovoPrompt` + `buildRovoInsightPanel`) in `src/services/standupBriefingScheduler.test.js`
- [X] T007 [P] [US1] Tests for the scope/feature trend-paragraph builders in `src/services/scopeChangeScheduler.test.js` and `src/services/featureChangeScheduler.test.js`

### Implementation for User Story 1

- [X] T008 [US1] Add the insight-block enrichment step (build prompt from briefing data, call `requestRovoText`, prepend to the Confluence storage body when non-null, gated by `isRovoEnabled`) in `src/services/standupBriefingScheduler.js` (FR-001, SC-001) — also covers standup portion of T011
- [X] T009 [P] [US1] Add the trend-paragraph enrichment to `src/services/scopeChangeScheduler.js` `runTeamReportDelivery` (threaded `configuration` through both call sites) (FR-002, SC-002)
- [X] T010 [P] [US1] Add the trend-paragraph enrichment to `src/services/featureChangeScheduler.js` `runFeatureReportDelivery` (threaded `configuration` through both call sites) (FR-002, SC-002)
- [X] T011 [US1] Gate enrichment on `isRovoEnabled` and log `[Rovo] <surface> enrichment skipped (<reason>)` on fallback across the three schedulers (FR-003, SC-008)

**Checkpoint**: All three schedulers enrich the per-team report when Rovo is up and publish unchanged when it is down — independently demoable (MVP). Full server suite green (568 tests).

> FOLLOW-UP (small, deferred): the aggregate **ART-rollup** delivery variants — `runArtRollupDelivery` (scope) and `runFeatureChangeArtRollupDelivery` (feature) — were left un-enriched to keep this increment bounded. They follow the identical build-body→prepend pattern; enrich them when the per-team behaviour is validated.

---

## Phase 4: User Story 2 — CHG wizard extension (Priority: P2)

**Goal**: The CHG wizard gains a gated "Draft with Rovo" (Step 3) and "Risk check with Rovo" (Step 6), both optional accelerators that reuse the existing client dispatch/poll hook.

**Independent Test**: With the gate locked, neither action is visible; unlocked, Step 3 populates Short/Long description from Jira content (editable) and Step 6 shows an inline risk list; re-locking hides both without reload (quickstart V3, V4).

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T012 [P] [US2] Failing test for "Draft with Rovo" — hidden when locked, populates Short + Description when unlocked, remains editable, wizard proceeds without it — in `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx`
- [X] T013 [P] [US2] Failing test for "Risk check with Rovo" — hidden when locked, renders the returned gap list inline at Step 6, submission still allowed — in `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx`

### Implementation for User Story 2

- [X] T014 [US2] Add the gated "Draft with Rovo" action to Step 3 (dispatch+poll via `useRovoExchange`, write results into the Short Description / Description fields), bounded to ≤60s or a graceful skip, in `client/src/views/SnowHub/tabs/CreateChgTab.tsx` (FR-004, FR-006, FR-006a, SC-003)
- [X] T015 [US2] Add the gated "Risk check with Rovo" action to Step 6 (submit completed CHG payload, render parsed gaps/risks inline before submit), bounded to ≤60s or a graceful skip, in `client/src/views/SnowHub/tabs/CreateChgTab.tsx` (FR-005, FR-006a, SC-003)
- [X] T016 [US2] Read the shared `rovoStore` unlock for both actions so they appear/disappear with the passphrase gate without a reload in `client/src/views/SnowHub/tabs/CreateChgTab.tsx` (FR-015, SC-007)

**Checkpoint**: US1 and US2 both work independently; CHG authors get optional Rovo assistance.

---

## Phase 5: User Story 3 — Proactive hygiene monitor (Priority: P3)

**Goal**: A daily server-side scheduler scans Jira hygiene, has Rovo classify violations, auto-fixes FIXABLE items via the Jira proxy, comments on UNFIXABLE items, and emails a digest with a trend (via the existing webhook→Automation→email path; an inbox rule forwards it to Teams) — all gated and Admin-Hub-configured.

**Independent Test**: Configure a team, seed one fixable and one unfixable violation, click "Scan Now" → the fixable field updates in Jira, the unfixable issue gets exactly one comment, and a digest email is sent (reaching Teams via the inbox rule) with a trend on the second scan (quickstart V5–V9).

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T017 [P] [US3] Failing unit tests asserting `src/services/hygieneRules.js` flags the same violations as the client checks for representative issues in `src/services/hygieneRules.test.js` (FR-008, research R1)
- [X] T018 [P] [US3] Failing unit tests for `parseRovoClassifications(text)` (FIXABLE/UNFIXABLE, VALUE/GUIDANCE, malformed→skip) per `contracts/rovo-classification.md` in `src/services/hygieneMonitorScheduler.test.js`
- [X] T019 [P] [US3] Failing unit tests for `buildHygieneDigest(scan, priorScan)` (counts, `trend` up/down/flat/n‑a, `unassignedCount`, `failures`) in `src/services/hygieneMonitorScheduler.test.js` (FR-012, SC-009)
- [X] T020 [P] [US3] Failing route tests for GET/POST `/api/hygiene-monitor/config`, POST `/scan`, GET `/status` (secret never echoed, validation) in `src/routes/hygieneMonitor.test.js` (contract)

### Implementation for User Story 3 — shared rules & pure helpers

- [X] T021 [US3] Extract the pure hygiene check functions into dependency-free `src/services/hygieneRules.js` and re-point `client/src/views/Hygiene/checks/hygieneChecks.ts` to the shared source (no behaviour change) (FR-008, research R1)
- [X] T022 [US3] Implement `parseRovoClassifications(text)` in `src/services/hygieneMonitorScheduler.js` (contract `rovo-classification.md`)
- [X] T023 [US3] Implement `buildHygieneDigest(scan, priorScan)` pure function in `src/services/hygieneMonitorScheduler.js` (FR-012, SC-009)
- [X] T024 [US3] Add `hygieneMonitor` config + bounded `hygieneScanHistory` sections (persist; base64-obfuscate the Teams secret; never log it) in `src/config/loader.js` (research R8, FR-014)

### Implementation for User Story 3 — scan engine & side effects

- [X] T025 [US3] Implement the per-team scan: query open issues for `projectKeys` via the Jira proxy, evaluate with `hygieneRules`, batch violations, and dispatch the classification prompt via `requestRovoText` in `src/services/hygieneMonitorScheduler.js` (FR-008, FR-009)
- [X] T026 [US3] Apply FIXABLE fixes via the Jira proxy, treating a violation resolved only on a 2xx; on a rejected field update, re-classify as UNFIXABLE for this run, in `src/services/hygieneMonitorScheduler.js` (FR-010, SC-005, edge case)
- [X] T027 [US3] Post one Jira comment per UNFIXABLE violation using a per-cycle `(issueKey,checkId)` dedup set; address assignee → reporter → none; attribute to the hygiene monitor, in `src/services/hygieneMonitorScheduler.js` (FR-011, FR-016, SC-006, edge cases)
- [X] T028 [US3] Deliver the digest **by email** — fire a trigger webhook (`digestTriggerUrl`/`digestTriggerSecret`, digest as payload) to an Atlassian Automation rule that emails it, via the existing `reportWebhookDelivery`/`triggerWebhook` path; skip silently when unconfigured; append a `hygieneScanHistory` entry, in `src/services/hygieneMonitorScheduler.js` (FR-012, SC-004)
- [X] ~~T029~~ **REMOVED** [US3] No allow-list exception needed — the digest destination is an Atlassian Automation webhook already covered by the existing allow-list (research R4, clarified 2026-06-16). Left as a no-op for task-numbering stability.
- [X] T030 [US3] Register the daily scheduler (60s tick, schedule-time + weekday guard, already-ran-today flag; "Scan Now" bypasses the daily guard) and wire boot in `src/services/hygieneMonitorScheduler.js` and `server.js` (FR-007, research R5)

### Implementation for User Story 3 — API & UI

- [X] T031 [US3] Implement GET/POST `/api/hygiene-monitor/config`, POST `/api/hygiene-monitor/scan`, GET `/api/hygiene-monitor/status` in `src/routes/hygieneMonitor.js` and mount in `server.js` (contract, FR-013/FR-014)
- [X] T032 [P] [US3] Build the Admin Hub config panel (per-team project keys, schedule time, weekdays, Teams webhook, field mappings, enabled checks) with tests in `client/src/views/AdminHub/HygieneMonitorPanel.tsx` (+ `.test.tsx`) (FR-014)
- [X] T033 [P] [US3] Build the gated Hygiene Monitor panel (last/next scan, per-team violation count + trend, "Scan Now") with tests in `client/src/views/Hygiene/components/HygieneMonitorPanel.tsx` (+ `.test.tsx`) and mount it in `client/src/views/Hygiene/HygieneView.tsx` (FR-013, SC-009)
- [X] T034 [US3] Gate both new panels behind the shared `rovoStore` unlock so they hide on re-lock without reload in `HygieneView.tsx` and the Admin Hub view (FR-015, SC-007)

**Checkpoint**: All three user stories function independently; the hygiene monitor runs daily and on demand.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T035 [P] Update `CHANGELOG.md` with the user-visible additions (Article VI)
- [ ] T036 Run the full quickstart.md validation V1–V9 and record evidence (Article X)
- [X] T037 Run full suites (`npx jest`; `cd client && npx vitest run`) and `npm run build:client`; fix any regressions — 242 server tests pass, 2259 client tests pass, build clean
- [ ] T038 Verify SC-007 (gate locked → zero Rovo affordances reachable) and SC-008 (Rovo forced offline → 100% of briefings/reports still publish)

### Reconciliation — `teamsWebhook*` → `digestTrigger*` field rename (spec compliance)

> These tasks resolve the C2 finding from `/speckit-analyze`: the data model specifies
> `digestTriggerUrl`/`digestTriggerSecret`/`digestEmailTo` but the initial implementation
> used `teamsWebhook*` field names. All four were renamed across server, config, routes,
> tests, and Admin Hub UI on branch `feature/rovo-hygiene-email-reconcile`.

- [X] T039 Rename `teamsWebhookUrl` → `digestTriggerUrl`, `teamsWebhookSecret` → `digestTriggerSecret` in server-side config encode/decode functions in `src/config/loader.js`
- [X] T040 Update `scrubTeamSecret()` in `src/routes/hygieneMonitor.js` to destructure `digestTriggerSecret` (prevents secret leakage in API responses); update route tests to use Atlassian Automation webhook URLs and correct field names in `src/routes/hygieneMonitor.test.js`
- [X] T041 [P] Update `HygieneTeamConfig` interface, `buildDefaultTeamConfig`, form labels, and field references in `client/src/views/AdminHub/HygieneMonitorPanel.tsx` (+ `.test.tsx`) to use `digestTriggerUrl`/`digestTriggerSecret`/`digestEmailTo`
- [X] T042 [P] Update spec.md (acceptance scenario 9, Key Entities, and Assumptions section) and CHANGELOG.md to correctly describe Atlassian Automation trigger webhook (email) delivery — not a direct Teams webhook

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. **Blocks US1 and US3** (both use `requestRovoText`). US2 (client-only, reuses `useRovoExchange`) does not depend on T005 and may start right after Setup.
- **User Stories (Phase 3–5)**: depend on Foundational (US1, US3) / Setup (US2). Independently testable.
- **Polish (Phase 6)**: depends on the stories you intend to ship.

### User Story Dependencies

- **US1 (P1)**: needs T005. Independent of US2/US3.
- **US2 (P2)**: needs only Setup. Independent of US1/US3.
- **US3 (P3)**: needs T005. Largest story; internally ordered: shared rules + pure helpers (T021–T024) → scan engine + side effects (T025–T030) → API + UI (T031–T034).

### Within Each User Story

- Failing tests precede implementation (TDD).
- Pure helpers (rules, parser, digest) before the scan engine that composes them.
- Scan engine before routes/UI that trigger and display it.

### Parallel Opportunities

- Setup: T002, T003 in parallel.
- US1: T009 and T010 in parallel (different scheduler files) after T008's pattern is set; tests T006/T007 in parallel.
- US3 tests T017–T020 in parallel; UI panels T032/T033 in parallel (different files).
- With capacity, US2 can proceed in parallel with US1 once Setup is done.

---

## Parallel Example: User Story 3 (failing tests first)

```bash
Task: "Hygiene rule parity tests in src/services/hygieneRules.test.js"            # T017
Task: "parseRovoClassifications tests in src/services/hygieneMonitorScheduler.test.js"  # T018
Task: "buildHygieneDigest tests in src/services/hygieneMonitorScheduler.test.js"  # T019
Task: "Hygiene monitor route tests in src/routes/hygieneMonitor.test.js"          # T020
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (T004–T005) → 3. Phase 3 US1 → **STOP & VALIDATE** (quickstart V1–V2) → demo. Scheduler enrichment is a low-risk, high-visibility first increment that exercises the shared Rovo helper US3 will reuse.

### Incremental Delivery

1. Setup + Foundational → ready.
2. US1 → validate (V1–V2) → release.
3. US2 → validate (V3–V4) → release.
4. US3 → validate (V5–V9) → release (the headline capability).

### Parallel Team Strategy

After Foundational: Dev A → US1; Dev B → US2 (no T005 dependency); Dev C → US3 starting with the pure helpers (T017–T024). Stories integrate independently.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- Rovo never reads/writes Jira; Toolbox owns all Jira mutations (US3).
- Every Rovo affordance is gated by the Ctrl+Alt+Z passphrase (`rovoStore`); verify SC-007 per story.
- Enrichment and digest delivery are non-blocking; a Rovo/Teams outage never fails a scheduler run (SC-008).
- Commit per task or logical group on the feature branch; CHANGELOG updated as behaviour lands.
