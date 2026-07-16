# Data Model: Monthly Delivery Report

**Feature**: `018-monthly-delivery-report` · **Date**: 2026-07-16
All entities are plain JSON — no database. Persistence locations are listed per entity.

## MonthlyDeliveryConfig

Server-side scheduler configuration. **Persists** in `configuration.scheduler.monthlyDelivery` inside
`toolbox-proxy.json` (must be added to the `saveConfigToDisk` whitelist in `src/config/loader.js`).

| Field | Type | Rules |
|---|---|---|
| `isEnabled` | boolean | Default `false`. Scheduler tick skips everything when false; Run Now still works. |
| `scheduleTime` | string `"HH:MM"` | Default `"08:00"`. Validated with the house pattern `^([01]\d|2[0-3]):[0-5]\d$`. |
| `featureLinkFieldId` | string | Default `"customfield_10108"`. Snapshotted from client ART settings at panel save. |
| `teams` | TeamSnapshot[] | May be empty → scheduler skips with "no teams configured" status (FR-006). |

## TeamSnapshot

One team copied from a client `SprintDashboardTeamProfile` at Admin Hub panel save (FR-005, A7). Only the fields
the server needs are copied — never the whole profile.

| Field | Type | Source (client profile field) | Rules |
|---|---|---|---|
| `teamName` | string | `name` | Display + prompt section heading; trimmed, non-empty. |
| `projectKey` | string | `projectKey` | JQL scope for both queries; trimmed, non-empty; teams with empty projectKey are rejected at save (sanitiser). |
| `boardId` | string | `boardId` | Carried for future use; not used in v1 queries. |

## DeliveryRecord

One qualifying Story/Task. **In-memory only** during a run; rendered into the prompt, counted into TeamOutcome.

| Field | Type | Rules |
|---|---|---|
| `issueKey` | string | Jira key. Unique within a run — an issue appears exactly once (FR-011); Production wins over External Test (FR-010). |
| `summary` | string | From `fields.summary`. |
| `bucket` | `'production'` \| `'externalTest'` | See Classification rules below. |
| `qualifyingDateIso` | string (ISO) | The changelog/version date that placed the issue in the covered month. |
| `featureKey` | string \| null | Resolved via feature-link candidates → `parent.key`; null → "No Feature" group. |

### Classification rules (authoritative)

Covered month window: `[YYYY-MM-01T00:00 local, last-day T23:59:59.999 local]` of the calendar month before the
run month (FR-001; Run Now uses the same window, A2).

1. **Production — status path**: the issue's most recent changelog transition INTO a done-category status
   (`DONE_CATEGORY_STATUS_NAMES` from `workflowDelivery.ts`) has `history.created` inside the window.
2. **Production — released-version path**: the issue currently satisfies `isDeliveredIssue` AND at least one of its
   `fields.fixVersions` matches a project version with `released === true` and `releaseDate` inside the window
   (FR-010, A4; edge: qualifies even with no in-month status transition).
3. **External Test**: not Production, and `resolveDeliveryDateIso(issue)` (entry into the current uninterrupted
   delivered run — `Ready for QA` or later) falls inside the window (FR-009). Carry-over is inherited from
   `resolveDeliveryDateIso`: an issue that regressed and re-reached `Ready for QA` is credited to the re-entry
   month; an issue that entered External Test in an earlier month and did nothing this month does NOT re-qualify.
4. **Missing changelog** = not attributable = excluded (never "benefit of the doubt" — this diverges deliberately
   from `isDeliveredWithinWindow`'s permissive fallback because the report must be spot-check accurate, SC-003;
   both queries request `expand=changelog` so this only guards malformed responses).

## FeatureGroup

Prompt-level grouping. **In-memory only.**

| Field | Type | Rules |
|---|---|---|
| `featureKey` | string \| null | null renders as "No Feature" (always last in its bucket). |
| `featureSummary` | string | Batch-fetched once per run via `key in (...)`; falls back to the key when fetch fails (grouping must never break the run). |
| `records` | DeliveryRecord[] | Sorted by issue key for deterministic output (testability). |

## TeamOutcome

Per-team result inside a run. **Persists** inside RunResult.

| Field | Type | Rules |
|---|---|---|
| `teamName` | string | Snapshot name. |
| `status` | `'ok'` \| `'empty'` \| `'error'` | `ok` requires every query for the team to have succeeded (FR-018); `empty` = ok with zero records (FR-014); `error` → message set, prompt shows DATA UNAVAILABLE. |
| `productionCount` | number | 0 unless status is `ok`. |
| `externalTestCount` | number | 0 unless status is `ok`. |
| `message` | string | Human-readable error detail for `error`; empty otherwise. Never fabricates success (GH #167 lesson). |

## RunResult

The persisted last run. **Persists** as the whole content of `monthly-delivery-last-run.json`
(env override `TBX_MONTHLY_DELIVERY_RESULTS_PATH`); each run overwrites the previous (FR-016; Run Now replaces
scheduled output and vice versa — single-slot by design).

| Field | Type | Rules |
|---|---|---|
| `ranAtIso` | string (ISO) | Wall clock at run completion. |
| `coveredMonth` | string `"YYYY-MM"` | The reported month. |
| `trigger` | `'scheduled'` \| `'manual'` | Manual runs never write scheduler fired state (FR-003). |
| `promptText` | string | The full prompt artifact (contracts/prompt-format.md). |
| `teams` | TeamOutcome[] | One entry per configured team, always — no team silently missing (SC-004). |

## State transitions

```text
Scheduler tick (every 60s)
  isEnabled? ── no ──▶ idle
  teams.length? ── 0 ──▶ record "no teams configured" status, mark month fired? NO — skip without firing
  firedThisMonth(YYYY-MM)? ── yes ──▶ idle
  today vs secondTuesday(month):
      before ──▶ idle
      on day  ──▶ isScheduledTimeReached(scheduleTime)? ── no ──▶ idle
      after (catch-up) ─┐
                        ▼
  mark fired (YYYY-MM-DD under key 'monthlyDelivery') ──▶ run(trigger='scheduled') ──▶ RunResult overwritten

Run Now (POST /run-now)
  run(trigger='manual') ──▶ RunResult overwritten (fired state untouched)
```
