# Implementation Plan: My Issues — "Today" Scrum Master Dashboard

**Branch**: `forge/wt-tab-10-4lj37wsic` (feature work for `004-my-issues-today-dashboard`)
**Date**: 2026-06-30
**Spec**: `specs/004-my-issues-today-dashboard/spec.md`

## Summary

Add a **"Today" dashboard as the default landing tab of the My Issues view**: a
deterministic, at-a-glance daily checklist that answers "as a Scrum Master, what do I
need to do today to keep Jira clean and work moving?" It is a **read-side mashup** — every
count is computed from data the product already fetches, using rules the product already
implements (the Mentions scan, the Hygiene checks, the self-assigned issue query, and the
Sprint Dashboard sprint/board scope). It introduces **no new hygiene/categorization rule**
and has **no AI Assist dependency**.

Technical approach: a new `Today` tab in `MyIssuesView` renders one self-contained
**category card** per daily duty. Each card loads independently (per-card fetch/error
isolation, reusing already-loaded tab data where present) and shows a live count plus a
one-click deep link to the surface where the work is done. The **team-wide categories**
(blockers, team-stale, unassigned, commitment-gaps, due/overdue) are produced by running
the existing `evaluateHygieneIssue()` pass once over the **active sprint/board issue set**
(reused from `useSprintData`) and bucketing by check id — so all assignees, including
unassigned, are covered. **My** categories run the existing `assignee = currentUser()`
query. **Mentions** reuse `useMentionsState`. A small new server store
(`dailyChecklistStore.js`, mirroring the existing `mentionStateStore.js`) persists the
per-user daily check-off state with an automatic business-day reset. Deep-linking to a
specific My Issues sub-tab — which does not exist today — is added via a `?tab=` URL param
read in `MyIssuesView`.

## Technical Context

**Language/Version**: TypeScript ~6.0 (client, React 19); Node.js / JavaScript (server, no TS)
**Primary Dependencies**: React 19, `react-router-dom` 7 (`useSearchParams` for sub-tab
  deep-linking), Zustand 5 (existing stores), Express (server). **No new dependencies.**
**Storage**: New `sm-checklist-state.json` in the AppData config dir (same folder and
  exact pattern as `mention-state.json`); existing team/board selection stays in the
  Zustand `settingsStore` (localStorage). No database (project has none).
**Testing**: Vitest 4 + `@testing-library/react` (client unit/component); Jest (server
  store + route). TDD: failing test first.
**Target Platform**: NodeToolbox desktop app (Vite client + Express server on Windows)
**Project Type**: Web app — React client (`client/`) + Express server (`src/`, `server.js`)
**Performance Goals**: Dashboard is usable within 1 render after mount; each card resolves
  independently so a fast count (e.g. my-stale) never waits on a slow one (mentions
  comment-scan). Comprehension target SC-001: ≤ 30s to read the day's duties.
**Constraints**: Fully deterministic — **no AI Assist / Ctrl+Alt+Z gate** anywhere in the
  feature. No new hygiene/categorization rule (FR-003). All Jira calls through the
  existing `/jira-proxy` (`jiraGet`). One source's failure must not blank the dashboard.
**Scale/Scope**: Personal single-Scrum-Master view; one active sprint/board (dozens–low
  hundreds of issues); 8 checklist categories + 1 informational snapshot.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Requirement | Status |
|---------|-------------|--------|
| III — Branching | Feature work on a feature branch; PR to `main`; no direct commits | ✅ Already on a non-`main` worktree branch |
| IV — Code Quality | Self-documenting names; verb-first functions; `is/has/can/should/was` booleans; functions < 40 lines; no magic numbers; file purpose + exported-fn doc comments | ✅ Enforced during implementation |
| V — Testing | TDD red→green→refactor; unit tests mock all I/O (<10ms); component tests via Testing Library | ✅ Pure category functions + store + route are unit-first (integration justification below) |
| VI — Documentation | `CHANGELOG.md` updated in the PR; no auxiliary status docs | ✅ CHANGELOG entry at PR time; only `specs/004-*` artifacts added |
| VII — Framework-First | Confirm the stack/codebase doesn't already provide it before building | ✅ See gate below + research.md |
| VIII — Release | `scripts/local-release.ps1` only; never GitHub Actions | ✅ No release changes in this feature |
| IX — Vault Zero-Knowledge | No secrets in code/logs | ✅ No new secrets; Jira PAT path unchanged |
| X — Verification & Proof | Behaviour proven with evidence | ✅ quickstart.md scenarios + green test suites are the proof gate |
| XI — Output Restraint | ≤ 1 dashboard artifact; no phase narration; no unsolicited summaries | ✅ The "Today" tab is in-app product UI, not a generated dashboard file; no new `.html` |

