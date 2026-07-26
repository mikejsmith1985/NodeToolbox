# Contract: Batch Store & Portability (`rewrite/rewriteBatchStore.ts`)

Persists batches in local storage (mirroring `drafts/compositionDraftStorage.ts`) and exports/imports a portable JSON file. Reuses `buildTeamScopedStorageKey` and `canPersistDrafts`.

## Functions

```ts
saveBatch(batch: RewriteBatch): boolean                    // upsert; bumps updatedAtIso; false if storage unavailable
loadBatch(teamProfileId: string, batchId: string): RewriteBatch | null
listBatches(teamProfileId: string): RewriteBatchSummary[]  // id, name, createdAtIso, counts by state
deleteBatch(teamProfileId: string, batchId: string): void
exportBatchFile(batch: RewriteBatch): { fileName: string; json: string }   // pure; caller triggers the download
importBatchFile(json: string): RewriteBatch                // parse + validate shape; throws on malformed
```

## Behavior
- Storage key: `${buildTeamScopedStorageKey('tbxPoRewriteBatch', teamProfileId)}:${batchId}` — team-scoped like drafts, one entry per batch; `listBatches` enumerates by prefix.
- `canPersistDrafts()` false (private mode) → save/load are no-ops/null and the UI warns; the batch still works in-memory for the session.
- `importBatchFile` validates the shape (id, items array, each item's key/original/state) and rejects anything else with a labeled error — never trusts arbitrary JSON.
- Round-trip: `importBatchFile(exportBatchFile(b).json)` deep-equals `b` (portability, FR-052).

## Guarantees
- The whole batch — originals, proposals, edits, states, submit outcomes — persists across sessions and survives export→import (SC-002).
- Team-scoped keys keep one team's batches from colliding with another's.

## Test obligations (TDD, vitest, localStorage mocked)
- save→load round-trips a batch; listBatches returns summaries with per-state counts.
- deleteBatch removes only that batch.
- export→import round-trips deep-equal; importBatchFile throws on malformed JSON.
- canPersistDrafts false → save returns false, load returns null, no throw.
