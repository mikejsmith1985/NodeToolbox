# Tasks: Bulk Feature Re-write

**Input**: Design documents from `specs/030-bulk-feature-rewrite/`

**Prerequisites**: plan.md ✅, spec.md ✅ (+ Clarifications), research.md ✅, data-model.md ✅, contracts/ ✅ (bulk-ai-assist, batch-store, before-after-export, submit-drift)

**Tests**: INCLUDED — Constitution Article V mandates TDD (red → green → refactor). Every pure/logic module gets a failing vitest suite first.

**Organization**: By user story. MVP = US1 + US2 + US3 (all P1 — capture → re-write → review/edit → export). All new code is client-side TS under `client/src/views/PoTool/rewrite/`; the nine-section format, the single-issue write path, the AI gate/shell, and the draft-persistence primitives are **reused** (plan.md drift ledger) — do NOT re-implement them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task.
- Tests sit beside their module (`*.test.ts(x)`).

## Guardrails (apply to every task)

- **AI rules (load-bearing)**: the AI step is a manual copy-prompt/paste-reply gated by `useAiAssistStore`; **no automated/background AI, no auto-submit**. Re-writes are nine-section, validation-flagged, and **never AI-attributed**. Nothing writes to Jira without an explicit per-item approve + submit.
- **Do NOT** modify the composition, splitter, planner, or PI Review surfaces beyond the additive PO Tool tab mount; **do NOT** edit `featureDocSections.ts`, `compositionAiAssist.ts`, `buildCompositionCommit.ts`, or `runCommit.ts` — wrap/reuse them (their suites must stay green).
- **UI Styling standard**: new UI reuses the PO Tool CSS-module vocabulary; no unstyled markup.
- **Field ids**: description/AC read+write via the app's configured field ids (`fieldConfig`), never a hardcoded name.
- **Single-file sequences** (do not parallelize): `BulkRewriteTab.tsx` (T011→T015→T018→T021→T025→T027), `rewriteSubmit.ts` (T020→T023), `rewriteBatchStore.ts` (T006→T024).

---

## Phase 1: Setup