### Testing layer justification (Article V)

This feature adds **no new infrastructure or I/O path** — it is a read-side mashup over the
existing Jira proxy and the proven mention-state persistence pattern (which already has its own
integration coverage). Its risk lives in (a) the deterministic count rules and (b) the
per-card composition, both fully covered by fast unit + Testing-Library component tests with
mocked I/O. The new server store/route are unit-tested against a temp file. End-to-end
behaviour against real Jira is therefore validated by the **manual quickstart (T030, 12
scenarios)** rather than a new automated integration suite, consistent with the constitution's
intent (no genuinely new integration surface to stand up). If the dashboard later grows a
server-side data path, an automated integration test should be added at that point.

### Framework-First gate (Article VII)

- **No `FRAMEWORK-CAPABILITIES.md` ledger exists** (repo root or `client/`). ⚠️ Flagged per
  the framework-first skill: this feature does not add one, but its absence is noted so a
  future ledger can capture the in-use frameworks (React, react-router, Zustand, Express).
- **Sub-tab deep-linking** → use `react-router-dom`'s `useSearchParams` (framework-native);
  do **not** build a custom nav store. Confirmed `react-router-dom` 7 is already a dep.
- **Per-user daily state persistence** → reuse the existing `mentionStateStore.js` +
  `createMentionStateRouter` pattern (AppData JSON, per-user namespacing, corrupt-file
  tolerance). New store/route mirror it exactly; no new persistence mechanism.
- **Category computation** → reuse existing pure rules: `evaluateHygieneIssue()` /
  `checkStaleIssue` / `checkNoAssignee` / `checkMissingStoryPoints` /
  `checkNoAcceptanceCriteria` / `checkDueDateOverdue` / `checkTargetEndOverdue`
  (`hygieneChecks.ts`), `ATTENTION_STATUSES`/`isAttentionIssue` (My Issues), the
  `useMentionsState` scan, and `MY_ISSUES_JQL`. **No new rule is written.**
- **Team issue set** → reuse `useSprintData` (already restores the saved board/sprint and
  exposes `sprintIssues`, loading/error, and configured-state signals). Avoids duplicating
  the Agile API fetch. Justified drift: the dashboard consumes only `sprintIssues` +
  status flags; it never drives the standup timer.

No Constitution violations. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/004-my-issues-today-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions, source→category mapping, framework-first
├── data-model.md        # Phase 1 — category catalog, completion-state shape, scope model
├── quickstart.md        # Phase 1 — end-to-end validation scenarios
├── contracts/
│   ├── checklist-state-api.md   # Phase 1 — GET/POST /api/sm-checklist-state contract
│   └── today-dashboard-ui.md    # Phase 1 — UI/behaviour contract for the tab + cards
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items passing)
└── tasks.md             # Phase 2 — generated by /speckit-tasks
```

### Source Code (repository root)

```text
client/src/
├── views/MyIssues/
│   ├── MyIssuesView.tsx                       # MODIFIED — add "Today" as first/default tab; read ?tab= param
│   └── Today/                                 # NEW — the dashboard feature folder
│       ├── TodayDashboard.tsx                 # NEW — tab container: lays out category cards + snapshot
│       ├── TodayDashboard.module.css          # NEW
│       ├── CategoryCard.tsx                    # NEW — one card: count, state, deep link, check-off
│       ├── CategoryCard.module.css            # NEW
│       ├── SprintFlowSnapshot.tsx             # NEW — informational-only WIP + days-remaining panel
│       ├── todayCategories.ts                 # NEW — pure: category catalog + count derivations
│       ├── todayCategories.test.ts            # NEW — unit tests for every count rule (mocked issues)
│       ├── hooks/
│       │   ├── useTodayDashboard.ts           # NEW — orchestrates per-card data from existing sources
│       │   ├── useTodayDashboard.test.ts      # NEW
│       │   ├── useChecklistCompletion.ts      # NEW — daily completion state (server-backed)
│       │   └── useChecklistCompletion.test.ts # NEW
│       └── TodayDashboard.test.tsx            # NEW — component: loading/error/empty/done-for-today
├── services/
│   ├── checklistStateApi.ts                   # NEW — client wrapper for /api/sm-checklist-state
│   └── checklistStateApi.test.ts             # NEW
└── views/MyIssues/hooks/useMyIssuesState.ts   # MODIFIED — export MY_ISSUES_JQL for reuse

