# Phase 0 Research: Bulk Feature Re-write

All four clarifications were resolved before planning (spec `## Clarifications`). This file records the codebase-grounded decisions with file:line evidence and the Framework-First reuse map.

## R1 — Re-write format IS the shipped nine-section module

- **Decision**: the batch re-write reuses `PoTool/ai/featureDocSections.ts` (`normalizeFeatureDescription`, `stripAiAttribution`, `VALIDATION_MARKER`) unchanged; each ingested item's description runs through the same normalize+strip as single-issue composition.
- **Rationale**: "the designated format" is exactly the nine-section format spec 029 already produces. Reusing it means batch output can't diverge from single-issue output (agree-by-construction) and inherits the validation-flag + no-AI-attribution guarantees for free.
- **Alternatives**: a batch-specific formatter (rejected — duplicate logic, drift risk).

## R2 — Batch AI envelope + prompt chunking (propose-only)

- **Decision**: new `ai/bulkRewriteAiAssist.ts` mirroring `compositionAiAssist.ts` (`extractJsonPayload` + kind guard): `buildBulkRewritePrompt(items)` (or `buildBulkRewritePrompts` → ordered `string[]` when the set is large) and `parseBulkRewriteReply(reply, knownKeys)` → entries keyed by Jira key. Envelope: `{"kind":"featureRewriteBatch","items":[{"key":"ABC-1","description":"…","acceptanceCriteria":"…"}]}`.
- **Rationale**: FR-010/013. Same proven prompt-out/paste-reply-in pattern (`compositionAiAssist.ts:49,127`), gated by `useAiAssistStore`, rendered via `PoAiPanel`. Keying by Jira key lets the ingest map each re-write to its item and reject unknown keys.
- **Chunking (concrete cap)**: each issue's source text is capped at **4000 chars** (matching composition's `MAX_SOURCE_TEXT_LENGTH`, `compositionAiAssist.ts:33`), and a prompt is capped at **16000 chars** — both named constants. When the batch exceeds the prompt cap, issues split across an ordered set of prompts (each issue whole; a single oversized issue gets its own prompt), never dropping one (FR-010, Edge Cases). Deterministic → testable.
- **Alternatives**: one prompt always (rejected — large batches overflow context); per-issue prompts (rejected — defeats the "one pass" 0-friction goal, SC-001).

## R3 — Persistence: local store + portable batch file

- **Decision**: `rewriteBatchStore.ts` persists batches in `localStorage`, mirroring `drafts/compositionDraftStorage.ts` (`buildTeamScopedStorageKey`, `canPersistDrafts`, list-by-prefix — `compositionDraftStorage.ts:39,44,89`). Base key e.g. `tbxPoRewriteBatch`. Plus `exportBatchFile`/`importBatchFile` (JSON download/upload) as the cross-machine backup (clarification 1).
- **Rationale**: FR-050/051/052. Consistent with how the tool already persists drafts across sessions; export/import covers the per-machine limitation without standing up server storage.
- **Alternatives**: server-side persistence (rejected for scope — new server storage + sync; the user accepted local + export/import); IndexedDB (unnecessary — batches are small JSON).

## R4 — Capture originals (the "before")

- **Decision**: `captureOriginals.ts` fetches each key via `jiraApi.jiraGet` for `summary`, `description`, and the configured AC field, and stores them **normalized** with `normalizeRichTextToPlainText` (`utils/richTextPlainText.ts`) — the same normalization composition applies (`FeatureCompositionTab.tsx:244`).
- **Rationale**: FR-002. Normalizing at capture means the drift comparison (R6) and the export compare like-for-like, avoiding the false-diff that flattened-HTML caused in GH #200.
- **AC field id** comes from `usePoHygieneContext().fieldConfig.acceptanceCriteriaFieldIds` (the app's resolved ids), never a hardcoded name.

## R5 — Before/after export (Markdown + HTML)

- **Decision**: `rewriteBatchExport.ts` exposes pure `buildMarkdownExport(items)` and `buildHtmlExport(items)`; the tab wires copy-to-clipboard (Markdown) and download (self-contained `.html`). Each included item shows key, original, and current proposal side by side; excluded items (e.g. rejected) are omitted (FR-030/031/032, clarification 3).
- **Rationale**: pure builders are unit-testable and deterministic; two forms cover paste-into-email/Teams and open-in-browser with zero dependencies. No AI attribution anywhere (SC-005).
- **Alternatives**: Confluence publish (out of scope per clarification 3); PDF (needs a dependency — rejected).

## R6 — Submit via the reused write path + live drift re-read

- **Decision**: `rewriteSubmit.ts` submits one approved item at a time by building a composition-style update (existing key, proposed description + AC) and calling the reused `buildCompositionCommit` + `runCompositionCommit` (`jira/buildCompositionCommit.ts`, `jira/runCommit.ts`) with the injected `saveField`. **Before writing each item**, it re-reads the live issue (same fields as capture) and compares to the captured snapshot; if they differ, the item is marked **changed-since-capture** and held out — the PO then chooses re-capture / submit-anyway / skip (FR-053, clarification 4).
- **Rationale**: FR-040/041/042/043/044. Reuses the exact single-issue write (field-id-correct, per-field outcome, non-fatal) so batch writes behave identically; the drift re-read is the one new safety step. Idempotency: a submitted item's state is recorded so a re-run skips it.
- **Alternatives**: write without re-reading (rejected — silent overwrite risk, SC-007); hard-block changed items (rejected per clarification 4 — too rigid).

## R7 — Surface: an additive PO Tool tab

- **Decision**: mount a new **"Bulk Re-write"** tab in the PO Tool exactly like the Planner tab — add `'rewrite'` to `PoToolTab` (`hooks/usePoToolState.ts:14`), a `{ key:'rewrite', label:'Bulk Re-write' }` definition and a render branch in `PoToolView.tsx` (`:28`). Styling reuses the PO Tool vocabulary (UI Styling standard).
- **Rationale**: the PO Tool is "the Feature composition tool"; a dedicated tab fits the distinct batch workflow without touching the composition tab. Additive mount = no host regression.
- **Alternatives**: a mode inside the Composition tab (rejected — conflates single-issue and batch state on one screen, higher friction).

## Summary of new vs reused

| Concern | Source |
|---------|--------|
| Nine-section format, validation flags, no-AI-attribution | **REUSE** `featureDocSections.ts` |
| Propose-only prompt/reply pattern, AI gate, paste-reply shell | **REUSE** `compositionAiAssist.ts` + `useAiAssistStore` + `PoAiPanel` |
| Per-issue write (description + AC, field-id-correct, per-field outcome) | **REUSE** `buildCompositionCommit` + `runCompositionCommit` |
| localStorage persistence primitives | **REUSE** `drafts/*` (`buildTeamScopedStorageKey`, `canPersistDrafts`) |
| Rich-text normalize (like-for-like compare) | **REUSE** `richTextPlainText.ts` |
| Batch `{kind:'featureRewriteBatch'}` envelope + chunking | **NEW** `ai/bulkRewriteAiAssist.ts` |
| Batch model + local store + export/import | **NEW** `rewriteBatchModel.ts` + `rewriteBatchStore.ts` |
| Capture originals snapshot | **NEW** `captureOriginals.ts` |
| Before/after export (MD + HTML) | **NEW** `rewriteBatchExport.ts` |
| Submit orchestration + live drift re-read | **NEW** `rewriteSubmit.ts` |
| Batch UI (intake → review → export → submit) | **NEW** `BulkRewriteTab.tsx` + `BeforeAfterRow.tsx` |
