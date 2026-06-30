---
description: "Task list for My Issues — Today Scrum Master Dashboard"
---

# Tasks: My Issues — "Today" Scrum Master Dashboard

**Input**: Design documents from `/specs/004-my-issues-today-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — Constitution Article V mandates TDD (red → green → refactor). Each
story writes failing tests before implementation.

**Organization**: Grouped by user story. US1 is the MVP (the checklist itself); US2 layers
daily check-off discipline; US3 adds the informational snapshot.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish have no story label)
- Exact file paths are included in every task.

## Path Conventions

- Client (React/TS): `client/src/...`
- Server (Express/JS): `src/...`, `server.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the feature folder and confirm the existing test runners are usable.

- [X] T001 [P] Create the feature folder tree `client/src/views/MyIssues/Today/` and `client/src/views/MyIssues/Today/hooks/` (per plan.md Project Structure)
- [X] T002 [P] Confirm test commands run clean before changes: `cd client && npm run test` (vitest) and `npm test` (server Jest) — baseline green

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make My Issues sub-tabs addressable and add the empty `Today` landing tab. ALL
user stories render inside this tab, so it blocks them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Export the `MY_ISSUES_JQL` constant (no behaviour change) from `client/src/views/MyIssues/hooks/useMyIssuesState.ts` so the dashboard can reuse the self-assigned query
- [X] T004 [P] Write failing component tests in `client/src/views/MyIssues/MyIssuesView.test.tsx`: (a) default active tab is `today`; (b) `/my-issues?tab=mentions` activates the Mentions sub-tab; (c) unknown/absent `?tab=` falls back to `today`
- [X] T005 [P] Create placeholder `client/src/views/MyIssues/Today/TodayDashboard.tsx` and `TodayDashboard.module.css` (renders a stub container)
- [X] T006 Add `'today'` as the first entry in `MyIssuesTab`/`MY_ISSUES_TABS`, default `activeTab` to `today`, and read/sync `?tab=` via `react-router-dom` `useSearchParams` in `client/src/views/MyIssues/MyIssuesView.tsx`; render `TodayDashboard` for the `today` tab (makes T004 pass) — depends on T005

**Checkpoint**: My Issues opens on an empty Today tab; sub-tabs are deep-linkable.

---

## Phase 3: User Story 1 — See my outstanding daily duties at a glance (Priority: P1) 🎯 MVP

**Goal**: The Today tab shows one card per daily duty with a deterministic live count and a
one-click deep link, each card loading independently, with connection-required and
team-not-configured states. No AI dependency, no Jira mutation.

**Independent Test**: With Jira connected and a sprint/board selected, open My Issues → Today;
every category shows a count matching its linked surface (Mentions tab / Hygiene tab /
self-assigned issues); clicking a card lands on the right destination in one click; a failing
source isolates to its own card (quickstart S1–S6, S9–S12).

### Tests for User Story 1 (write first, ensure they FAIL)

- [X] T007 [P] [US1] Unit tests for every count rule in `client/src/views/MyIssues/Today/todayCategories.test.ts`: mentions count; `selectBlockers` union/dedupe; `selectMyStale`; `bucketTeamHygiene` buckets (stale / unassigned incl. the no-assignee case / commitment-gaps = missing-sp∪no-ac / team due-overdue bucket); `selectDueOverdue` unions my∪team overdue (F3) and dedupes by key; `selectUntriaged` counts the passed-in DSU "new" set; multi-category membership; zero-count
- [X] T008 [P] [US1] Unit tests for the orchestration hook in `client/src/views/MyIssues/Today/hooks/useTodayDashboard.test.ts`: per-card independent status; one source error isolates; reused store data not re-fetched; team `not-configured` when no board/sprint
- [X] T009 [P] [US1] Component tests in `client/src/views/MyIssues/Today/TodayDashboard.test.tsx` and `client/src/views/MyIssues/Today/CategoryCard.test.tsx`: loading→ready; zero-count renders cleared; error shows retry without blanking siblings; connection-required state; deep links target correct destinations

### Implementation for User Story 1

