# Data Model: Scheduled PI Review Save to Confluence

All persisted config lives server-side under `configuration.scheduler.piReview` (in
`%APPDATA%\NodeToolbox\toolbox-proxy.json`). No browser storage, no new secret store.

## PiReviewSchedulerConfig

The top-level block persisted in `configuration.scheduler.piReview`.

| Field | Type | Notes |
|---|---|---|
| `teams` | `PiReviewScheduledTeam[]` | One entry per team that has a schedule (enabled or not). |

## PiReviewScheduledTeam

One team's schedule and the inputs a server run needs (which the client normally reads from localStorage).

| Field | Type | Validation / Notes |
|---|---|---|
| `teamName` | string | Display label in the Admin Hub. Required. |
| `isEnabled` | boolean | Master toggle; a disabled team never runs (FR-002). Default `false`. |
| `scheduleTime` | string `HH:MM` | Local-time daily fire (FR-001). Validated `^([01]\d|2[0-3]):[0-5]\d$`. |
| `productOwnerAssignee` | string | The PO's Jira assignee value used to scope the pull (FR-006, FR-016). Required for a run; a blank value → run skipped with "no Product Owner configured". |
| `piFieldId` | string | The PI custom field id, e.g. `customfield_10301` (FR-015). Default `customfield_10301`. |
| `dependencyLinkTypes` | string[] | Jira link-type names treated as dependencies during reconcile (replaces the client's `localStorage.tbxARTSettings.depLinkTypes`). Optional; falls back to the same default the client uses. |
| `pages` | `PiReviewScheduledPage[]` | The PI Review pages to keep fresh (≥1 for a meaningful run). |

## PiReviewScheduledPage

One configured PI Review Confluence page for the team (a team may schedule several — one per active PI).

| Field | Type | Validation / Notes |
|---|---|---|
| `pageUrlOrId` | string | Confluence page URL or numeric id; the server resolves the numeric id from it (same rule the client uses). Required; invalid → that page's run fails with a descriptive status (FR-011). |
| `piName` | string | The exact PI value to match in `cf[<piFieldId>] = "<piName>"` (FR-006). Required. |

## PiReviewRunResult

The outcome of a run (scheduled or Run-now), surfaced in the Admin Hub. The **last** result per team/page is
**persisted** to the scheduler state store (status, timestamp, message, counts) so the panel shows run history after a
server restart (FR-019). Only the most-recent result per team/page is kept; older results are not retained.

| Field | Type | Notes |
|---|---|---|
| `status` | enum | `success` \| `no-op` \| `skipped` \| `failed` (FR-019). |
| `ranAtIso` | string | ISO timestamp of the run. |
| `pageUrlOrId` | string | Which page this result is for. |
| `featuresAppended` | number | New rows added this run. |
| `rowsReconciled` | number | Existing rows refreshed. |
| `message` | string | Human-readable reason on non-`success` (no PO configured, page invalid, Confluence not configured, version conflict after retry, no features found). |

### Status semantics

- `success` — page written (rows appended and/or reconciled).
- `no-op` — ran cleanly but nothing to write (e.g. query returned features already present and no field changes), or
  **no features found** (rows left intact, FR-010).
- `skipped` — precondition not met without erroring: team disabled, no PO configured, or already ran today.
- `failed` — page/config invalid, Confluence not configured, or unresolved version conflict after one retry.

## Fired-state (reused, not new)

Per-team once-per-day + catch-up tracking reuses `schedulerFiredState.js`
(`%APPDATA%\NodeToolbox\scheduler-fired-state.json`) under a `piReview` scheduler name, keyed by team. No new schema.

## The refresh boundary (conceptual — see FR-007/FR-008)

Within a page's parsed PI Review table, a run partitions columns:

| Jira-owned (reconciled each run) | Human-curated (preserved byte-for-byte) |
|---|---|
| Priority, Point Estimate, Dependency, Risks, Notes-migration | Carry-over, Feature title (existing rows), Committed, and the whole Capacity snapshot / commitment boundary / grouping lines / confidence-votes table |

Newly-appended rows carry Jira's `KEY - summary` in the feature cell; existing rows keep their feature cell text.

## Relationships

```
PiReviewSchedulerConfig 1───* PiReviewScheduledTeam 1───* PiReviewScheduledPage
                                        │
                                        └── produces *──> PiReviewRunResult (per page, per run)
```
