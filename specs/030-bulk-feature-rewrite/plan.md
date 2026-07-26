# Implementation Plan: Bulk Feature Re-write

**Branch**: `feature/030-bulk-feature-rewrite` | **Date**: 2026-07-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/030-bulk-feature-rewrite/spec.md`

## Summary

A persisted, resumable batch workspace in the PO Tool: paste Jira keys → capture each issue's current summary/description/AC → generate one propose-only AI prompt for the whole set → paste the reply back → get per-issue nine-section re-writes → review/edit each with a before/after view → export a self-contained before/after document for a reviewing PO → record approval → submit approved (possibly edited) re-writes to Jira, with changed-since-capture protection. The whole batch lives in local storage across days and can be exported/imported to move between machines.

**Technical approach — reuse-first (Framework-First gate).** The single-issue building blocks already exist and this feature applies them per item across a batch:

- **The re-write format is the shipped nine-section module** — `PoTool/ai/featureDocSections.ts` (`normalizeFeatureDescription`, `stripAiAttribution`, validation markers). The batch AI reuses it verbatim, so batch re-writes cannot drift from single-issue behavior (agree-by-construction).
- **The propose-only AI pattern** — `compositionAiAssist.ts` (`extractJsonPayload`, kind-guarded `{kind, items}` ingest) + the `useAiAssistStore` gate + the `PoAiPanel`/`ReportAiPanel` copy-prompt/paste-reply shell. The batch adds a new `{kind:'featureRewriteBatch'}` envelope keyed by Jira key.
- **The per-issue write path** — `jira/buildCompositionCommit.ts` + `jira/runCompositionCommit` already update an existing issue's description + AC via the instance's configured field ids (never a hardcoded name). Submission calls this once per approved item.
- **Persistence primitives** — `drafts/compositionDraftStorage.ts` / `splitDraftStorage.ts` (`buildTeamScopedStorageKey`, `canPersistDrafts`, list-by-prefix) are the localStorage pattern the batch store mirrors.
- **Capture + drift** reuse `jiraApi.jiraGet` + `utils/richTextPlainText.normalizeRichTextToPlainText` (the same normalization composition uses, so a captured original compares like-for-like — GH #200 lesson).

So the genuinely **new** work is the batch layer: the `featureRewriteBatch` AI envelope (with prompt chunking for large sets), the batch model + local store + export/import, the before/after export (Markdown + HTML), the submit orchestration with a live re-read for drift, and the batch UI (intake → review grid → export → submit) mounted as a new PO Tool tab.

## Technical Context

**Language/Version**: TypeScript (client, strict) + React; vitest.

**Primary Dependencies**: **No new dependencies.** Reuse `featureDocSections.ts`, `compositionAiAssist.ts` (pattern), `jira/buildCompositionCommit.ts` + `runCompositionCommit`, `drafts/*` persistence primitives, `usePoHygieneContext` (field-id config), `services/jiraApi.ts` (`jiraGet`), `utils/richTextPlainText.ts`, `store/aiAssistStore.ts`, `PoAiPanel`.

**Storage**: **local browser storage** for batches (mirrors the existing drafts), plus a JSON **export/import** file for portability/backup. No server storage. Jira is the system of record for the issues themselves.

**Testing**: vitest — pure batch AI parse/prompt, batch store (localStorage mocked), capture mapping, before/after export builders, submit orchestration + drift (mocked jiraGet/commit). Existing composition suites stay green.

**Target Platform**: NodeToolbox desktop/browser; client-only, Jira through the existing proxy.

**Project Type**: Web application (client-side feature).

**Performance Goals**: interactive. A batch of tens of issues captures/re-writes/exports in well under a few seconds of local work; AI is manual paste; submission is per-item, sequenced with per-item progress.

**Constraints**: **propose-only, gated, NO automated/background AI** — the multi-day gap is a human loop the store spans, never a job; nine-section format + validation flags + never AI-attributed; writes via configured field ids only; nothing written without explicit per-item approval + submit; changed-since-capture never silently overwritten; no regression to single-issue composition/splitter/planner.

**Scale/Scope**: one operator, one batch at a time (several batches coexist); tens of issues per batch; each re-write is description + AC.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Status | Notes |
|---------|--------|-------|
| III — Branching | ✅ | `feature/030-bulk-feature-rewrite`; PR to main. |
| IV — Code Quality | ✅ | Pure modules, named constants (states, storage keys), verb-first funcs <40 lines, doc comments. |
| V — Testing (TDD) | ✅ | Batch AI/store/export/submit are unit-first; failing test precedes each. |
| VI — Documentation | ✅ | CHANGELOG on behavior change; only `specs/030-*` pipeline docs added. |
| VII — Framework-First | ✅ | **Strongly satisfied** — reuse nine-section format, single-issue write path, AI gate/shell, draft persistence, field-id config. New = the batch/persistence/export/submit layer (documented gaps). |
| VIII — Release | ✅ | Local pipeline only. |
| IX — Vault Zero-Knowledge | ✅ | No secrets; Jira auth stays proxy-injected. |
| X — Verification & Proof | ✅ | quickstart defines the live evidence; determinism/drift proven by unit tests. |
| XI — Output Restraint | ✅ | No new dashboards; the before/after export is a deliberate, user-triggered artifact. |

**AI-rules gate (load-bearing for this feature)**: the AI step is a manual copy-prompt/paste-reply, gated by `useAiAssistStore`, producing propose-only per-item suggestions that a human accepts; **no scheduler, no background dispatch, no auto-submit**. The days-long delay is persisted human review. This is asserted in FR-010/011/044 and re-checked post-design. ✅

**Framework-First drift ledger** (the new infrastructure):

| New component | Why the framework doesn't provide it |
|---------------|--------------------------------------|
| `ai/bulkRewriteAiAssist.ts` (`{kind:'featureRewriteBatch'}` + prompt chunking) | New envelope keyed by Jira key over N issues; single-issue composition has no batch/keyed form or chunking. |
| `rewriteBatchModel.ts` + `rewriteBatchStore.ts` (+ export/import) | Nothing models a multi-issue batch with per-issue lifecycle state, nor a batch list, nor a portable batch file. Draft storage is single-scope. |
| `captureOriginals.ts` | No existing "snapshot N issues' current text at a point in time" capture. |
| `rewriteBatchExport.ts` (Markdown + HTML before/after) | No existing before/after comparison artifact. |
| `rewriteSubmit.ts` (per-item submit + live drift re-read) | Composition submits one draft with no snapshot-vs-live drift check. |

No unjustified violations → **gate passes**. Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/030-bulk-feature-rewrite/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── bulk-ai-assist.md
│   ├── batch-store.md
│   ├── before-after-export.md
│   └── submit-drift.md
├── checklists/
│   └── requirements.md  # (from /speckit-specify + /speckit-clarify)
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
client/src/views/PoTool/rewrite/                 # NEW — the bulk re-write feature
├── rewriteBatchModel.ts        # types: RewriteBatch, RewriteItem, ItemState, BatchReply
├── rewriteBatchStore.ts        # localStorage CRUD + list batches + export/import JSON (reuses draft primitives)
├── captureOriginals.ts         # fetch + normalize each key's summary/description/AC (the "before")
├── rewriteBatchExport.ts       # pure: buildMarkdownExport + buildHtmlExport (before/after)
├── rewriteSubmit.ts            # per-item submit via reused composition commit + live drift re-read
├── ai/bulkRewriteAiAssist.ts   # buildBulkRewritePrompt(s) + parseBulkRewriteReply ({kind:'featureRewriteBatch'})
├── BulkRewriteTab.tsx          # the surface: batch list, intake, gated AI panel, review grid, export, submit
├── BeforeAfterRow.tsx          # one issue's before/after + edit + per-item state control
├── rewrite.module.css          # styling (reuses PO Tool styling vocabulary — UI Styling standard)
└── *.test.ts(x)                # unit tests (TDD) alongside each module

MODIFY (additive): PoTool/hooks/usePoToolState.ts (+ 'rewrite' tab type), PoTool/PoToolView.tsx (+ tab
  definition + render branch), like the Planner tab — no host logic touched.

REUSE (unchanged): ai/featureDocSections.ts, ai/compositionAiAssist.ts (pattern), jira/buildCompositionCommit.ts
  + jira/runCommit.ts, drafts/{compositionDraftStorage,splitDraftStorage}.ts (buildTeamScopedStorageKey,
  canPersistDrafts), hooks/usePoHygieneContext.ts (field ids), services/jiraApi.ts (jiraGet),
  utils/richTextPlainText.ts, store/aiAssistStore.ts, ai/PoAiPanel.
```

**Structure Decision**: Web app; a new `client/src/views/PoTool/rewrite/` module mounted as an additive **"Bulk Re-write" tab** in the PO Tool (mirroring the Planner mount). It reuses the nine-section format, the single-issue write path, the AI gate/shell, and the draft-persistence primitives; the new code is the batch model/store/export/submit + the batch UI. No changes to the composition, splitter, planner, or PI Review surfaces (they must stay green).

## Complexity Tracking

> No Constitution violations require justification. The new modules are genuine gaps (batch lifecycle, portable batch file, before/after export, snapshot-vs-live drift); each reuses the single-issue mechanisms rather than re-implementing them.