- [X] T001 Create `client/src/views/PoTool/rewrite/` and a `rewrite.module.css` skeleton reusing the PO Tool styling vocabulary (mirror a sibling PO Tool module's classes).
- [X] T002 [P] Baseline green before any change (must stay green throughout): `cd client && npx vitest run src/views/PoTool/ai src/views/PoTool/jira`.
- [X] T003 [P] Verify the reuse points resolve: `featureDocSections.ts`, `compositionAiAssist.ts`, `jira/buildCompositionCommit.ts` + `jira/runCommit.ts`, `drafts/compositionDraftStorage.ts` (`buildTeamScopedStorageKey`, `canPersistDrafts`), `services/jiraApi.ts` (`jiraGet`), `utils/richTextPlainText.ts`, `store/aiAssistStore.ts`, `ai/PoAiPanel`, `hooks/usePoHygieneContext` (field ids).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The batch model + local store every story builds on. **BLOCKS all user stories.**

- [X] T004 [P] Define `client/src/views/PoTool/rewrite/rewriteBatchModel.ts` per data-model.md — `ItemState`, `CapturedOriginal`, `ProposedRewrite`, `RewriteItem`, `RewriteBatch`, `RewriteBatchSummary`, `BatchReplyParseResult`, `BatchExportInput`. Types only.
- [X] T005 [P] Write failing tests `client/src/views/PoTool/rewrite/rewriteBatchStore.test.ts` (localStorage mocked): save→load round-trip; `listBatches` returns summaries with per-state counts; `deleteBatch` removes only that batch; team-scoped keys isolate teams; `canPersistDrafts()` false ⇒ save returns false / load null, no throw.
- [X] T006 Implement `client/src/views/PoTool/rewrite/rewriteBatchStore.ts` — `saveBatch`/`loadBatch`/`listBatches`/`deleteBatch` reusing `buildTeamScopedStorageKey` + `canPersistDrafts` (base key `tbxPoRewriteBatch`). Make T005 green. (export/import is US5)

**Checkpoint**: A batch persists and lists; the stories can capture, propose, review, and submit against it.

---

## Phase 3: User Story 1 - Start a batch and generate re-writes (Priority: P1) 🎯 MVP

**Goal**: Paste keys → capture each issue's current summary/description/AC → generate the batch prompt → paste the reply → per-issue nine-section proposals, persisted.

**Independent Test**: Paste several valid keys, confirm the "before" is captured, generate the prompt(s), paste a well-formed reply, and confirm each issue has a nine-section proposal that survives reload.

### Tests for User Story 1 (write first, must FAIL)

- [X] T007 [P] [US1] Failing tests `client/src/views/PoTool/rewrite/captureOriginals.test.ts` (mocked `jiraGet`): fetches summary/description/AC per key, normalized via `normalizeRichTextToPlainText`; a de-duped key list; an unreachable key becomes an item with `captureError` and the rest still capture (FR-001/002).
- [X] T008 [P] [US1] Failing tests `client/src/views/PoTool/rewrite/ai/bulkRewriteAiAssist.test.ts`: one prompt for a small batch and ordered "part N of M" prompts once the batch exceeds the **16000-char prompt cap** (per-source capped at 4000, both named constants — split is deterministic; every key present, none split, an oversized single issue gets its own prompt); prompt carries the nine-section rules, markers, no-AI rule, and the `{kind:'featureRewriteBatch'}` template; parse maps keys, rejects an unknown key, counts a missing description, throws on wrong kind/empty, normalizes+strips each description, and merges multi-part replies by key.

### Implementation for User Story 1

- [X] T009 [US1] Implement `client/src/views/PoTool/rewrite/captureOriginals.ts` (uses `jiraGet` + `normalizeRichTextToPlainText` + the configured AC field id). Make T007 green.
- [X] T010 [US1] Implement `client/src/views/PoTool/rewrite/ai/bulkRewriteAiAssist.ts` — `buildBulkRewritePrompts` + `parseBulkRewriteReply`, reusing `featureDocSections` (`normalizeFeatureDescription` + `stripAiAttribution`) and `extractJsonPayload`. Make T008 green.
- [X] T011 [US1] Implement `client/src/views/PoTool/rewrite/BulkRewriteTab.tsx` intake + generation: paste keys → create batch → capture originals → persist; a gated `PoAiPanel` that offers the prompt(s) and ingests the reply → sets proposals + persists. (depends T006, T009, T010)
- [X] T012 [US1] Mount the tab additively: add `'rewrite'` to `PoToolTab` (`hooks/usePoToolState.ts`), a `{ key:'rewrite', label:'Bulk Re-write' }` definition and a render branch in `PoToolView.tsx` (mirror the Planner tab).

**Checkpoint**: A list of keys becomes a persisted batch of nine-section proposals in one generate-and-paste pass.

---

## Phase 4: User Story 2 - Review and edit before/after (Priority: P1)

**Goal**: Per-issue before/after with free editing and durable per-item state across days.

**Independent Test**: Open a proposed batch, edit one proposal, mark one issue approved and one rejected, reload, and confirm edits + states persist; editing an approved item returns it to reviewing.

### Tests for User Story 2 (write first, must FAIL)

- [X] T013 [P] [US2] Failing tests `client/src/views/PoTool/rewrite/BeforeAfterRow.test.tsx`: renders original vs proposed; an edit updates the proposal and sets `isEdited`; the per-item state control sets state; editing an **approved** item returns it to `reviewing` (FR-020/021/023).

### Implementation for User Story 2

- [X] T014 [US2] Implement `client/src/views/PoTool/rewrite/BeforeAfterRow.tsx` (before/after view + edit + per-item state), styled via `rewrite.module.css`. Make T013 green.
- [X] T015 [US2] Wire the review grid into `BulkRewriteTab.tsx`: render a row per item, persist every edit/state change, show a batch-level state summary, and enforce edit-approved→reviewing. (depends T014, T011)

**Checkpoint**: The batch is fully reviewable/editable and every change is saved for a multi-day review.

---

## Phase 5: User Story 3 - Export a before/after document (Priority: P1)

**Goal**: A self-contained before/after artifact (Markdown + HTML) to send the reviewing PO.

**Independent Test**: From a batch, copy the Markdown and download the HTML; confirm each included issue's before/after reads standalone and excluded (rejected) issues are absent.

### Tests for User Story 3 (write first, must FAIL)

- [X] T016 [P] [US3] Failing tests `client/src/views/PoTool/rewrite/rewriteBatchExport.test.ts`: `buildMarkdownExport` + `buildHtmlExport` include each issue's key + Before + After; the HTML is self-contained (no external `src=`/`href=`); a caller-filtered fixture omits excluded items; neither output contains AI-authorship phrasing; empty input yields a valid empty doc.

### Implementation for User Story 3

- [X] T017 [US3] Implement `client/src/views/PoTool/rewrite/rewriteBatchExport.ts` — pure `buildMarkdownExport` + `buildHtmlExport`; the After column is labeled "proposed description + acceptance criteria" so the unchanged summary is never misread as removed. Make T016 green.
- [X] T018 [US3] Add export UI to `BulkRewriteTab.tsx`: copy-Markdown-to-clipboard + download-HTML, over the non-rejected (operator-chosen) subset. (depends T017, T015)

**Checkpoint**: MVP complete — capture → re-write → review/edit → shareable before/after export.

---

## Phase 6: User Story 4 - Approve and submit to Jira (Priority: P2)

**Goal**: Submit only approved items, each independently, via the reused single-issue write path; idempotent; non-fatal per-item failures.

**Independent Test**: With two approved and one rejected, submit → only the two write (description + AC via configured fields) each with its own result; the rejected is untouched; re-submit re-writes nothing.

### Tests for User Story 4 (write first, must FAIL)

- [X] T019 [P] [US4] Failing tests `client/src/views/PoTool/rewrite/rewriteSubmit.test.ts` (mocked deps): an approved item with matching-key live content is written via `saveField` and set `submitted`; an approved item whose **proposal already equals the live content is a no-op success** (`submitted`, nothing written, not `failed`) (FR-045); `rejected`/`reviewing`/`captured` are never written; an already-`submitted` item is skipped (no duplicate); one item's `saveField` failure sets it `failed` with `fieldErrors` while the others still submit.

### Implementation for User Story 4

- [X] T020 [US4] Implement `client/src/views/PoTool/rewrite/rewriteSubmit.ts` — `submitApprovedItems` building a composition-style update per approved item and calling the reused `buildCompositionCommit` + `runCompositionCommit` with an injected `saveField`; a proposal equal to the live content is a **no-op success** (never the reused "nothing changed" blocker surfacing as `failed`, FR-045); records per-item state + `submitResult`. Make T019 green. (drift is US5)
- [X] T021 [US4] Add submit UI to `BulkRewriteTab.tsx`: submit approved, per-item progress/outcome, idempotent re-run; persist outcomes. (depends T020, T018)

**Checkpoint**: Approved re-writes reach Jira safely, one issue at a time, without duplicates.

---

## Phase 7: User Story 5 - Resume days later + drift + portability (Priority: P2)

**Goal**: Reopen a saved batch, see each issue's state, move batches between machines, and never silently overwrite content that changed in Jira since capture.

**Independent Test**: Save a batch, reopen it intact; export to a file, delete locally, import → full batch returns; change an approved issue upstream → submit flags it changed-since-capture and holds it, others still submit.

### Tests for User Story 5 (write first, must FAIL)

- [X] T022 [P] [US5] Failing tests: in `rewriteSubmit.test.ts` — an approved item whose live content differs from the capture is set `changed` and **not** written; with its key in `submitAnywayKeys` it **is** written. In `rewriteBatchStore.test.ts` — `exportBatchFile`→`importBatchFile` round-trips deep-equal; `importBatchFile` throws on malformed JSON.

### Implementation for User Story 5

- [X] T023 [US5] Add the live drift re-read to `client/src/views/PoTool/rewrite/rewriteSubmit.ts`: `fetchLive(key)` compared (normalized) to `item.original`; a mismatch sets `changed` and holds the item unless its key is in `submitAnywayKeys`. The re-read runs **at submit and via an explicit on-demand check only — never automatically on batch open** (FR-053 timing). Make the drift tests green. (extends T020)
- [X] T024 [US5] Add `exportBatchFile` + `importBatchFile` (validated) to `client/src/views/PoTool/rewrite/rewriteBatchStore.ts`. Make the store round-trip tests green. (extends T006)
- [X] T025 [US5] Add resume UI to `BulkRewriteTab.tsx`: a batch list (reopen/delete via `listBatches`), export/import file buttons, an explicit **"check for changes"** action (runs the drift re-read on demand — the only non-submit trigger), and per-item **re-capture / submit-anyway / skip** actions on a `changed` item. (depends T023, T024, T021)

**Checkpoint**: The multi-day lifecycle works — resume, move between machines, and submit safely against drift.

---

## Phase 8: User Story 6 - Honest states & partial failures (Priority: P3)

**Goal**: Every failure and gap is surfaced, never hidden.

**Independent Test**: A bad key at intake, an AI reply missing an issue / with an unknown key, a chunk-split batch, and a partial submit failure each show a clear, honest message.

### Tests for User Story 6 (write first, must FAIL)

- [X] T026 [P] [US6] Failing tests `client/src/views/PoTool/rewrite/BulkRewriteTab.test.tsx`: intake capture errors are listed per key; ingest surfaces rejected/unknown keys and an "N not yet re-written" count; a chunk split shows a "part N of M" notice; a partial submit failure lists the failed issues; AI panel is hidden while locked.

### Implementation for User Story 6

- [X] T027 [US6] Wire honest-state surfacing into `BulkRewriteTab.tsx` (intake errors, ingest rejected/unparsed summary, chunk-split notice, submit failures) with styled notices. Make T026 green.

**Checkpoint**: Nothing fails silently; the operator always knows where the batch stands.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T028 [P] Update `CHANGELOG.md` with the Bulk Feature Re-write entry.
- [X] T029 Full verification: `cd client && npx vitest run src/views/PoTool/rewrite`, `npx tsc -b`, `npx eslint src/views/PoTool/rewrite`.
- [X] T030 Regression gate: `cd client && npx vitest run src/views/PoTool` — composition, splitter, planner, PI Review suites all green (additive-mount only, no host regression).
- [X] T031 Record the Framework-First drift one-liners at each new module head; confirm by search that no reused module (`featureDocSections`, `compositionAiAssist`, commit path) was edited.
- [ ] T032 Execute `quickstart.md` — unit + the live-Jira steps (capture → export → submit → drift → export/import), capturing evidence.

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)** → no deps.
- **Foundational (P2)** → blocks all stories (model + store).
- **US1** → needs Foundational; MVP core (capture + AI + intake).
- **US2** → needs US1's batch (review/edit the proposals).
- **US3** → needs US2's items (export the current proposals).
- **US4** → needs approved items from US2; the submit path.
- **US5** → extends US4's submit (drift) + Foundational store (export/import) + adds resume/list UI.
- **US6** → surfaces states produced across US1–US5.
- **Polish (P9)** → after the desired stories.

