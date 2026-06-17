# Tasks: Sprint–Release Workflow Orchestrator

**Input**: `specs/003-sprint-release-workflow/`
**Plan**: `specs/003-sprint-release-workflow/plan.md`
**Spec**: `specs/003-sprint-release-workflow/spec.md`

## User Story Map

| Label | Spec Story | Title | Priority |
|-------|-----------|-------|----------|
| US1 | A + C + D | Dev Done transition + QE/BT handoff notification | P1 — MVP |
| US2 | B | Sprint–fixVersion date synchronisation | P2 |
| US3 | F | Defect intake via Jira label | P3 |
| US4 | E | Definition of Ready violations gate | P4 |
| US5 | G | Status API + observability (ownership integrity) | P5 |

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel (different files, no shared state dependencies)
- **[Story]**: User story this task belongs to
- TDD applies per Constitution Article V — test tasks precede each implementation block

---

## Phase 1: Setup

**Purpose**: Branch + empty module skeleton so `npm start` stays green throughout

- [ ] T001 Create branch `feature/003-sprint-release-workflow` from `main`
- [ ] T002 [P] Create empty file `src/services/sprintReleaseOrchestrator.js` with file-purpose comment and `module.exports = {}`
- [ ] T003 [P] Create empty file `src/services/sprintReleaseScheduler.js` with file-purpose comment and exported `startSprintReleaseScheduler` no-op
- [ ] T004 [P] Create empty file `src/routes/sprintRelease.js` with file-purpose comment and skeleton Express router (all routes return 501)
- [ ] T005 Require and mount `sprintRelease.js` router and call `startSprintReleaseScheduler` in `server.js`
- [ ] T006 Verify `npm start` succeeds and `GET /api/sprint-release/config` returns HTTP 501

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Config schema + CRUD API — every user story reads from this config

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Extend `buildDefaultConfig()` in `src/config/loader.js` to include `sprintRelease.teamProfiles` array with default single-profile shape from `data-model.md`
- [ ] T008 Extend `saveConfigToDisk()` in `src/config/loader.js` to persist the `sprintRelease` block
- [ ] T009 Write unit tests for config CRUD handlers in `test/unit/sprintReleaseConfig.test.js` — mock `makeJiraApiRequest`; cover valid save, invalid project key rejection, missing required field, invalid boardId rejection
- [ ] T010 Implement `GET /api/sprint-release/config` in `src/routes/sprintRelease.js` — returns the first team profile from config
- [ ] T011 Implement `POST /api/sprint-release/config` in `src/routes/sprintRelease.js` — validates all four Jira project keys via `makeJiraApiRequest GET /rest/api/2/project/{key}`, validates boardId via `GET /rest/agile/1.0/board/{boardId}`, saves on success, returns 400 with error message on first invalid key or invalid boardId

**Checkpoint**: `POST /api/sprint-release/config` with valid keys returns 200. Foundation ready.

---

## Phase 3: US1 — Dev Done Transition + QE/BT Handoff (Stories A, C, D) 🎯 MVP

**Goal**: When `customfield_10201` (sub-status) is set to the QE or BT trigger value on a dev issue, NodeToolbox transitions the issue to Done and posts a structured handoff Jira comment. Config-only issues (labelled `no-testing-required`) close without a handoff.

**Independent Test**: Run Quickstart Scenarios 1, 2, and 7 from `quickstart.md`

### Tests — write first, confirm failure before implementing