- [X] T010 [US1] Implement the pure category catalog + count derivations in `client/src/views/MyIssues/Today/todayCategories.ts` — `CATEGORY_CATALOG`, `countMentions`, `selectBlockers`, `selectMyStale`, `bucketTeamHygiene` (single `evaluateHygieneIssue()` pass over the **team** set bucketed by checkId → stale/unassigned/commitment-gaps, all sprint-scoped), `selectDueOverdue(myIssues, teamIssues)` (F3: union by key of `checkDueDateOverdue`∪`checkTargetEndOverdue` across **my ∪ team** — "act-today" scope, mirrors `selectBlockers`), `selectUntriaged(untriagedIssues)` (counts the DSU "new" set passed in — reuse/extract the DSU new-section rule per research.md; NOT derived from the sprint/board set), `isDoneForToday`; reuse `hygieneChecks.ts` and `ATTENTION_STATUSES`/`isAttentionIssue` — NO new rule (makes T007 pass)
- [X] T011 [US1] Implement `client/src/views/MyIssues/Today/hooks/useTodayDashboard.ts`: mentions via `useMentionsState`; my issues via `MY_ISSUES_JQL` `jiraGet` (own loading/error); team issues via `useSprintData` (`sprintIssues` + `boardId`/`sprintInfo` → `isTeamConfigured`); **untriaged "new" issues via the existing DSU new-section query (`useDsuBoardState` / its JQL) as its own independently-loading source** (FR-004h); read stale threshold + roster from existing stores; return per-category `{ count, status, issues?, destination }` (makes T008 pass) — depends on T010
- [X] T012 [P] [US1] Implement `client/src/views/MyIssues/Today/CategoryCard.tsx` + `CategoryCard.module.css`: count, per-card loading/error/retry, cleared styling, not-configured state, and the deep-link control
- [X] T013 [US1] Implement the `Destination` deep-link resolver used by the card: `?tab=` for My Issues sub-tabs; set `settingsStore.sprintDashboardActiveTab` then navigate `/sprint-dashboard` for Sprint Dashboard tabs; `/dsu-board`; existing Jira browse/issue-navigator URL builders — in `client/src/views/MyIssues/Today/CategoryCard.tsx` (or a small `destination.ts` helper) — depends on T012
- [X] T014 [US1] Compose `client/src/views/MyIssues/Today/TodayDashboard.tsx`: render cards in catalog/priority order; connection-required state (FR-013); Refresh control + refresh-on-tab-return (no polling) (makes T009 pass) — depends on T011, T012, T013

**Checkpoint**: MVP — the Today checklist is fully functional and deep-links correctly,
deterministically, with no AI. Demo-ready.

---

## Phase 4: User Story 2 — Daily check-off & "done for today" (Priority: P2)

**Goal**: The Scrum Master can mark items complete; zero-count items auto-complete; manual
completion persists per business day (server-backed, per user) and resets each business day;
when all are complete the dashboard says "done for today".

**Independent Test**: Mark a non-zero category complete; reload (same day) → still complete;
GET for a different `day` → empty (reset); clear a category to zero → auto-complete; complete
all → "done for today" confirmation (quickstart S6–S8).

### Tests for User Story 2 (write first, ensure they FAIL)

- [X] T015 [P] [US2] Server unit tests in `src/services/dailyChecklistStore.test.js`: get unknown user/day → empty; set+get same day → present; get different day → empty (reset); old-day buckets pruned on write; corrupt/missing file tolerated
- [X] T016 [P] [US2] Server route tests in `src/routes/checklistState.test.js`: `GET` 400 without `user`/`day`; `POST` 400 on missing/invalid fields; `POST` complete then `GET` returns it; `POST` isComplete=false removes it
- [X] T017 [P] [US2] Client tests in `client/src/services/checklistStateApi.test.ts`: GET/POST shape mapping and error handling
- [X] T018 [P] [US2] Hook tests in `client/src/views/MyIssues/Today/hooks/useChecklistCompletion.test.ts`: business-day key derivation incl. **weekend rollback** (Sat/Sun → preceding Friday); auto-complete on zero merged with manual; toggle persists; user resolution
- [X] T018a [P] [US2] Unit tests in `client/src/utils/businessDays.test.ts` for the new `mostRecentBusinessDayKey(now)`: weekday → today; Saturday → preceding Friday; Sunday → preceding Friday

### Implementation for User Story 2

- [X] T019 [P] [US2] Implement `src/services/dailyChecklistStore.js` mirroring `mentionStateStore.js`: `sm-checklist-state.json` in `CONFIG_DIR_PATH`; `getDailyChecklist(userKey, dayKey)`, `setCategoryComplete({userKey, dayKey, categoryId, isComplete})`; prune older day buckets on write; corrupt-tolerant (makes T015 pass)
- [X] T020 [US2] Implement `src/routes/checklistState.js` mirroring `mentionState.js`: `GET/POST /api/sm-checklist-state` per `contracts/checklist-state-api.md` (makes T016 pass) — depends on T019
- [X] T021 [US2] Mount `createChecklistStateRouter()` in `server.js` next to the mention-state router
- [X] T022 [P] [US2] Implement `client/src/services/checklistStateApi.ts` (fetch wrapper for GET/POST, mirroring `mentionStateApi.ts`) (makes T017 pass)
- [X] T023 [US2] Add pure helper `mostRecentBusinessDayKey(now)` to `client/src/utils/businessDays.ts` (reuse `isWeekend`; weekday → today, Sat/Sun → preceding Friday; return `YYYY-MM-DD`). Then implement `client/src/views/MyIssues/Today/hooks/useChecklistCompletion.ts`: resolve user like Mentions; compute the business-day key via `mostRecentBusinessDayKey(now)` (NOT `businessDaysAgo(0,…)`); load that day's map; `toggle(categoryId)`; merge auto-complete-on-zero with manual completion (makes T018 + T018a pass) — depends on T022
- [X] T024 [US2] Wire check-off control + auto-complete-on-zero + "done for today" confirmation into `client/src/views/MyIssues/Today/CategoryCard.tsx` and `TodayDashboard.tsx` — depends on T023, and on US1 (T014)

