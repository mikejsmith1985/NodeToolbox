# Contract: Submit + Drift (`rewrite/rewriteSubmit.ts`)

Submits approved items one at a time via the REUSED single-issue write path, with a live drift re-read before each write. Propose-only: runs only on an explicit submit; only approved items; never writes a `submitted` item again.

## Reused primitives
- `buildCompositionCommit({ draft, requiredFieldDescriptors, acceptanceCriteriaFieldId, existingFieldValues })` → diff.
- `runCompositionCommit(diff, { createIssue, saveField })` → per-field outcome (`jira/runCommit.ts`).
- `jiraApi.jiraGet` + `normalizeRichTextToPlainText` for the live re-read (same fields as capture).

## Function

```ts
submitApprovedItems(
  batch: RewriteBatch,
  context: { acceptanceCriteriaFieldId: string | null; fieldDescriptors: CreateMetaFieldEntry[] },
  deps: { fetchLive: (key: string) => Promise<CapturedOriginal>; saveField: SaveFieldFn },
  overrides?: { submitAnywayKeys?: string[] },
): Promise<RewriteBatch>   // returns the batch with per-item state + submitResult updated
```

### Per approved item (in order)
1. **Skip** if already `submitted`.
2. **Drift re-read**: `fetchLive(key)`; if its normalized description/AC differ from `item.original` AND the key is not in `submitAnywayKeys`, set state `changed` and **do not write** — hold it out (FR-053).
3. **No-op check**: if the proposed description/AC already equal the live content, mark `submitted` with nothing written — a **no-op success**, not a failure (FR-045). (This also avoids the reused `buildCompositionCommit` "nothing has changed" blocker surfacing as a spurious failure.)
4. **Write**: build an update diff (existing key, `proposed.description`, `proposed.acceptanceCriteria`, `existingFieldValues` = the live values) → `runCompositionCommit` with the injected `saveField`; on success set `submitted`; on failure set `failed` with `submitResult.fieldErrors` (FR-042).
5. Other items continue regardless of one item's drift/failure.

**Drift-check timing (FR-053)**: the live re-read runs **at submit** and via an explicit on-demand "check for changes"; it does NOT run automatically on every batch open (keeps resuming friction-free).

**Cross-project batches**: a description+AC update needs only the instance-wide acceptance-criteria field id (description is native) — so `submitApprovedItems` works across issues in different projects without per-project field descriptors; `fieldDescriptors` may be empty for the update path (it drives labels only, not the write).

Re-capture and skip are UI actions on a `changed` item; **submit anyway** re-runs `submitApprovedItems` with that key in `submitAnywayKeys`.

## Guarantees
- Only `approved` items are written; `rejected`/`reviewing`/`captured` are untouched (FR-040/044).
- The item's **current (edited)** proposed text is what writes (FR-041).
- A `submitted` item is never re-written on a re-run (FR-043).
- A changed-since-capture item is never silently overwritten (FR-053, SC-007); a per-item failure never blocks the rest (FR-042).
- Writes go through the configured field ids (via `buildCompositionCommit`), never a hardcoded name.

## Test obligations (TDD, vitest, mocked deps)
- Approved item with matching live content → written via `saveField`, state `submitted`.
- Approved item whose live content changed → state `changed`, **no** write; with its key in `submitAnywayKeys` → written.
- Rejected/reviewing items → never written; already-`submitted` → skipped (no duplicate).
- An approved item whose proposal equals the live content → **no write**, marked `submitted` (no-op success, not `failed`).
- One item's `saveField` failure → that item `failed` with fieldErrors, others still submit.
