# Phase 0 Research — My Issues "Today" Scrum Master Dashboard

All Technical Context unknowns are resolved below. The feature is a read-side mashup, so
"research" is primarily confirming **which existing capability each category reuses** and
recording the few genuine design decisions.

## Decision 1 — Team / in-scope issue set

- **Decision**: Bound team-wide categories by the **active sprint/board issue set** from the
  Sprint Dashboard's saved selection, reusing `useSprintData` (`sprintIssues`). Include all
  assignees (and unassigned). The saved roster (`useStandupRosterStore`) is used only to
  group/label, never to bound the set.
- **Rationale**: A roster `assignee in (...)` clause structurally cannot surface
  **unassigned** issues (FR-004e) — they have no assignee — so a roster-bounded scope would
  always show zero unassigned, a false "all clear" (spec edge case). The sprint/board scope
  is the only coherent boundary and is already fetched and persisted.
- **Alternatives considered**: (a) roster-only — rejected, drops unassigned; (b) union of
  sprint scope + roster-across-project — rejected as broader fetching + double-count de-dupe
  for no added value in v1.

## Decision 2 — Reuse existing rules, run one hygiene pass

- **Decision**: Compute team-wide counts by running the existing `evaluateHygieneIssue()`
  (`client/src/views/Hygiene/checks/hygieneChecks.ts`) **once** over the team issue set, then
  bucket findings by `checkId`:
  - **team-stale** ← `stale` (`checkStaleIssue`, threshold from settings)
  - **unassigned** ← `no-assignee` (`checkNoAssignee`)
  - **commitment-gaps** ← issues with `missing-sp` (`checkMissingStoryPoints`) **or** `no-ac`
    (`checkNoAcceptanceCriteria`)
  - **due/overdue** ← issues with `due-date-overdue` (`checkDueDateOverdue`) **or**
    `target-end-overdue` (`checkTargetEndOverdue`)
- **Rationale**: Satisfies FR-003 (no new rule) and keeps the dashboard's numbers identical
  to the Hygiene tab (SC-002). One evaluation pass yields four categories efficiently.
- **Alternatives considered**: Re-implementing slim per-category predicates — rejected as
  rule duplication and a drift risk against Hygiene.

## Decision 3 — Staleness threshold source

- **Decision**: Read the stale-days threshold from the existing settings the Sprint
  Dashboard / Blockers / Hygiene already use (passed as `staleDaysThreshold` into the checks),
  falling back to the established default when unset.
- **Rationale**: `checkStaleIssue` already accepts a configurable threshold so "the Hygiene
  tab and the Blockers tab agree on what counts as stale" (its own doc comment). The dashboard
  joins that agreement rather than inventing a number.
- **Alternatives considered**: A dashboard-specific threshold — rejected; would diverge from
  the surfaces it links to.

## Decision 4 — "My" categories

- **Decision**: Fetch my issues with the existing `MY_ISSUES_JQL`
  (`assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`) via `jiraGet`,
  exporting the constant from `useMyIssuesState.ts` for reuse. Derive **my-stale**
  (`checkStaleIssue`). **F3 scope rule**: the "act-today" categories — **blockers** and
  **due/overdue** — union my ∪ team (so my urgent items surface even outside the current
  sprint); the sprint-hygiene categories — **team-stale**, **unassigned**,
  **commitment-gaps** — stay bounded to the team sprint/board set; **my-stale** is my-only.
- **Rationale**: Reuses the exact query the Report tab uses; `currentUser()` is resolved
  server-side by Jira, so no client identity store is needed for the query itself.
- **Alternatives considered**: Reusing `useMyIssuesState` component state directly — rejected;
  it is per-component, not a shared store, so the dashboard owns an independent fetch (which
  also gives per-card isolation). Cached reuse still applies where the Report tab's store data
  is already in memory.

## Decision 5 — Mentions count

