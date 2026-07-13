# Phase 1 Data Model: Per-Team Persistent Backlog Remediation

All types are frontend TypeScript in `client/src/views/SprintDashboard/backlogRemediation/remediationTypes.ts`.
No server-side schema. Persistence is one JSON blob per team scope in localStorage.

## §1 — RemediationStatus

```text
RemediationStatus = 'pending' | 'canceled' | 'kept' | 'dismissed' | 'snoozed'
```

- `pending` — awaiting a decision; shown in the actionable queue.
- `canceled` — closed/transitioned via bulk close (terminal until material change).
- `kept` — explicitly decided to keep (terminal until material change).
- `dismissed` — "not cleanup-worthy now, hide it" (terminal until material change).
- `snoozed` — hidden until `snoozeUntilIso`; then reverts to `pending`.

Terminal set for resurfacing purposes = `{ canceled, kept, dismissed }`. `snoozed` is time-terminal.

## §2 — ItemFingerprint (FR-013)

Recorded on the item **at decision time**; compared on refresh to decide re-entry.

| Field | Type | Meaning |
|-------|------|---------|
| `statusCategoryKey` | `string` | Jira status category key at decision time (e.g. `new`, `indeterminate`, `done`) |
| `assigneeKey` | `string \| null` | Assignee machine id (accountId / user key) at decision time; null when unassigned |

**Material change** = current `statusCategoryKey` ≠ recorded, **OR** item is now assigned to an active-team roster
member when the recorded `assigneeKey` was null / not-in-team. Any other diff is cosmetic and ignored.

## §3 — RemediationItem

One backlog issue tracked in the queue. Extends the reused `AgingTriageIssue` signals with lifecycle state.

| Field | Type | Notes |
|-------|------|-------|
| `issueKey` | `string` | Jira key — the identity |
| `verdict` | `AgingTriageVerdict \| null` | Last ingested AI verdict (`cancel-safe`/`review`/`must-remain`); null before first ingest |
| `rationale` | `string` | AI rationale for the verdict |
| `status` | `RemediationStatus` | Lifecycle state (§1); defaults `pending` |
| `snoozeUntilIso` | `string \| null` | Set only when `status = snoozed` |
| `fingerprint` | `ItemFingerprint \| null` | Set when a terminal decision is made (§2); null while `pending` |
| `decidedAtIso` | `string \| null` | When the current status was set (audit) |
| `signals` | `AgingTriageIssue` | The enriched signals the verdict was judged on (age, daysInStatus, assignee, storyPoints, description/AC presence, priority, feature + status) |

State transitions:

```text
pending ──cancel──▶ canceled        (records fingerprint + decidedAt)
pending ──keep────▶ kept            (records fingerprint + decidedAt)
pending ──dismiss─▶ dismissed       (records fingerprint + decidedAt)
pending ──snooze──▶ snoozed         (sets snoozeUntilIso)
snoozed ──elapse──▶ pending         (todayIso >= snoozeUntilIso; clears snoozeUntilIso)
{canceled|kept|dismissed} ──material change──▶ pending   (clears fingerprint; FR-013)
any ──out of scope──▶ (removed from queue)               (FR-017)
```

## §4 — RemediationQueue

The persisted blob for one team scope.

| Field | Type | Notes |
|-------|------|-------|
| `storageKey` | `string` | `tbxBacklogRemediation:<teamProfileId>:<projectKey>:<piName>` |
| `items` | `RemediationItem[]` | Every tracked item (all statuses); actionable subset derived on read |
| `lastRefreshedIso` | `string \| null` | When the backlog was last re-fetched/reconciled |
| `scopeOverrideJql` | `string \| null` | Operator JQL override for this team; null = derive from profile |

Read tolerance (FR-012): a missing/corrupt/oversized blob yields an empty queue (`items: []`), never an error.

## §5 — TeamScope

Resolved scope for a fetch (not persisted except the override).

| Field | Type | Notes |
|-------|------|-------|
| `teamProfileId` | `string` | Active dashboard team profile id (storage segment) |
| `projectKey` | `string` | From the live sprint data / team profile |
| `piName` | `string` | From the live sprint data / team profile |
| `jql` | `string` | Derived backlog JQL (project [+ roster clause]) or the override, wrapped by `buildAgingJql` |

## §6 — Derived views (pure selectors)

- **actionableItems(queue, todayIso)** → items where `status = pending`, or `status = snoozed` and
  `todayIso >= snoozeUntilIso` (these are surfaced as pending after reconciliation).
- **historyItems(queue)** → items with a terminal status (for an optional "already handled" view).
