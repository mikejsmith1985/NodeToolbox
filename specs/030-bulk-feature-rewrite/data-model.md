# Phase 1 Data Model: Bulk Feature Re-write

Plain-data contracts (no I/O, no clock) for the batch. Reused types are marked **REUSE**; new types name their module (`rewrite/rewriteBatchModel.ts`).

## Reused (no new type)

- **nine-section helpers** (REUSE — `ai/featureDocSections.ts`): `normalizeFeatureDescription`, `stripAiAttribution`, `VALIDATION_MARKER` — applied to each item's proposed description.
- **`CompositionCommitDiff` / write path** (REUSE — `jira/buildCompositionCommit.ts`, `jira/runCommit.ts`): each approved item is submitted as a composition-style update.
- **draft persistence primitives** (REUSE — `drafts/*`): `buildTeamScopedStorageKey`, `canPersistDrafts`.

## New — `rewrite/rewriteBatchModel.ts`

### ItemState
`'captured' | 'proposed' | 'reviewing' | 'approved' | 'rejected' | 'changed' | 'submitted' | 'failed'`
- `captured` — original snapshotted, no proposal yet.
- `proposed` — an AI re-write exists, not yet reviewed.
- `reviewing` — the PO is working it (also the state **any** edit returns an approved item to — FR-023).
- `approved` — cleared for submit.
- `rejected` — excluded from export/submit.
- `changed` — live Jira content differs from the captured snapshot (set at submit-time drift check — FR-053).
- `submitted` — written to Jira (terminal for a re-run — FR-043).
- `failed` — a submit write failed (retryable).

### CapturedOriginal
| Field | Type | Notes |
|-------|------|-------|
| `summary` | string | normalized |
| `description` | string | `normalizeRichTextToPlainText` at capture |
| `acceptanceCriteria` | string | normalized; from the configured AC field |
| `capturedAtIso` | string | when the snapshot was taken |

### ProposedRewrite
| Field | Type | Notes |
|-------|------|-------|
| `description` | string | nine-section, normalized + AI-attribution stripped |
| `acceptanceCriteria` | string | the proposed AC (also written to the AC field on submit) |
| `isEdited` | boolean | true once the PO has edited the proposal |

### RewriteItem
| Field | Type | Notes |
|-------|------|-------|
| `jiraKey` | string | the issue |
| `original` | CapturedOriginal | the immutable "before" |
| `proposed` | ProposedRewrite \| null | null until an AI reply provides one |
| `state` | ItemState | lifecycle above |
| `captureError` | string \| null | set when the key could not be fetched at intake (FR-001) |
| `submitResult` | { ok: boolean; fieldErrors?: string[] } \| null | per-issue outcome (FR-042) |

### RewriteBatch
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable batch id |
| `name` | string | operator-facing name |
| `teamProfileId` | string | scopes the store key (like drafts) |
| `createdAtIso` | string | |
| `items` | RewriteItem[] | one per key |
| `updatedAtIso` | string | bumped on every change |

### BatchRewriteReply / BatchReplyParseResult *(AI output — `{kind:'featureRewriteBatch'}`)*
- reply item: `{ key: string; description: string; acceptanceCriteria: string }`.
- `BatchReplyParseResult`: `{ rewritesByKey: Record<string, ProposedRewrite>; rejected: { key: string; reason: string }[]; unparsedCount: number }`.

### BatchExportInput
The subset the export needs per included item: `{ jiraKey, original, proposed }`. Excluded items (e.g. `rejected`) are filtered out before export (FR-032).

## State transitions

```
captured ──(AI reply)──▶ proposed ──(open)──▶ reviewing ──▶ approved ──(submit ok)──▶ submitted
   │                                            │  ▲                     │
   │                                     (reject)│  │(material edit to     │(drift at submit)
   │                                            ▼  │ an approved item)     ▼
   └──(capture fail → captureError)          rejected                   changed ──(re-capture|submit anyway)──▶ …
                                                                          (submit fail) ──▶ failed ──(retry)──▶ …
```

## Validation rules (from Requirements)

- Keys are de-duplicated at intake; an unfetchable key becomes an item in `captured`+`captureError`, never a whole-batch failure (FR-001).
- A reply entry for a key not in the batch → `rejected[]` with a reason; a batch item with no reply entry stays `captured` ("not yet re-written") (FR-013).
- Every `proposed.description` is the normalized nine-section form and carries no AI attribution (FR-012, SC-005).
- A material edit to an `approved` item → back to `reviewing` (FR-023).
- Export includes only non-`rejected` (and operator-chosen) items and never attributes to AI (FR-031/032).
- Submit writes only `approved` items, each independently; `submitted` items are skipped on a re-run (FR-040/043/044).
- An approved item whose proposal already equals the live content is a **no-op success** → `submitted`, nothing written, not `failed` (FR-045).
- Any edit to an `approved` item's proposal → `reviewing` (FR-023).
- Before writing an approved item, its live content is re-read; a mismatch sets `changed` and holds it out of the bulk submit (FR-053, SC-007).
- The whole `RewriteBatch` round-trips through local storage and the export/import file without loss (FR-050/052, SC-002).
