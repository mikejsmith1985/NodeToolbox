# Phase 1 Data Model — Intake Deduplication (Phase 2A)

No new persisted schema. This feature adds one durable mark on Jira issues (a label) and two small
in-memory shapes for the existence check/reconcile. Existing feature-005 shapes are reused as-is.

## 1. Intake stamp (on the Jira issue)

| Aspect | Value |
|--------|-------|
| Form | Jira label `intake-<submissionId>` (e.g. `intake-2f58d5cd-…`) |
| Set when | On issue creation, via `fields.labels` on the create payload |
| Meaning | "A Jira issue already exists for this submission id" — the authoritative dedup record |
| Constraints | No whitespace; GUID chars `[0-9a-f-]` are valid; an id that can't form a valid label ⇒ row is *unstampable* (flagged, not created) |
| Queryable | `labels = "intake-<id>"` / `labels in (...)` JQL, and visible on the issue for humans |

## 2. LabelSearchResult (in-memory, from `searchIssuesByLabels`)

The minimal projection returned by the label JQL search.

| Field | Type | Notes |
|-------|------|-------|
| `key` | `string` | The existing issue's Jira key |
| `labels` | `string[]` | The issue's labels; the `intake-` one identifies the submission |

Derived: **`foundIdToKey: Map<string,string>`** — submission id → existing key, built by extracting
the `intake-<id>` label from each result. If two keys map to one id, that id is **ambiguous**.

## 3. ExistenceOutcome (per submission, in-memory)

The decision the create/pre-scan uses per submission id.

| Outcome | Meaning | Effect on the row |
|---------|---------|-------------------|
| `not-found` | No stamped issue exists | Eligible to create |
| `found` (key) | Exactly one stamped issue exists | Reconcile → `imported` with that key; record ledger; no create |
| `ambiguous` (keys) | >1 stamped issue exists | Flag `invalid`/attention with the keys; no create |
| `check-failed` | Jira unreachable/error | Keep row actionable (`new`/`failed`) with a retry reason; no create |

## 4. Reconcile result (pure, from `reconcileExisting`)

`reconcileExisting(entries, foundIdToKey)` → `{ entries, newLedgerEntries }`

| Field | Type | Rule |
|-------|------|------|
| `entries` | `QueueEntry[]` | Rows whose id is in `foundIdToKey` become `imported` with `jiraKey` set + `reporterOutcome` left as-is; others unchanged |
| `newLedgerEntries` | `ProcessedEntry[]` | One per newly-reconciled id (`{ id, jiraKey, createdAt, reporterOutcome: 'matched'|'fallback'? }`) for the caller to persist via `recordProcessed` |

*(reconcile records the discovered key; `reporterOutcome` for a pre-existing issue is recorded as
**`'fallback'`** — we did not set the reporter on this run and do not re-derive the original
attribution. This is a display detail, not correctness.)*

## 5. Reused shapes (unchanged)

- `IntakeSubmission`, `QueueEntry`, `QueueEntryState` (adds no new state; uses existing
  `imported`/`invalid`/`failed`/`new`), `ProcessedEntry`, `IntakeConfig` — from feature 005
  `intakeTypes.ts`.
- `CreateIssueRequest` (`fields.labels` is standard) — from `types/jira.ts`.
