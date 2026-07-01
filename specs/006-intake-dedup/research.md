# Phase 0 Research — Intake Deduplication (Phase 2A)

All unknowns resolved against the codebase and the confirmed decisions. No open NEEDS CLARIFICATION.

## R1 — The dedup stamp: a Jira label

- **Decision**: Stamp each created issue with a label `intake-<submissionId>`. The submission id is
  the Teams GUID (e.g. `intake-2f58d5cd-de0b-4c42-80c4-a1fd8e3ae503`).
- **Rationale**: Labels need no field configuration (unlike a custom field id), are set on the
  standard create payload (`fields.labels`), and are directly JQL-searchable (`labels = "..."`).
  GUIDs contain only `[0-9a-f-]`, which are valid label characters (Jira labels reject whitespace).
- **Alternatives rejected**: A dedicated custom field (needs the instance's field id, more config —
  can be added later if the user prefers hiding the stamp); encoding the id in the description (not
  reliably searchable/indexed).
- **Validation**: `buildIntakeLabel(id)` sanitizes/validates; an id that cannot form a valid label
  (empty, contains whitespace after trim) makes the row unstampable → flagged, not mis-stamped
  (spec edge case).

## R2 — Existence check: label JQL through the existing proxy

- **Decision**: Add `searchIssuesByLabels(labels: string[])` to `jiraApi.ts`, issuing
  `GET /rest/api/2/search?jql=labels in ("intake-a","intake-b")&fields=labels&maxResults=N` via the
  existing `jiraGet`. Response `{ issues: [{ key, fields: { labels: string[] } }] }`.
- **Rationale**: Mirrors the exact pattern already used across ArtView, BusinessHelper, DsuBoard,
  DefectManagement, etc. (`/rest/api/2/search?jql=`). One batched query answers many submissions
  (FR-6). `fields=labels` keeps the response small; we map each returned issue's `intake-` label
  back to its submission id.
- **Rationale (batching/chunking)**: `labels in (...)` takes many values in one query; if the id
  list is very large, chunk into fixed-size groups (e.g. 50 ids per query) to keep JQL length sane.
- **Alternatives rejected**: One `labels = "intake-<id>"` query per row (violates FR-6); the
  `/search` POST body form (GET query mirrors the codebase's existing convention).

## R3 — Where the checks run (batched pre-scan + per-row guard)

- **Decision**: Two complementary checks, both in `useCreateFromSubmission`:
  1. **Batched pre-scan** `reconcileExisting(entries)` — run by the view right after `ingestFile`.
     Collects ids of rows the ledger cache did **not** already resolve (state `new`), runs one (or
     chunked) `searchIssuesByLabels`, and for any id whose stamped issue exists marks the row
     `imported` with the found key and records it to the local ledger. Returns updated entries.
  2. **Per-row guard** inside `createFromSubmission` — immediately before `createIssue`, a final
     `searchIssuesByLabels(['intake-<id>'])` for that single id; if found, reconcile+skip instead of
     creating. Covers manual create of an un-scanned row and the two-instance race.
- **Rationale**: The pre-scan gives fast, correct UX on import (already-created rows show Imported,
  nothing re-created) and satisfies batching; the per-row guard guarantees correctness at the exact
  moment of creation (US1.3 race, US2 mid-failure, manual/retry paths — FR-8).
- **Alternatives rejected**: Pre-scan only (a row created by another instance between scan and
  create could dup); per-row only (would violate batching FR-6 on large re-imports).

## R4 — Ledger becomes a cache, reconciled from Jira

- **Decision**: Keep `processedLedger` (Confluence content property) as the local fast cache. Rows
  already in the ledger render `imported` without any Jira call (FR-5). When the pre-scan or guard
  finds an existing stamped issue for a row not in the ledger, it **reconciles**: adds a
  `ProcessedEntry` via the existing `recordProcessed` so future imports hit the cache.
- **Rationale**: Correctness no longer depends on the ledger (Jira is authoritative), but the cache
  keeps re-imports cheap and self-heals after a reset (SC-002/003/004).
- **Alternatives rejected**: Dropping the ledger entirely (every row would need a Jira check — slow,
  FR-6 fail).

## R5 — Failure handling (Jira unreachable / ambiguous)

- **Decision**: If a check cannot complete (network/permission error), do **not** create — mark the
  affected rows for attention (state stays `new`/`failed` with a clear reason) so the user retries
  (FR-7, SC-005). If more than one issue carries the same `intake-<id>` (pre-existing data anomaly),
  report the ambiguity, show the matching keys, and do not create another.
- **Rationale**: The whole point is to never risk a duplicate; a failed check must fail safe (no
  create) rather than fall back to blind creation.
- **Alternatives rejected**: Treat check failure as "not found → create" (would reintroduce dups on
  a transient outage).

## R6 — Stamp on create

- **Decision**: `buildIntakeFields` attaches `labels: ['intake-<id>']` to the create payload (merged
  with any labels already produced by mapping — today none). Every create path uses
  `buildIntakeFields`, so all paths stamp uniformly (FR-1, FR-8, FR-10).
- **Rationale**: Single choke point; keeps stamping consistent and testable. `labels` is a standard
  Jira create field, no proxy change needed.
- **Alternatives rejected**: Setting the label in a second API call after create (extra round-trip,
  and a window where the issue exists unstamped — defeats US2).

## R7 — Transition for pre-2A issues

- **Decision**: Do not retroactively stamp issues created before 2A; they remain covered by the
  existing local ledger. Document this in CHANGELOG. Going forward every created issue is stamped.
- **Rationale**: Back-filling would need a migration/mapping of old submissions→issues that we don't
  have; the ledger already prevents their re-creation on the machines that made them. Out of 2A
  scope per spec; can be added later if needed.