### Within a story
- Tests (`.test.*`) first and FAIL, then implementation (TDD).
- Pure modules (capture, AI, export, submit, store) before the tab wiring.

### Parallel opportunities
- Setup: T002, T003 parallel.
- Foundational: T004, T005 parallel; T006 after T005.
- US1: T007, T008 parallel; T009/T010 parallel; then T011 → T012.
- Each story's test task is [P]; the pure module implementations are [P] across stories once Foundational is done, EXCEPT the three single-file sequences (`BulkRewriteTab.tsx`, `rewriteSubmit.ts`, `rewriteBatchStore.ts`) called out in the guardrails.

## Parallel Example: User Story 1

```bash
# Failing tests together (distinct files):
Task: "capture tests in rewrite/captureOriginals.test.ts"
Task: "batch AI tests in rewrite/ai/bulkRewriteAiAssist.test.ts"
# Then the pure modules together:
Task: "captureOriginals.ts"   Task: "ai/bulkRewriteAiAssist.ts"
```

## Implementation Strategy

### MVP first (US1 + US2 + US3 — all P1)
1. Setup → Foundational (model + store).
2. US1 → capture + generate proposals.
3. US2 → review/edit + durable state.
4. US3 → before/after export.
5. **STOP & VALIDATE** against quickstart steps 1–4; a PO can generate, review, and hand off a batch.

### Incremental delivery
US4 (submit) → US5 (drift + resume + portability) → US6 (honest states) → polish. Each keeps the reused composition/jira/PoTool suites green.

## Notes
- [P] = different files, no incomplete-task dependency; verify each test fails before implementing.
- Commit after each logical group; never commit to `main`; release via `scripts/local-release.ps1` only.
- The AI is always manual/gated/propose-only — there is no background job anywhere in this feature.