src/
├── routes/
│   ├── checklistState.js                       # NEW — Express router (mirrors mentionState.js)
│   └── checklistState.test.js                  # NEW
└── services/
    ├── dailyChecklistStore.js                  # NEW — AppData JSON store (mirrors mentionStateStore.js)
    └── dailyChecklistStore.test.js             # NEW

server.js                                       # MODIFIED — mount createChecklistStateRouter()
CHANGELOG.md                                    # MODIFIED — [Unreleased] entry at PR time
```

**Structure Decision**: Web-app layout (existing). All UI lives under a new
`views/MyIssues/Today/` folder so the dashboard is cohesive and the existing tab files are
untouched except for the small wiring change in `MyIssuesView.tsx`. Business logic
(`todayCategories.ts`) is a pure module separated from the React hooks so every count rule
is unit-testable in isolation (mirrors the `hygieneChecks.ts` discipline). The server side
is a 1:1 mirror of the proven mention-state store/route.

## Complexity Tracking

No Constitution violations. All choices stay within existing patterns; no new dependency,
no new persistence mechanism, no new categorization rule.

---

## Implementation Phases

### Phase A — Sub-tab deep-linking + "Today" tab skeleton

**Goal**: Make My Issues sub-tabs addressable and add an empty "Today" tab as the default
landing tab, with nothing breaking.

- `useMyIssuesState.ts` — export `MY_ISSUES_JQL` (no behaviour change).
- `MyIssuesView.tsx` — add `'today'` to `MyIssuesTab`/`MY_ISSUES_TABS` as the **first**
  entry; initialise `activeTab` to `'today'`; read `?tab=` via `useSearchParams` on mount
  and when it changes to select a sub-tab; keep state in sync so internal clicks still work.
- `TodayDashboard.tsx` — placeholder container rendered for the `today` tab.

Tests (component, red first):
- My Issues mounts with the **Today** tab active by default.
- Visiting `/my-issues?tab=mentions` activates the Mentions sub-tab.
- An unknown/absent `?tab=` falls back to `today` without error.

### Phase B — Daily completion state (server)

**Goal**: Persist per-user, per-business-day check-off state with automatic daily reset.

- `dailyChecklistStore.js` — mirror `mentionStateStore.js`: `sm-checklist-state.json` in
  `CONFIG_DIR_PATH`; shape `{ userKey: { businessDayKey: { categoryId: { completedAt } } } }`;
  `getDailyChecklist(userKey, dayKey)`, `setCategoryComplete({userKey, dayKey, categoryId,
  isComplete})`; prune day buckets older than the current one on write (the reset mechanism);
  corrupt/missing file → empty.
- `checklistState.js` — `GET /api/sm-checklist-state?user=&day=` and `POST` (mirrors
  `mentionState.js` validation + shape).
- `server.js` — mount `createChecklistStateRouter()` next to the mention-state router.

Tests (server unit, mocked fs / temp path):
- GET unknown user/day → empty map.
- POST complete then GET (same day) → category present.
- POST then GET a **different** day → empty (reset proven).
- Old day buckets pruned on write; corrupt file tolerated.

### Phase C — Category computation (pure)

**Goal**: Implement every count rule as a pure function over already-typed issue arrays,
reusing existing rules only.

- `todayCategories.ts`:
  - `CATEGORY_CATALOG` — ordered list `{ id, label, icon, destination }` for the 8 duties.
  - `countMentions(visibleMentions)` — length of unaddressed mentions in window.
  - `selectBlockers(myIssues, teamIssues)` — union by key of `isAttentionIssue` matches.
  - `selectMyStale(myIssues, staleDaysThreshold)` — `checkStaleIssue` matches.
  - `bucketTeamHygiene(teamIssues, ctx)` — run `evaluateHygieneIssue()` once; return
    `{ stale, unassigned, commitmentGaps, dueOverdue }` issue lists by flag id
    (`stale`; `no-assignee`; `missing-sp`∪`no-ac`; `due-date-overdue`∪`target-end-overdue`).
  - `selectUntriaged(...)` — reuse the existing DSU "new" definition (see research.md).
  - `isDoneForToday(categoryStates)` — true when every category is complete.

Tests (unit, mocked issues): one focused test per rule, incl. the unassigned case (proves
team scope surfaces no-assignee issues), multi-category membership, and zero-count.

### Phase D — Orchestration hook + completion hook

**Goal**: Wire the pure rules to live data with per-card isolation; wire daily completion.

- `useTodayDashboard.ts` — composes existing sources, each independent:
  - mentions via `useMentionsState`;
  - **my** issues via a `MY_ISSUES_JQL` `jiraGet` (own loading/error);
  - **team** issues via `useSprintData` (`sprintIssues`, `isLoadingSprint`, `loadError`,
    plus `boardId`/`sprintInfo` → `isTeamConfigured`);
  - **untriaged** "new" issues via the existing DSU new-section query (`useDsuBoardState` /
    its JQL) as its own independently-loading source (FR-004h);
  - reads `staleDaysThreshold` + roster from existing stores;
  - returns per-category `{ count, status: 'loading'|'ready'|'error'|'not-configured',
    issues?, destination }`.
- `useChecklistCompletion.ts` — loads current business-day map via `checklistStateApi`,
  resolves the user the same way Mentions does (`/myself`), exposes `toggle(categoryId)`
  and merges **auto-complete on zero count** with manual completion.

Tests: a slow/failing source isolates to its card; reused store data is not re-fetched;
auto-complete on zero; manual toggle persists; "not configured" when no board/sprint.

### Phase E — UI: cards, snapshot, deep links, done-for-today

**Goal**: Render the dashboard.

- `CategoryCard.tsx` — count, per-card loading/error/retry, cleared/complete styling,
  manual check-off, and a deep link (`?tab=` for internal sub-tabs; `settingsStore`
  `sprintDashboardActiveTab` + navigate for Sprint Dashboard sub-tabs; existing browse/
  navigator URL builders for Jira).
- `SprintFlowSnapshot.tsx` — informational WIP distribution + sprint days remaining
  (from `useSprintData`); never a check-off item.
- `TodayDashboard.tsx` — lay out cards in priority order; show a "connection required"
  state (FR-013) and an unambiguous **"done for today"** confirmation (FR-016) when all
  clear.

Tests (component): loading→ready transitions; one card error doesn't blank others;
zero-count card renders complete; all-complete shows done-for-today; deep links target the
correct destinations.

### Phase F — CHANGELOG + PR

- `CHANGELOG.md` `## [Unreleased]` → `### Added` entry for the Today dashboard.
- Run quickstart.md scenarios; ensure client (`vitest run`) + server (Jest) suites green
  and `tsc -b && vite build` clean.