- **Decision**: Reuse `useMentionsState` and count `visibleMentions.length` (unaddressed
  mentions within the user's configured business-day window).
- **Rationale**: The mentions scan, window logic, and server-backed addressed-state already
  exist; the dashboard must match the Mentions tab exactly (SC-002, SC-007).
- **Alternatives considered**: A separate lightweight count query — rejected; would risk
  diverging from the tab's precise client-side mention matching.

## Decision 6 — "Untriaged new issues"

- **Decision**: Reuse the **DSU Board "new" section** for the untriaged category — both its
  **data source** and its **rule**. The untriaged card is its **own independently-loading
  source**: the orchestration hook fetches the DSU "new" set via the existing DSU new-section
  query (`useDsuBoardState` / its JQL), and `selectUntriaged(untriagedIssues)` simply counts
  that already-curated set (it does **not** derive from the sprint/board set, which is a
  different scope). Treat the DSU new-section rule/query as the single source of truth; if it
  is not exposed reusably, the task phase extracts it (no behavioural change) rather than
  authoring a new rule.
- **Rationale**: FR-003 (no new rule); the DSU board already curates "new" issues needing
  grooming.
- **Alternatives considered**: Defining "created within N days and unestimated" fresh —
  rejected as a new rule.

## Decision 7 — Daily completion persistence + reset

- **Decision**: New `dailyChecklistStore.js` + `checklistState.js` router, a 1:1 mirror of
  `mentionStateStore.js` / `mentionState.js`, writing `sm-checklist-state.json` to the same
  AppData config dir. Keyed `userKey → businessDayKey → categoryId`. The **business-day key**
  is the calendar date of the **most recent business day**: today on a weekday, or the
  preceding Friday on Sat/Sun. A new pure helper `mostRecentBusinessDayKey(now)` computes it
  (start from `now`, step back while `isWeekend`, then `toJqlDateString`), reusing `isWeekend`
  from `businessDays.ts`. **Note**: `businessDaysAgo(0, now)` is NOT used — with a count of 0
  it returns the start of *today* even on a weekend (no rollback), which would yield a Saturday
  key and break the "Friday persists through the weekend" semantics. Older day buckets are
  pruned on write — that *is* the daily reset. Auto-complete on zero count is a pure UI merge
  layered on top of stored manual completion.
- **Rationale**: Reuses a proven, corrupt-tolerant, per-user persistence pattern with no DB
  (Article VII). A date-scoped key gives automatic reset with no scheduler. Using the
  most-recent-business-day key means a Friday check-off persists through the weekend and
  resets Monday — honouring "every [working] day without fail" (FR-015) without nagging on
  Saturday/Sunday.
- **Alternatives considered**: (a) localStorage only — rejected; would not follow the user
  across devices like the Mentions addressed-state does, and the spec ties completion to the
  same per-user persistence. (b) A timestamp + client-side "is it a new day" check — rejected;
  the date-scoped key is simpler and self-resetting.

## Decision 8 — Sub-tab deep-linking

- **Decision**: Add a `?tab=<id>` URL param read by `MyIssuesView` via `react-router-dom`
  `useSearchParams`; selecting a card that targets Mentions/Hygiene/Report navigates with that
  param. Sprint Dashboard sub-tab targets set `settingsStore.sprintDashboardActiveTab` (which
  the Sprint Dashboard already restores) before navigating to `/sprint-dashboard`. External
  Jira links reuse existing browse / issue-navigator URL builders.
- **Rationale**: FR-009 requires single-click landing on a specific sub-tab, which does not
  exist today (sub-tabs are local `useState`). `useSearchParams` is framework-native (no
  custom nav store — Article VII). The Sprint Dashboard already persists its active tab, giving
  a ready deep-link seam.
- **Alternatives considered**: `react-router` location `state` — rejected; not shareable/
  bookmarkable and lost on reload. A global nav store — rejected; rebuilds what the router
  provides.

## Decision 9 — Load strategy, refresh, and resilience

- **Decision**: Each category card loads independently on mount (its own loading/error),
  reusing already-loaded store data where present; counts refresh on mount, on an explicit
  Refresh action, and on return to the dashboard tab; **no background polling**. A single
  source failure isolates to its card.
- **Rationale**: Clarify Q2/Q3; FR-012/FR-013a. The mentions comment-scan is the slowest
  source, so per-card isolation keeps fast counts instant.
- **Alternatives considered**: Single coordinated batch (global spinner) — rejected, one slow
  source delays all; lazy on-demand — rejected, defeats at-a-glance.

## Framework-First ledger note

No `FRAMEWORK-CAPABILITIES.md` exists at repo root or under `client/`. ⚠️ Flagged: this
feature relies on React, react-router-dom, Zustand, and Express, each providing the seams used
above (component state, URL params, stores, routers). A future ledger should record these so
the no-rebuild gate has a written checklist; this feature does not create one.

## Resolved unknowns

| Unknown | Resolution |
|---------|------------|
| Team scope boundary | Active sprint/board set (Decision 1) |
| How to compute team counts without new rules | One `evaluateHygieneIssue()` pass, bucket by checkId (Decision 2) |
| Stale threshold | Existing settings threshold (Decision 3) |
| Daily reset mechanism | Date-scoped key + prune on write (Decision 7) |
| Sub-tab deep-linking | `?tab=` via `useSearchParams` (Decision 8) |
| New dependencies | None |