**Checkpoint**: Daily discipline works end-to-end with automatic reset; US1 still works.

---

## Phase 5: User Story 3 — Sprint-flow snapshot (Priority: P3)

**Goal**: An informational-only panel showing WIP distribution by status zone and sprint days
remaining, linking to the Sprint Dashboard. Never a check-off item; no WIP-pileup alert.

**Independent Test**: With a sprint selected, the snapshot shows WIP-by-zone counts and days
remaining and links to the Sprint Dashboard; it has no checkbox and does not affect
"done for today".

### Tests for User Story 3 (write first, ensure they FAIL)

- [X] T025 [P] [US3] Component tests in `client/src/views/MyIssues/Today/SprintFlowSnapshot.test.tsx`: renders WIP-by-zone + days remaining; null sprint → graceful; no check-off control present

### Implementation for User Story 3

- [X] T026 [US3] Implement `client/src/views/MyIssues/Today/SprintFlowSnapshot.tsx` (+ CSS): WIP by status zone over the team issue set + `sprintDaysRemaining` from `useSprintData`; informational only (makes T025 pass)
- [X] T027 [US3] Integrate `SprintFlowSnapshot` into `client/src/views/MyIssues/Today/TodayDashboard.tsx` as a non-check-off panel — depends on T026 and T014

**Checkpoint**: All stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] Add a `## [Unreleased] → ### Added` entry for the Today dashboard in `CHANGELOG.md`
- [X] T029 [P] Accessibility pass on `CategoryCard.tsx`/`TodayDashboard.tsx` (keyboard activation + ARIA), matching existing card/tab patterns
- [ ] T030 Run `specs/004-my-issues-today-dashboard/quickstart.md` scenarios S1–S12 against live Jira; fix any gaps
- [X] T031 Confirm green gate: `cd client && npm run test`, `npm test` (server), and `cd client && npm run build` (tsc + vite) all clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: after Setup; BLOCKS all stories (the tab + deep-linking host every story).
- **US1 (P3)**: after Foundational. MVP.
- **US2 (P4)**: after Foundational; backend tasks (T015–T022) are independent of US1, but the
  UI wiring T024 depends on US1's cards (T014).
- **US3 (P5)**: after Foundational; T027 depends on US1's dashboard (T014).
- **Polish (P6)**: after the desired stories are complete.

### Within Each User Story

- Tests first and FAILING before implementation (Constitution Article V).
- Pure rules (`todayCategories.ts`) → orchestration hook → components → composition.
- Server store → route → mount; client api → hook → UI wiring.

### Parallel Opportunities

- Setup: T001, T002 in parallel.
- Foundational: T004 and T005 in parallel; T006 after T005.
- US1 tests T007/T008/T009 in parallel; T012 parallel with T010/T011 (different files).
- US2 tests T015/T016/T017/T018 in parallel; T019 and T022 in parallel (server vs client).
- US3 has a single test + two impl tasks.

---

## Parallel Example: User Story 1 tests

```bash
# Launch US1 failing tests together (different files):
Task: "Unit tests for count rules in client/src/views/MyIssues/Today/todayCategories.test.ts"
Task: "Unit tests for hook in client/src/views/MyIssues/Today/hooks/useTodayDashboard.test.ts"
Task: "Component tests in client/src/views/MyIssues/Today/TodayDashboard.test.tsx + CategoryCard.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & VALIDATE** the
   checklist + deep links against live Jira → demo. This is the usable dashboard.

### Incremental Delivery

1. Setup + Foundational → tab is live.
2. US1 → the deterministic checklist with deep links (MVP) → demo.
3. US2 → daily check-off + reset + "done for today" → demo.
4. US3 → sprint-flow snapshot → demo.

### Parallel Team Strategy

After Foundational: one developer can take US2's server/store stack (T015–T022) while another
builds US1's UI (T007–T014); integrate US2's UI wiring (T024) once US1 cards land.

---

## Notes

- [P] = different files, no incomplete-task dependency.
- Determinism is a hard gate: no task introduces an AI Assist / Ctrl+Alt+Z dependency, and
  no task writes Jira from the dashboard (only daily completion state is written).
- No new npm dependency is added by any task.
- Commit after each task or logical group; verify tests fail before implementing.