- [ ] T012 [P] [US1] Unit test `detectSubStatusChanges(issues, lastHandoffMap, profileConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — cases: QE sub-status in changelog → QE event returned; BT sub-status → BT event; already-seen issue → nothing returned; config-only label → bypass event (no handoff); no relevant changelog entry → nothing
- [ ] T013 [P] [US1] Unit test `buildHandoffComment(issueKey, handoffType, featureKey, featureSummary)` in `test/unit/sprintReleaseOrchestrator.test.js` — QE type produces "QE Handoff:" prefix with INT environment; BT type produces "BT Handoff:" with REL environment
- [ ] T014 [P] [US1] Unit test `executeDevIssueDone(issueKey, jiraConfig, profileConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — mocked transitions list: finds correct transition by name; calls POST transitions with matching ID; issue already Done → skipped; issue at terminal non-Done status → skipped with warning
- [ ] T014b [P] [US1] Write unit tests for poll cycle wiring in `test/unit/sprintReleaseScheduler.test.js` — cases: `setInterval` is called with `pollIntervalMinutes * 60000`; `detectSubStatusChanges` is invoked with the issues returned by the mocked JQL search; a Jira HTTP error in the poll does not throw or crash the process (error is logged, interval continues); `lastHandoffByIssue` Map is updated after a handoff event fires

### Implementation

- [ ] T015 [US1] Implement `detectSubStatusChanges(issues, lastHandoffMap, profileConfig)` as pure function in `src/services/sprintReleaseOrchestrator.js` — walks changelog entries for `customfield_10201` changes, checks against `qeHandoffSubStatusValue` and `btHandoffSubStatusValue`, respects `configOnlyLabel`, deduplicates via `lastHandoffMap`
- [ ] T016 [US1] Implement `buildHandoffComment(issueKey, handoffType, featureKey, featureSummary)` as pure function in `src/services/sprintReleaseOrchestrator.js` — returns comment body string with environment label, issue reference, and feature parent
- [ ] T017 [US1] Implement `executeDevIssueDone(issueKey, jiraConfig, profileConfig)` in `src/services/sprintReleaseOrchestrator.js` — calls `GET /rest/api/2/issue/{key}/transitions`, finds transition by `doneTransitionName`, calls `POST /rest/api/2/issue/{key}/transitions`; skips terminal-status issues; does NOT touch `assignee` field at any point
- [ ] T018 [US1] Implement `postHandoffComment(issueKey, handoffType, featureKey, featureSummary, jiraConfig)` in `src/services/sprintReleaseOrchestrator.js` — calls `makeJiraApiRequest POST /rest/api/2/issue/{key}/comment`; if `handoffDelivery.webhookUrl` is set, also calls `triggerWebhook`
- [ ] T019 [US1] Implement sub-status poll cycle in `startSprintReleaseScheduler(config)` in `src/services/sprintReleaseScheduler.js` — `setInterval` at `pollIntervalMinutes`; queries `GET /rest/api/2/search` with JQL `project={devProjectKey} AND updated>=-{N}m`, expands `changelog`, calls `detectSubStatusChanges`, then `executeDevIssueDone` + `postHandoffComment` for each event; tracks `lastHandoffByIssue` Map
- [ ] T020 [US1] Implement `POST /api/sprint-release/run-now` in `src/routes/sprintRelease.js` — triggers an immediate poll cycle outside the interval timer
- [ ] T021 [US1] Integration test — Quickstart Scenario 1 (QE handoff fires, issue transitions to Done, assignee unchanged) in `test/integration/sprintRelease.integration.test.js`
- [ ] T022 [US1] Integration test — Quickstart Scenario 2 (config-only label suppresses handoff, issue still goes Done) in `test/integration/sprintRelease.integration.test.js`

**Checkpoint**: US1 independently functional. Sprint burndown reflects Done at sub-status change, not QE completion.

---

## Phase 4: US2 — Sprint–FixVersion Date Synchronisation (Story B)

**Goal**: When a fixVersion's release date changes in Jira, the linked sprint's end date is updated to `releaseDate − freezeWindowBusinessDays` (skipping weekends).

**Independent Test**: Run Quickstart Scenario 4 from `quickstart.md`

### Tests — write first, confirm failure before implementing

- [ ] T023 [P] [US2] Unit test `calculateCodeFreezeDate(releaseDate, businessDays)` in `test/unit/sprintReleaseOrchestrator.test.js` — cases: 13 business days before a Monday (span crosses two weekends); 13 days before a Friday; window crossing a month boundary; businessDays = 1 on a Tuesday; result is always a weekday
- [ ] T024 [P] [US2] Unit test `detectFixVersionDateChange(versions, lastSeenDatesMap, profileConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — first run (empty map) → no events; same date on second run → no event; changed date → change event with old and new values
- [ ] T025 [P] [US2] Unit test `updateSprintEndDate(sprintId, newEndDate, jiraConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — mocked Agile API call; sprint state "closed" → warning returned, no update; sprint state "active" → POST issued with correct ISO date

### Implementation

- [ ] T026 [US2] Implement `calculateCodeFreezeDate(releaseDate, businessDays)` as pure function in `src/services/sprintReleaseOrchestrator.js` — walks backward from `releaseDate` decrementing counter only on weekdays (Mon–Fri); returns ISO date string
- [ ] T027 [US2] Implement `detectFixVersionDateChange(versions, lastSeenDatesMap, profileConfig)` as pure function in `src/services/sprintReleaseOrchestrator.js` — compares each fixVersion's `releaseDate` against `lastSeenDatesMap`; returns array of change events; updates map
- [ ] T028 [US2] Implement `findSprintByName(sprintName, boardId, jiraConfig)` in `src/services/sprintReleaseOrchestrator.js` — calls `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future`; finds sprint whose `name` matches `sprintName`; returns sprint object or null with warning
- [ ] T029 [US2] Implement `updateSprintEndDate(sprintId, newEndDate, jiraConfig)` in `src/services/sprintReleaseOrchestrator.js` — calls `POST /rest/agile/1.0/sprint/{id}` with `{ endDate: newEndDate }`; skips closed sprints with logged warning
- [ ] T030 [US2] Wire fixVersion date watch into scheduler poll cycle in `src/services/sprintReleaseScheduler.js` — queries `GET /rest/api/2/project/{featureProjectKey}/versions`; calls `detectFixVersionDateChange`; for each change event calls `findSprintByName` then `updateSprintEndDate`; initialises `lastSeenFixVersionDates` Map on first poll
- [ ] T031 [US2] Integration test — Quickstart Scenario 4 (fixVersion date change → sprint end date updated; sprint-already-closed warning case) in `test/integration/sprintRelease.integration.test.js`

**Checkpoint**: US2 independently functional. Sprint end date auto-adjusts within one poll cycle of fixVersion change.

---

## Phase 5: US3 — Defect Intake via Jira Label (Story F)

**Goal**: QE or BT applies label `defect-intake` to their Jira issue; NodeToolbox creates a linked ENFCT defect issue inheriting the original assignee; original stays Done; label is removed after processing.

**Independent Test**: Run Quickstart Scenario 6 from `quickstart.md`

### Tests — write first, confirm failure before implementing

- [ ] T032 [P] [US3] Unit test `detectDefectIntakeLabels(issues, processedSet, profileConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — issue with `defect-intake` label + link to dev issue → returned; already-processed issue (in processedSet) → skipped; issue missing dev issue link → skipped with warning
- [ ] T033 [P] [US3] Unit test `isSprintInFreezeWindow(sprintEndDate, currentDate)` in `test/unit/sprintReleaseOrchestrator.test.js` — current date after sprint end → true; current date before sprint end → false; same day as sprint end → true
- [ ] T034 [P] [US3] Unit test `createDefectIssue(originalDevIssue, triggerIssue, profileConfig, jiraConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — mocked POST; created issue has `[DEFECT]` prefix, inherits assignee, has `defect-from-testing` label; sprint-in-freeze → `TRIAGE REQUIRED` label added, sprint not assigned; sprint not in freeze → sprint ID set

### Implementation

- [ ] T035 [US3] Implement `detectDefectIntakeLabels(qeBtIssues, processedSet, profileConfig)` as pure function in `src/services/sprintReleaseOrchestrator.js` — filters issues with `defectIntakeLabel` present; checks `issueLinks` for link to dev project; skips keys already in `processedSet`
- [ ] T036 [US3] Implement `isSprintInFreezeWindow(sprintEndDate, currentDate)` as pure function in `src/services/sprintReleaseOrchestrator.js`
- [ ] T037 [US3] Implement `buildDefectIssueSummary(originalSummary)` as pure function in `src/services/sprintReleaseOrchestrator.js` — prepends `[DEFECT] ` to original summary
- [ ] T038 [US3] Implement `createDefectIssue(originalDevIssue, triggerIssue, profileConfig, jiraConfig)` in `src/services/sprintReleaseOrchestrator.js` — `POST /rest/api/2/issue` with correct type, summary, assignee, fixVersions, labels; `POST /rest/api/2/issueLink` twice (to original dev issue + to QE/BT trigger issue); adds sprint or triage label based on `isSprintInFreezeWindow`
- [ ] T039 [US3] Implement label removal after processing in `src/services/sprintReleaseOrchestrator.js` — `PUT /rest/api/2/issue/{triggerKey}` removing `defectIntakeLabel` from labels array; adds triggerKey to `processedDefectIntakeKeys` Set
- [ ] T040 [US3] Wire defect intake label scan into scheduler poll cycle in `src/services/sprintReleaseScheduler.js` — queries both `qeProjectKey` and `btProjectKey` issues updated recently; calls `detectDefectIntakeLabels`; for each result calls `createDefectIssue` then label-removal; initialises `processedDefectIntakeKeys` Set
- [ ] T041 [US3] Integration test — Quickstart Scenario 6 (label applied → new dev issue created, linked, label removed, original stays Done) in `test/integration/sprintRelease.integration.test.js`

**Checkpoint**: US3 independently functional. Defect from QE/BT triggers clean new dev issue without disturbing the original Done record.

---

## Phase 6: US4 — Definition of Ready Violations Gate (Story E)

**Goal**: Dev issues in the active sprint that are missing QE acceptance criteria or BT test scenario fields are flagged with a Jira comment and surfaced via the NodeToolbox API.

**Independent Test**: Run Quickstart Scenario 5 from `quickstart.md`

### Tests — write first, confirm failure before implementing

- [ ] T042 [P] [US4] Unit test `findDorViolations(sprintIssues, profileConfig)` in `test/unit/sprintReleaseOrchestrator.test.js` — issue with both fields populated → not in result; issue with one empty → in result with correct `missingFields`; `dorQeFieldId` empty string in config → field skipped (no false-positive); all issues clean → empty array

### Implementation

- [ ] T043 [US4] Implement `findDorViolations(sprintIssues, profileConfig)` as pure function in `src/services/sprintReleaseOrchestrator.js` — checks `dorQeFieldId` and `dorBtFieldId` are non-empty strings in config before validating; returns array of `{ issueKey, summary, assignee, missingFields }`
- [ ] T044 [US4] Implement `postDorViolationComment(issueKey, missingFields, jiraConfig)` in `src/services/sprintReleaseOrchestrator.js` — `POST /rest/api/2/issue/{key}/comment` with human-readable message listing missing fields
- [ ] T045 [US4] Implement `GET /api/sprint-release/dor-violations` in `src/routes/sprintRelease.js` — accepts optional `?sprintId` param; calls `GET /rest/agile/1.0/sprint/{id}/issue`; calls `findDorViolations`; returns response shape from `contracts/api-endpoints.md`
- [ ] T046 [US4] Wire DoR daily scan into scheduler poll cycle in `src/services/sprintReleaseScheduler.js` — fires once per day at start of poll cycle; queries active sprint issues; calls `findDorViolations` and `postDorViolationComment` for each violation
- [ ] T047 [US4] Integration test — Quickstart Scenario 5 (sprint issue with empty DoR field appears in violations; clean issue does not) in `test/integration/sprintRelease.integration.test.js`

**Checkpoint**: US4 independently functional. DoR violations are surfaced before sprint starts, not discovered in testing.

---

## Phase 7: US5 — Status API + Observability (Story G)

**Goal**: `GET /api/sprint-release/status` returns last-poll time, recent handoffs, recent defect intakes, sprint sync warnings, and current sprint state. Enables ownership integrity reporting.

**Independent Test**: Run Quickstart Scenarios 3 and 7 from `quickstart.md`

- [ ] T048 [US5] Implement in-memory `recentHandoffs` ring buffer (capped at 20 entries) in `src/services/sprintReleaseScheduler.js` — populated by each QE/BT handoff event
- [ ] T049 [US5] Implement in-memory `recentDefectIntakes` ring buffer (capped at 20 entries) in `src/services/sprintReleaseScheduler.js` — populated by each defect intake
- [ ] T050 [US5] Implement in-memory `sprintSyncWarnings` list in `src/services/sprintReleaseScheduler.js` — populated when sprint name not matched, sprint already closed, or computed end date in past
- [ ] T051 [US5] Implement `GET /api/sprint-release/status` in `src/routes/sprintRelease.js` — returns full runtime state shape from `contracts/api-endpoints.md` including last/next poll timestamps, `recentHandoffs`, `recentDefectIntakes`, `sprintSyncWarnings`, `activeSprintName`, `activeSprintEndDate`
- [ ] T052 [US5] Integration test — Quickstart Scenario 3 (BT handoff fires after sub-status "Ready for UAT") in `test/integration/sprintRelease.integration.test.js`
- [ ] T053 [US5] Integration test — Quickstart Scenario 7 (ownership integrity: assignee unchanged across all transitions) in `test/integration/sprintRelease.integration.test.js`

**Checkpoint**: All 7 quickstart scenarios can be run end-to-end.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T054 [P] Verify every function in `src/services/sprintReleaseOrchestrator.js` has a JSDoc comment explaining purpose, params, and return value (Constitution Article IV)
- [ ] T055 [P] Verify every function in `src/services/sprintReleaseScheduler.js` and `src/routes/sprintRelease.js` has a JSDoc comment (Constitution Article IV)
- [ ] T056 [P] Confirm no single-letter variable names, all booleans prefixed `is/has/can/should/was` across all new files (Constitution Article IV)
- [ ] T057 Run `npm test` — confirm all unit tests pass with no failures
- [ ] T058 Run all 7 Quickstart scenarios from `quickstart.md` against live corporate Jira instance and document outcomes (Constitution Article X — verification with evidence)
- [ ] T059 Update `CHANGELOG.md` under `## [Unreleased]` with feature summary and behaviour changes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **BLOCKS all user story phases**
- **US1 (Phase 3)**: Depends on Phase 2 — no dependency on US2/3/4/5
- **US2 (Phase 4)**: Depends on Phase 2 — no dependency on US1/3/4/5
- **US3 (Phase 5)**: Depends on Phase 2 — no dependency on US1/2/4/5
- **US4 (Phase 6)**: Depends on Phase 2 — no dependency on US1/2/3/5
- **US5 (Phase 7)**: Depends on US1 (reads `lastHandoffByIssue` + `recentHandoffs`) — should follow US1; can overlap US2/3/4
- **Polish (Phase 8)**: Depends on all user story phases complete

### Parallel Opportunities

Within Phase 2 (after T007+T008): T010 and T011 can run in parallel (once T009 tests are written and failing).
Within Phase 3 tests: T012, T013, T014, T014b in parallel.
Within Phase 4 tests: T023, T024, T025 in parallel.
Within Phase 5 tests: T032, T033, T034 in parallel.
Once Phase 2 is complete: Phases 3, 4, 5, 6 can proceed in parallel across team members.
Polish tasks T054, T055, T056 in parallel.

---

## Parallel Example: US1 (Phase 3)

```text
# Write all US1 tests together (they target different functions):
T012  — detectSubStatusChanges tests
T013  — buildHandoffComment tests
T014  — executeDevIssueDone tests
T014b — startSprintReleaseScheduler poll wiring tests

# Then implement in sequence (each builds on the previous):
T015 → T016 → T017 → T018 → T019 → T020 → T021 → T022
```

---

## Implementation Strategy

### MVP First (US1 Only — Phases 1–3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (config schema + CRUD)
3. Complete Phase 3: US1 (sub-status polling → Done transition + QE/BT handoff)
4. **STOP and VALIDATE**: Run Quickstart Scenarios 1, 2, and 7
5. Sprint burndown now reflects delivery at sub-status change — core pain point solved

### Incremental Delivery

1. Setup + Foundational → foundation ready (T001–T011)
2. US1 → test Scenarios 1, 2, 7 → deploy (MVP)
3. US2 → test Scenario 4 → deploy (sprint dates auto-sync)
4. US3 → test Scenario 6 → deploy (clean defect intake)
5. US4 → test Scenario 5 → deploy (DoR gate)
6. US5 → test Scenarios 3, 7 → deploy (full observability)

---

## Notes

- `[P]` = different files, no shared-state dependency — can run in parallel
- TDD is mandatory (Constitution Article V): test tasks are labelled RED — implement until GREEN, then refactor
- `makeJiraApiRequest` and `triggerWebhook` from `src/utils/httpClient.js` are mocked in ALL unit tests
- Integration tests require the live corporate Jira instance and a real `teamProfileId: "default"` config saved via `POST /api/sprint-release/config`
- Never set `assignee` field in any Jira write call from this feature
- Commit after each checkpoint; open PR only after T059 (CHANGELOG updated)
