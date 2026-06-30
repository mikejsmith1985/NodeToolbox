# Phase 1 Data Model — My Issues "Today" Scrum Master Dashboard

The dashboard introduces **no new Jira data**. It defines client-side view models over
existing issue data plus one small persisted entity for daily check-off state. Entities below
map directly to the spec's Key Entities.

## 1. Attention Category (catalog entry)

A static, ordered catalog of the daily duties. Pure data + a derivation function reference.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `CategoryId` (string enum) | Stable key; used for completion persistence. See enum below. |
| `label` | string | Human-readable duty name (e.g. "Respond to mentions"). |
| `icon` | string | Emoji/icon for the card. |
| `destination` | `Destination` | Where the card's link goes (see entity 4). |
| `scope` | `'me' \| 'team'` | Drives which fetch feeds the count and the "not configured" state. |

**`CategoryId` enum** (also the persisted key set):
`mentions` · `blockers` · `my-stale` · `team-stale` · `unassigned` · `commitment-gaps` ·
`due-overdue` · `untriaged`.

Validation / rules:
- Catalog order **is** display order (priority).
- Adding a category later means extending the enum; persisted state for unknown ids is ignored.

## 2. Category Result (runtime, per card)

Computed by `useTodayDashboard`; one per catalog entry.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `CategoryId` | |
| `status` | `'loading' \| 'ready' \| 'error' \| 'not-configured'` | Per-card, independent (FR-013a). |
| `count` | number | Valid when `status === 'ready'`. Displayed as-is; large counts may render `99+`. |
| `issues` | `IssueRef[]?` | Optional supporting refs (key + summary) for hover/preview; not a full list. |
| `errorMessage` | string? | Set when `status === 'error'`; card shows retry. |
| `isComplete` | boolean | Derived: `count === 0` (auto) **or** manual completion present for today. |

State transitions: `loading → ready | error | not-configured`; `error →(retry) loading`;
`not-configured` only for `scope === 'team'` when no board/sprint is selected.

## 3. Daily Completion State (persisted)

Mirror of the mention-state store. File: `sm-checklist-state.json` in the AppData config dir.

On-disk shape:
```
{
  "<userKey>": {
    "<businessDayKey>": {
      "<categoryId>": { "completedAt": "<ISO-8601>" }
    }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `userKey` | string | Stable Jira user id (accountId / name / key), resolved as Mentions does. |
| `businessDayKey` | string `YYYY-MM-DD` | Most recent business day via `mostRecentBusinessDayKey(now)` — today on a weekday, the preceding Friday on Sat/Sun. (Do **not** use `businessDaysAgo(0,…)`; it returns today even on weekends.) |
| `categoryId` | `CategoryId` | Only manual completions are stored; auto-complete (count 0) is not persisted. |
| `completedAt` | ISO-8601 string | Set when marked complete. |

Rules:
- **Reset**: only the current `businessDayKey` bucket is returned by GET; older buckets are
  pruned on the next write. No scheduler needed.
- **Per-user**: namespaced by `userKey`, like mention-state.
- **Resilience**: missing/corrupt file → treated as empty (never blocks the dashboard).
- Manual completion is independent of count; a manually-completed non-zero category still
  shows its count but renders as complete for the day.

## 4. Destination (deep-link target)

Discriminated union describing where a card links. No new URL infrastructure beyond `?tab=`.

| Variant | Shape | Resolves to |
|---------|-------|-------------|
| My Issues sub-tab | `{ kind: 'myIssuesTab', tab: 'mentions'\|'hygiene'\|'report' }` | `/my-issues?tab=<tab>` |
| Sprint Dashboard tab | `{ kind: 'sprintTab', tab: 'blockers'\|'overview'\|… }` | set `settingsStore.sprintDashboardActiveTab` then navigate `/sprint-dashboard` |
| DSU Board | `{ kind: 'dsuBoard' }` | `/dsu-board` |
| Jira external | `{ kind: 'jira', issueKeys?: string[] }` | existing browse / issue-navigator URL builders |

## 5. Scope (resolution inputs — all existing, read-only)

| Input | Source | Used for |
|-------|--------|----------|
| Current user | `/rest/api/2/myself` (as Mentions `loadIdentity`) + `currentUser()` JQL | `scope: 'me'` counts; `userKey` for completion |
| Board / sprint selection | `settingsStore` (`sprintDashboardBoardId`, `…ProjectKey`, `…SelectedSprintId`, `…ScopeMode`) via `useSprintData` | `scope: 'team'` issue set; "not configured" detection |
| Stale threshold | existing settings threshold (Sprint Dashboard/Hygiene) | `checkStaleIssue` |
| Roster | `useStandupRosterStore` | display/grouping only (never bounds the set) |
| Mentions window | `useMentionsState` (1/3/5/10 business days) | mentions count |
| Untriaged "new" set | DSU new-section query (`useDsuBoardState` / its JQL) | untriaged count (own source; not the sprint/board set) |

## 6. Sprint-Flow Snapshot (informational, read-only)

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `wipByZone` | `{ zone: string; count: number }[]` | status zones over team issue set | Reuses existing status-zone classification |
| `sprintDaysRemaining` | number \| null | `useSprintData` `sprintInfo` end date | null when no active sprint |

Never a check-off item; no threshold/alert in v1 (FR-005).