- Open PR to `main`; reference quickstart.md as the proof checklist.

---

## Key design decisions (summary)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Placement | New `Today` tab, default landing in My Issues | Spec FR-001; minimal change to existing tabs |
| Team scope | Active sprint/board issue set (all assignees) via `useSprintData` | Clarify Q1; only scope that includes unassigned work; reuses existing fetch |
| Team counts | One `evaluateHygieneIssue()` pass, bucket by check id | Reuses existing rules; no new rule; one fetch yields 4 categories |
| My counts | `MY_ISSUES_JQL` (`assignee = currentUser()`) | Reuses existing query/constant |
| Mentions count | `useMentionsState.visibleMentions` | Reuses existing scan + window + addressed-state |
| Load strategy | Per-card independent fetch; reuse cached tab data | Clarify Q2; FR-013a; isolates slow/failing sources |
| Refresh | Mount + manual + on-tab-return; no polling | Clarify Q3; FR-011 |
| Sprint-flow snapshot | Informational only; no WIP-pileup check | Clarify Q4; FR-005 |
| Completion state | New AppData JSON store mirroring `mentionStateStore.js` | Reuses proven per-user persistence; no DB |
| Daily reset | Most-recent-business-day key via new `mostRecentBusinessDayKey(now)` (today on a weekday, Friday on Sat/Sun); prune older buckets | FR-015; weekend check survives to next business day. (Not `businessDaysAgo(0,…)` — returns today even on weekends.) |
| Auto-complete | Zero count ⇒ complete, merged with manual check-off | FR-014 |
| Sub-tab deep link | `?tab=` via `react-router` `useSearchParams` | New capability (FR-009); framework-native |
| Determinism | No AI Assist gate anywhere | Spec hard constraint; FR-002 |
