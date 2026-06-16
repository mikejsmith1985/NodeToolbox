# Phase 1 Data Model: Rovo Expansion + Proactive Hygiene Monitor

All entities are in-memory/config structures (no database). Config entities persist
to `%APPDATA%\NodeToolbox\toolbox-proxy.json` via `src/config/loader.js`; runtime
entities live only for the duration of a scan or scheduler run.

## Config entities (persisted)

### HygieneMonitorConfig
The Admin-Hub-managed configuration for the monitor (FR-007, FR-014).

| Field | Type | Notes / Validation |
|---|---|---|
| `isEnabled` | boolean | Master on/off for the scheduled scan. |
| `teams` | `HygieneTeamConfig[]` | One entry per monitored team. |

### HygieneTeamConfig
Per-team scan configuration.

| Field | Type | Notes / Validation |
|---|---|---|
| `id` | string | Stable id (uuid). |
| `name` | string | Display name for digest/panel. |
| `projectKeys` | string[] | Jira project keys to scan; non-empty for an active team. |
| `scheduleTime` | string | `HH:mm` 24h local; default `06:00`. |
| `weekdays` | number[] | ISO weekday numbers (1=Mon…5=Fri); default `[1,2,3,4,5]`. |
| `digestTriggerUrl` | string | Atlassian Automation webhook that emails the digest; empty ⇒ digest delivery skipped (FR-012). |
| `digestTriggerSecret` | string | Optional header token for the webhook; **base64-obfuscated at rest**, never logged. |
| `digestEmailTo` | string | Recipient address passed in the webhook payload for the Automation rule to email (optional if the rule hard-codes the recipient). |
| `fieldMappings` | `HygieneFieldConfig` | Same shape the Hygiene view uses (custom field ids per rule). |
| `enabledCheckIds` | string[] | Which hygiene rules apply for this team (subset of `HYGIENE_CHECK_IDS`). |

### HygieneScanHistoryEntry
Bounded per-team history powering the trend indicator (SC-009). Keep last N (e.g. 10).

| Field | Type | Notes |
|---|---|---|
| `teamId` | string | FK → HygieneTeamConfig.id. |
| `ranAt` | string (ISO) | Scan completion timestamp. |
| `issuesScanned` | number | Total open issues evaluated. |
| `violationsFound` | number | Total violations across issues. |
| `fixesApplied` | number | Violations resolved via Jira field update. |
| `actionsRequired` | number | Unfixable violations that got a comment. |

> **Relationship**: `HygieneMonitorConfig 1—* HygieneTeamConfig 1—* HygieneScanHistoryEntry`.
> Trend = compare the newest entry's `violationsFound` to the immediately prior entry for the same `teamId`.

## Runtime entities (transient, per scan)

### HygieneViolation
Produced by evaluating one issue against the shared rules (`src/services/hygieneRules.js`).

| Field | Type | Notes |
|---|---|---|
| `issueKey` | string | e.g. `ABC-123`. |
| `checkId` | string | Which hygiene rule failed (e.g. `missing-target-end`). |
| `severity` | `'warn' \| 'error'` | From the rule. |
| `fieldId` | string \| null | Jira field the rule concerns (for the fix path). |
| `currentValue` | unknown | Present value (may be empty/missing). |
| `assigneeAccountId` | string \| null | Comment recipient; falls back to reporter, then none. |

### RovoClassification
Rovo's per-violation verdict, parsed from the Confluence parking page text
(see `contracts/rovo-classification.md`).

| Field | Type | Notes |
|---|---|---|
| `issueKey` | string | Pairs back to the violation. |
| `checkId` | string | Pairs back to the violation. |
| `verdict` | `'FIXABLE' \| 'UNFIXABLE'` | Drives fix-vs-comment branch. |
| `correctedValue` | string \| null | For `FIXABLE`: the value to write to `fieldId`. |
| `ownerGuidance` | string \| null | For `UNFIXABLE`: plain-language explanation for the comment. |

> **State transition** per violation: `detected → classified → (FIXABLE → applied | failed→commented) | (UNFIXABLE → commented)`.
> A malformed/empty classification ⇒ `detected → skipped` (logged, no Jira write — edge case in spec).

### HygieneDigest
The payload emailed after a scan (FR-012, SC-009) — fired as a trigger webhook to an
Atlassian Automation rule that composes the email (the inbox rule forwards it to Teams).
Built by a pure function; transport via the existing `reportWebhookDelivery`/`triggerWebhook` path.

| Field | Type | Notes |
|---|---|---|
| `teamName` | string | |
| `ranAt` | string (ISO) | |
| `issuesScanned` | number | |
| `violationsFound` | number | |
| `fixesApplied` | number | |
| `actionsRequired` | number | |
| `unassignedCount` | number | Violations with no assignee/reporter (edge case flag). |
| `trend` | `'up' \| 'down' \| 'flat' \| 'n/a'` | vs prior scan; `n/a` until ≥2 scans (SC-009). |
| `failures` | string[] | Per-issue Rovo/Jira failures included in the digest (edge cases). |

### RovoInsightBlock
Scheduler-enrichment output (FR-001/FR-002). A prose string prepended to the
Confluence briefing/report. Not persisted; `null` when enrichment is skipped.

| Field | Type | Notes |
|---|---|---|
| `surface` | `'standup' \| 'scope-change' \| 'feature-change'` | Which scheduler produced it. |
| `markup` | string \| null | Confluence storage-format snippet; `null` ⇒ publish without it (SC-008). |

## Cross-cutting: PassphraseGate
Existing session-scoped unlock (`rovoStore`). Not new data — referenced so all new
UI (CHG wizard actions, Hygiene Monitor panel, Admin Hub Rovo/hygiene config
visibility) reads the same shared unlock flag (FR-015, SC-007). No persistence;
re-entry required after reload (accepted behaviour).
